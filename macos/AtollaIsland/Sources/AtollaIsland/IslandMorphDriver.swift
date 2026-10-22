import AppKit
import Foundation
import QuartzCore

/// 灵动岛动画相位（副岛合并 → 主岛展开）。
enum IslandAnimationPhase: Equatable {
  case collapsed
  case merging
  case expanding
  case expanded
  case collapsing
}

/// 几何 morph + 副岛 mergeProgress 驱动。
/// 使用 CADisplayLink 对齐屏幕刷新（ProMotion 最高 ~120fps），每帧只发一次 objectWillChange。
final class IslandMorphDriver: ObservableObject {
  // 几何 / 进度（非 @Published：由 publish 批量通知，避免一帧多次 SwiftUI 刷新）
  private(set) var width: CGFloat = 185
  private(set) var height: CGFloat = 32
  private(set) var contentProgress: CGFloat = 0
  /// 0 = 胶囊四角；1 = 上小下大面板圆角。merge 阶段保持 0。
  private(set) var expandProgress: CGFloat = 0
  private(set) var targetExpanded = false
  private(set) var isAnimating = false
  private(set) var phase: IslandAnimationPhase = .collapsed

  // MARK: Merge 驱动量（0…1）

  private(set) var mergeProgress: CGFloat = 0
  /// 主岛右缘拉伸（pt），左缘保持不动
  private(set) var mainRightStretch: CGFloat = 0
  /// 副岛中心相对静止位的水平位移（负值 = 向主岛）
  private(set) var secondaryOffsetX: CGFloat = 0
  private(set) var secondaryScale: CGFloat = 1
  private(set) var secondaryTextOpacity: CGFloat = 1
  /// 液态桥强度 0…1
  private(set) var bridgeProgress: CGFloat = 0
  /// merge 完成前仍参与布局；完成后移除
  private(set) var secondaryInLayout: Bool = true

  /// 每帧几何更新后回调（面板跟窗用，与 morph 同 vsync）
  var onFrame: (() -> Void)?

  private var displayLink: CADisplayLink?
  /// DisplayLink 不可用时的兜底（约 120Hz）
  private var fallbackTimer: Timer?
  private var startMedia: CFTimeInterval = 0
  private var mode: Mode = .idle

  private var fromW: CGFloat = 0
  private var fromH: CGFloat = 0
  private var toW: CGFloat = 0
  private var toH: CGFloat = 0
  private var fromContent: CGFloat = 0
  private var fromExpand: CGFloat = 0

  /// merge 完成后立刻 expand 的目标
  private var pendingExpandW: CGFloat = 0
  private var pendingExpandH: CGFloat = 0
  private var mergeTravel: CGFloat = 0

  private enum Mode { case idle, merging, expanding, collapsing }

  // MARK: 可调参数（略拉长以增加插值帧，曲线更细）

  var expandDuration: CFTimeInterval = 0.28
  var collapseDuration: CFTimeInterval = 0.255
  var contentRevealDelay: CFTimeInterval = 0.07
  var contentRevealSpan: CFTimeInterval = 0.14
  var contentOutDuration: CFTimeInterval = 0.04
  var shapeCollapseDelay: CFTimeInterval = 0.05

  /// 副岛合并总时长（随后无缝接 expand）
  var mergeDuration: CFTimeInterval = 0.26
  /// 吸收瞬间右缘最大拉伸
  var absorbStretchPeak: CGFloat = 12
  /// 副岛向左移动的总行程（gap + 半径 + 吞入）
  var mergeOverlap: CGFloat = 10

  // MARK: Mac notch 圆角语义（非 iPhone 胶囊）

  /// 收起刘海：顶角极弱（左右相同）
  var collapsedTopRadius: CGFloat = 2
  /// 收起刘海：底角圆润（左右相同）
  var collapsedBottomRadiusFactor: CGFloat = 0.45
  var collapsedBottomRadiusMax: CGFloat = 14

  /// 展开面板：顶部小圆角（左右相同）
  var expandedTopRadius: CGFloat = 9
  /// 展开面板：底部大圆角（左右相同）
  var expandedBottomRadius: CGFloat = 26

  /// 收起底角绝对值
  var collapsedBottomRadius: CGFloat {
    min(height * collapsedBottomRadiusFactor, collapsedBottomRadiusMax)
  }

  /// 顶部圆角：collapsed≈2 → expanded≈9；expandProgress 前半段快速到位
  var topCornerRadius: CGFloat {
    let from = min(collapsedTopRadius, height * 0.2)
    let to = min(expandedTopRadius, height * 0.5)
    return lerp(from, to, topRadiusProgress(expandProgress))
  }

  /// 底部圆角：刘海底圆 → 面板大圆；略慢于顶部
  var bottomCornerRadius: CGFloat {
    let from = min(collapsedBottomRadius, height * 0.5)
    let to = min(expandedBottomRadius, height * 0.5)
    return lerp(from, to, bottomRadiusProgress(expandProgress))
  }

  /// 兼容旧引用
  var cornerRadius: CGFloat { topCornerRadius }

  /// 交互锁：merge / expand / collapse 中禁止再点副岛
  var blocksSecondaryTap: Bool {
    phase == .merging || phase == .expanding || phase == .expanded || phase == .collapsing || isAnimating
  }

  func syncIdle(width w: CGFloat, height h: CGFloat, expanded: Bool) {
    guard !isAnimating else { return }
    publish {
      width = w
      height = h
      contentProgress = expanded ? 1 : 0
      expandProgress = expanded ? 1 : 0
      targetExpanded = expanded
      phase = expanded ? .expanded : .collapsed
      resetMergeVisuals(secondaryVisible: !expanded)
    }
    onFrame?()
  }

  /// 主岛点击：直接展开（跳过副岛 merge）
  func expand(toWidth: CGFloat, toHeight: CGFloat) {
    guard phase == .collapsed, !isAnimating else { return }
    publish {
      secondaryInLayout = false
      resetMergeVisuals(secondaryVisible: false)
    }
    beginExpand(toWidth: toWidth, toHeight: toHeight)
  }

  /// 副岛点击：先 merge，再顺势 expand（禁止直接 expanded=true）
  func mergeThenExpand(
    toWidth: CGFloat,
    toHeight: CGFloat,
    travelDistance: CGFloat
  ) {
    guard phase == .collapsed, !isAnimating else { return }
    pendingExpandW = toWidth
    pendingExpandH = toHeight
    mergeTravel = max(travelDistance, IslandMetrics.badgeGap + IslandMetrics.badgeSize * 0.5)
    publish {
      mergeProgress = 0
      secondaryInLayout = true
      resetMergeVisuals(secondaryVisible: true)
      targetExpanded = true
      phase = .merging
    }
    mode = .merging
    beginDisplayLink()
  }

  func collapse(toWidth: CGFloat, toHeight: CGFloat) {
    if phase == .merging { return }
    fromW = width
    fromH = height
    fromContent = contentProgress
    fromExpand = expandProgress
    toW = toWidth
    toH = toHeight
    publish {
      targetExpanded = false
      phase = .collapsing
      secondaryInLayout = false
    }
    mode = .collapsing
    beginDisplayLink()
  }

  private func beginExpand(toWidth: CGFloat, toHeight: CGFloat) {
    fromW = width
    fromH = height
    fromContent = contentProgress
    fromExpand = expandProgress
    toW = toWidth
    toH = toHeight
    publish {
      targetExpanded = true
      phase = .expanding
      // 展开期副岛已不在布局；圆角从胶囊起算
      secondaryInLayout = false
      mergeProgress = 1
      if expandProgress < 0.001 { expandProgress = 0 }
    }
    mode = .expanding
    // merge→expand 同一次 DisplayLink 无缝接续，避免回调内 invalidate 掉帧
    resumeOrBeginDisplayLink()
  }

  /// 已在跑则只重置时间轴；否则新建 DisplayLink
  private func resumeOrBeginDisplayLink() {
    if displayLink != nil || fallbackTimer != nil {
      startMedia = CACurrentMediaTime()
      isAnimating = true
    } else {
      beginDisplayLink()
    }
  }

  private func resetMergeVisuals(secondaryVisible: Bool) {
    mergeProgress = 0
    mainRightStretch = 0
    secondaryOffsetX = 0
    secondaryScale = 1
    secondaryTextOpacity = 1
    bridgeProgress = 0
    secondaryInLayout = secondaryVisible
  }

  /// 启动与屏幕刷新对齐的 DisplayLink（最高 120fps；macOS 须从 NSScreen 取）
  private func beginDisplayLink() {
    stopDisplayLink()
    isAnimating = true
    startMedia = CACurrentMediaTime()
    if let screen = NSScreen.main {
      let link = screen.displayLink(target: self, selector: #selector(onDisplayTick(_:)))
      // ProMotion：尽量 120；普通屏回落到 60
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
      link.add(to: .main, forMode: .common)
      displayLink = link
    } else {
      // 无屏幕时退回高频 Timer，仍高于旧 60fps
      let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] _ in
        guard let self else { return }
        self.tick(t: CACurrentMediaTime() - self.startMedia)
        self.onFrame?()
      }
      RunLoop.main.add(timer, forMode: .common)
      fallbackTimer = timer
    }
  }

  @objc private func onDisplayTick(_ link: CADisplayLink) {
    // 用 timestamp 做时间轴，避免 Timer 抖动；targetTimestamp 可做预测插值
    let now = link.targetTimestamp
    let t = now - startMedia
    tick(t: t)
    onFrame?()
  }

  private func tick(t: CFTimeInterval) {
    switch mode {
    case .merging:
      publish { applyMerge(t: t) }
      if t >= mergeDuration {
        // Merged → 立刻顺势 Expand（无停顿）
        publish {
          mainRightStretch = 0
          secondaryOffsetX = -mergeTravel
          secondaryScale = 0.01
          secondaryTextOpacity = 0
          bridgeProgress = 0
          mergeProgress = 1
          secondaryInLayout = false
          width = max(width, fromW)
        }
        beginExpand(toWidth: pendingExpandW, toHeight: pendingExpandH)
      }
    case .expanding:
      publish { applyExpand(t: t) }
      if t >= expandDuration {
        finish(w: toW, h: toH, content: 1, phase: .expanded)
      }
    case .collapsing:
      publish { applyCollapse(t: t) }
      if t >= collapseDuration {
        publish { resetMergeVisuals(secondaryVisible: true) }
        finish(w: toW, h: toH, content: 0, phase: .collapsed)
      }
    case .idle:
      stopDisplayLink()
    }
  }

  private func finish(w: CGFloat, h: CGFloat, content: CGFloat, phase: IslandAnimationPhase) {
    publish {
      width = w
      height = h
      contentProgress = content
      expandProgress = (phase == .expanded) ? 1 : 0
      self.phase = phase
      isAnimating = false
    }
    mode = .idle
    stopDisplayLink()
    onFrame?()
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
    fallbackTimer?.invalidate()
    fallbackTimer = nil
  }

  /// 单帧内批量变更，只触发一次 SwiftUI 刷新
  private func publish(_ body: () -> Void) {
    objectWillChange.send()
    body()
  }

  // MARK: Merge — mergeProgress 0→1

  private func applyMerge(t: CFTimeInterval) {
    // merge 阶段保持胶囊外形，不提前变成面板圆角
    expandProgress = 0
    let u = CGFloat(min(1, max(0, t / mergeDuration)))
    // 前快后慢：副岛被吸引
    let p = mergeEase(u)
    mergeProgress = p

    // 位移：全程向左
    secondaryOffsetX = -mergeTravel * p

    // 桥：0.3–0.85 最强
    if p < 0.30 {
      bridgeProgress = 0
    } else if p < 0.55 {
      bridgeProgress = smoothstep((p - 0.30) / 0.25)
    } else if p < 0.85 {
      bridgeProgress = 1
    } else {
      bridgeProgress = 1 - smoothstep((p - 0.85) / 0.15)
    }

    // 主岛右缘：0.4 开始伸，0.7 峰值，1.0 回收并带吸收反馈
    if p < 0.40 {
      mainRightStretch = 0
    } else if p < 0.70 {
      mainRightStretch = absorbStretchPeak * 0.55 * smoothstep((p - 0.40) / 0.30)
    } else if p < 0.88 {
      // 吸收峰值
      let s = (p - 0.70) / 0.18
      mainRightStretch = lerp(absorbStretchPeak * 0.55, absorbStretchPeak, smoothstep(s))
    } else {
      // settle 回 0，略带回弹抑制
      let s = (p - 0.88) / 0.12
      mainRightStretch = absorbStretchPeak * (1 - smoothstep(s))
    }

    // 数字：50%–70% 后 fade
    if p < 0.50 {
      secondaryTextOpacity = 1
      secondaryScale = 1
    } else if p < 0.75 {
      let s = smoothstep((p - 0.50) / 0.25)
      secondaryTextOpacity = 1 - s
      secondaryScale = lerp(1, 0.85, s)
    } else {
      secondaryTextOpacity = 0
      let s = smoothstep((p - 0.75) / 0.25)
      secondaryScale = lerp(0.85, 0.15, s)
    }
  }

  /// 前半快、近岛时减速（吸引感）
  private func mergeEase(_ u: CGFloat) -> CGFloat {
    let x = min(1, max(0, u))
    // easeOutQuint：起步更快、收束更软，高帧率下更顺
    return 1 - pow(1 - x, 5)
  }

  // MARK: Expand

  private func applyExpand(t: CFTimeInterval) {
    let u = CGFloat(min(1, max(0, t / expandDuration)))
    width = fromW + (toW - fromW) * expandWidthFactor(u)
    height = fromH + (toH - fromH) * expandHeightFactor(u)
    // 与容器同步的外形进度（圆角跟这个走，不是最后一刻切换）
    expandProgress = lerp(fromExpand, 1, smootherstep(u))

    let revealStart = contentRevealDelay
    let revealEnd = revealStart + contentRevealSpan
    if t <= revealStart {
      contentProgress = 0
    } else if t >= revealEnd {
      contentProgress = 1
    } else {
      contentProgress = smootherstep(CGFloat((t - revealStart) / (revealEnd - revealStart)))
    }
  }

  /// 顶部圆角进度：0–50% 完成大部分（尽快像系统顶栏）
  private func topRadiusProgress(_ p: CGFloat) -> CGFloat {
    if p <= 0.50 { return smootherstep(p / 0.50) }
    return 1
  }

  /// 底部圆角进度：拉满到 ~80%
  private func bottomRadiusProgress(_ p: CGFloat) -> CGFloat {
    if p <= 0.80 { return smootherstep(p / 0.80) }
    return 1
  }

  /// 宽度：前段快速铺开，中段到位，末段极轻 settle（幅度压低，避免高刷下抖）
  private func expandWidthFactor(_ u: CGFloat) -> CGFloat {
    if u <= 0.22 { return lerp(0, 0.68, smootherstep(u / 0.22)) }
    if u <= 0.72 { return lerp(0.68, 1.0, smootherstep((u - 0.22) / 0.50)) }
    let s = (u - 0.72) / 0.28
    return 1.0 + 0.0035 * exp(-5 * s) * sin(s * .pi * 2.5)
  }

  /// 高度：略滞后于宽度，形成「先横后纵」系统感
  private func expandHeightFactor(_ u: CGFloat) -> CGFloat {
    if u <= 0.22 { return lerp(0, 0.08, smootherstep(u / 0.22)) }
    if u <= 0.72 { return lerp(0.08, 0.988, smootherstep((u - 0.22) / 0.50)) }
    let s = (u - 0.72) / 0.28
    return lerp(0.988, 1.0, smootherstep(s)) + 0.004 * exp(-5.5 * s) * sin(s * .pi * 2.5)
  }

  // MARK: Collapse

  private func applyCollapse(t: CFTimeInterval) {
    if t <= contentOutDuration {
      contentProgress = fromContent * (1 - smootherstep(CGFloat(t / contentOutDuration)))
    } else {
      contentProgress = 0
    }
    if t < shapeCollapseDelay {
      width = fromW
      height = fromH
      // 内容先退时圆角已开始缓慢回胶囊
      let early = smootherstep(CGFloat(t / max(shapeCollapseDelay, 0.001)))
      expandProgress = fromExpand * (1 - early * 0.2)
      return
    }
    let shapeDur = max(0.14, collapseDuration - shapeCollapseDelay)
    let u = CGFloat(min(1, max(0, (t - shapeCollapseDelay) / shapeDur)))
    let hProgress = smootherstep(min(1, u / 0.92))
    let wProgress: CGFloat
    if u <= 0.12 {
      wProgress = smootherstep(u / 0.12) * 0.16
    } else {
      wProgress = lerp(0.16, 1.0, smootherstep((u - 0.12) / 0.88))
    }
    width = fromW + (toW - fromW) * wProgress
    height = fromH + (toH - fromH) * hProgress
    // 四角连续趋同回胶囊（与尺寸同步，禁止最后一帧硬切）
    expandProgress = fromExpand * (1 - smootherstep(u))
  }

  private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }

  private func smoothstep(_ t: CGFloat) -> CGFloat {
    let x = min(1, max(0, t))
    return x * x * (3 - 2 * x)
  }

  /// 比 smoothstep 更软的两端（一阶/二阶导为 0），高帧率插值更顺
  private func smootherstep(_ t: CGFloat) -> CGFloat {
    let x = min(1, max(0, t))
    return x * x * x * (x * (x * 6 - 15) + 10)
  }

  deinit { stopDisplayLink() }
}
