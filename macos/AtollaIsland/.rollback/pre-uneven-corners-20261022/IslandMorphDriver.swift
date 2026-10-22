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

/// 几何 morph + 副岛 mergeProgress 驱动（单一 Timer，可打断）。
final class IslandMorphDriver: ObservableObject {
  @Published private(set) var width: CGFloat = 185
  @Published private(set) var height: CGFloat = 32
  @Published private(set) var contentProgress: CGFloat = 0
  @Published private(set) var targetExpanded = false
  @Published private(set) var isAnimating = false
  @Published private(set) var phase: IslandAnimationPhase = .collapsed

  // MARK: Merge 驱动量（0…1）

  @Published private(set) var mergeProgress: CGFloat = 0
  /// 主岛右缘拉伸（pt），左缘保持不动
  @Published private(set) var mainRightStretch: CGFloat = 0
  /// 副岛中心相对静止位的水平位移（负值 = 向主岛）
  @Published private(set) var secondaryOffsetX: CGFloat = 0
  @Published private(set) var secondaryScale: CGFloat = 1
  @Published private(set) var secondaryTextOpacity: CGFloat = 1
  /// 液态桥强度 0…1
  @Published private(set) var bridgeProgress: CGFloat = 0
  /// merge 完成前仍参与布局；完成后移除
  @Published private(set) var secondaryInLayout: Bool = true

  private var timer: Timer?
  private var startMedia: CFTimeInterval = 0
  private var mode: Mode = .idle

  private var fromW: CGFloat = 0
  private var fromH: CGFloat = 0
  private var toW: CGFloat = 0
  private var toH: CGFloat = 0
  private var fromContent: CGFloat = 0

  /// merge 完成后立刻 expand 的目标
  private var pendingExpandW: CGFloat = 0
  private var pendingExpandH: CGFloat = 0
  private var mergeTravel: CGFloat = 0

  private enum Mode { case idle, merging, expanding, collapsing }

  // MARK: 可调参数

  var expandDuration: CFTimeInterval = 0.225
  var collapseDuration: CFTimeInterval = 0.202
  var contentRevealDelay: CFTimeInterval = 0.06
  var contentRevealSpan: CFTimeInterval = 0.112
  var contentOutDuration: CFTimeInterval = 0.037
  var shapeCollapseDelay: CFTimeInterval = 0.045

  /// 副岛合并总时长（随后无缝接 expand）
  var mergeDuration: CFTimeInterval = 0.22
  /// 吸收瞬间右缘最大拉伸
  var absorbStretchPeak: CGFloat = 12
  /// 副岛向左移动的总行程（gap + 半径 + 吞入）
  var mergeOverlap: CGFloat = 10

  static let expandedRadius: CGFloat = 24

  var cornerRadius: CGFloat {
    min(max(height / 2, 0), Self.expandedRadius)
  }

  /// 交互锁：merge / expand / collapse 中禁止再点副岛
  var blocksSecondaryTap: Bool {
    phase == .merging || phase == .expanding || phase == .expanded || phase == .collapsing || isAnimating
  }

  func syncIdle(width w: CGFloat, height h: CGFloat, expanded: Bool) {
    guard !isAnimating else { return }
    width = w
    height = h
    contentProgress = expanded ? 1 : 0
    targetExpanded = expanded
    phase = expanded ? .expanded : .collapsed
    resetMergeVisuals(secondaryVisible: !expanded)
  }

  /// 主岛点击：直接展开（跳过副岛 merge）
  func expand(toWidth: CGFloat, toHeight: CGFloat) {
    guard phase == .collapsed, !isAnimating else { return }
    secondaryInLayout = false
    resetMergeVisuals(secondaryVisible: false)
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
    mergeProgress = 0
    secondaryInLayout = true
    resetMergeVisuals(secondaryVisible: true)
    targetExpanded = true
    phase = .merging
    mode = .merging
    begin()
  }

  func collapse(toWidth: CGFloat, toHeight: CGFloat) {
    if phase == .merging { return }
    fromW = width
    fromH = height
    fromContent = contentProgress
    toW = toWidth
    toH = toHeight
    targetExpanded = false
    phase = .collapsing
    mode = .collapsing
    secondaryInLayout = false
    begin()
  }

  private func beginExpand(toWidth: CGFloat, toHeight: CGFloat) {
    fromW = width
    fromH = height
    fromContent = contentProgress
    toW = toWidth
    toH = toHeight
    targetExpanded = true
    phase = .expanding
    mode = .expanding
    // 展开期副岛已不在布局
    secondaryInLayout = false
    mergeProgress = 1
    begin()
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

  private func begin() {
    timer?.invalidate()
    isAnimating = true
    startMedia = CACurrentMediaTime()
    let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      self?.tick()
    }
    self.timer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func tick() {
    let t = CACurrentMediaTime() - startMedia
    switch mode {
    case .merging:
      applyMerge(t: t)
      if t >= mergeDuration {
        // Merged → 立刻顺势 Expand（无停顿）
        mainRightStretch = 0
        secondaryOffsetX = -mergeTravel
        secondaryScale = 0.01
        secondaryTextOpacity = 0
        bridgeProgress = 0
        mergeProgress = 1
        secondaryInLayout = false
        width = max(width, fromW) // keep
        beginExpand(toWidth: pendingExpandW, toHeight: pendingExpandH)
      }
    case .expanding:
      applyExpand(t: t)
      if t >= expandDuration {
        finish(w: toW, h: toH, content: 1, phase: .expanded)
      }
    case .collapsing:
      applyCollapse(t: t)
      if t >= collapseDuration {
        resetMergeVisuals(secondaryVisible: true)
        finish(w: toW, h: toH, content: 0, phase: .collapsed)
      }
    case .idle:
      stopTimer()
    }
  }

  private func finish(w: CGFloat, h: CGFloat, content: CGFloat, phase: IslandAnimationPhase) {
    width = w
    height = h
    contentProgress = content
    self.phase = phase
    isAnimating = false
    mode = .idle
    stopTimer()
  }

  private func stopTimer() {
    timer?.invalidate()
    timer = nil
  }

  // MARK: Merge — mergeProgress 0→1

  private func applyMerge(t: CFTimeInterval) {
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
    // easeOutCubic 偏快起步
    let x = min(1, max(0, u))
    return 1 - pow(1 - x, 3)
  }

  // MARK: Expand

  private func applyExpand(t: CFTimeInterval) {
    let u = CGFloat(min(1, max(0, t / expandDuration)))
    width = fromW + (toW - fromW) * expandWidthFactor(u)
    height = fromH + (toH - fromH) * expandHeightFactor(u)

    let revealStart = contentRevealDelay
    let revealEnd = revealStart + contentRevealSpan
    if t <= revealStart {
      contentProgress = 0
    } else if t >= revealEnd {
      contentProgress = 1
    } else {
      contentProgress = smoothstep(CGFloat((t - revealStart) / (revealEnd - revealStart)))
    }
  }

  private func expandWidthFactor(_ u: CGFloat) -> CGFloat {
    if u <= 0.25 { return lerp(0, 0.72, smoothstep(u / 0.25)) }
    if u <= 0.70 { return lerp(0.72, 1.0, smoothstep((u - 0.25) / 0.45)) }
    let s = (u - 0.70) / 0.30
    return 1.0 + 0.005 * exp(-4 * s) * sin(s * .pi * 3)
  }

  private func expandHeightFactor(_ u: CGFloat) -> CGFloat {
    if u <= 0.25 { return lerp(0, 0.10, smoothstep(u / 0.25)) }
    if u <= 0.70 { return lerp(0.10, 0.985, smoothstep((u - 0.25) / 0.45)) }
    let s = (u - 0.70) / 0.30
    return lerp(0.985, 1.0, smoothstep(s)) + 0.006 * exp(-4.5 * s) * sin(s * .pi * 3)
  }

  // MARK: Collapse

  private func applyCollapse(t: CFTimeInterval) {
    if t <= contentOutDuration {
      contentProgress = fromContent * (1 - smoothstep(CGFloat(t / contentOutDuration)))
    } else {
      contentProgress = 0
    }
    if t < shapeCollapseDelay {
      width = fromW
      height = fromH
      return
    }
    let shapeDur = max(0.12, collapseDuration - shapeCollapseDelay)
    let u = CGFloat(min(1, max(0, (t - shapeCollapseDelay) / shapeDur)))
    let hProgress = smoothstep(min(1, u / 0.90))
    let wProgress: CGFloat
    if u <= 0.15 {
      wProgress = smoothstep(u / 0.15) * 0.20
    } else {
      wProgress = lerp(0.20, 1.0, smoothstep((u - 0.15) / 0.85))
    }
    width = fromW + (toW - fromW) * wProgress
    height = fromH + (toH - fromH) * hProgress
  }

  private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }

  private func smoothstep(_ t: CGFloat) -> CGFloat {
    let x = min(1, max(0, t))
    return x * x * (3 - 2 * x)
  }

  deinit { stopTimer() }
}
