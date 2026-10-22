import AppKit
import QuartzCore
import SwiftUI

/// 钉在刘海：窗口尺寸每帧跟随 morph.width/height，顶边 + 中轴锁定（无独立 popup 窗口感）。
final class IslandPanelController {
  private var panel: NSPanel?
  private let model = IslandViewModel()
  private var hosting: NSHostingView<IslandRootView>?
  private var idleLink: CADisplayLink?
  private var notch = NotchGeometry.resolve()
  private var lastSize: CGSize = .zero

  func show() {
    model.start()
    refreshNotch()
    model.morph.syncIdle(width: notch.width, height: notch.height, expanded: false)

    // morph 每帧 vsync 回调：动画期与插值同相位贴窗
    model.morph.onFrame = { [weak self] in
      self?.syncSize(force: false)
    }

    NotificationCenter.default.addObserver(
      forName: Notification.Name("AtollaIslandReload"),
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.model.reloadConfig()
      Task { await self.model.refresh() }
    }

    let root = IslandRootView(model: model, morph: model.morph, notch: notch)
    let view = NSHostingView(rootView: root)
    hosting = view

    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: notch.width, height: notch.height),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.isFloatingPanel = true
    panel.level = .mainMenu + 2
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.acceptsMouseMovedEvents = true
    panel.animationBehavior = .none
    panel.contentView = view
    self.panel = panel

    applyFrame(size: CGSize(width: notch.width, height: notch.height), animating: false)
    panel.orderFrontRegardless()

    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.refreshNotch()
      self?.rebuildRoot()
      self?.syncSize(force: true)
    }

    // 空闲期低频对齐（动画期走 morph.onFrame，避免双时钟打架）
    let link = panel.displayLink(target: self, selector: #selector(onIdleTick(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: 30, preferred: 15)
    link.add(to: .main, forMode: .common)
    idleLink = link
  }

  @objc private func onIdleTick(_ link: CADisplayLink) {
    // 动画中由 morph.onFrame 驱动，此处跳过以免错相位
    guard !model.morph.isAnimating else { return }
    syncSize(force: false)
  }

  private func refreshNotch() {
    notch = NotchGeometry.resolve()
    model.notchWidth = notch.width
    model.notchHeight = notch.height
  }

  private func rebuildRoot() {
    guard let hosting else { return }
    hosting.rootView = IslandRootView(model: model, morph: model.morph, notch: notch)
  }

  private func syncSize(force: Bool) {
    let morph = model.morph
    // 收起态统一宽度（与有活动时一致），不再因「无角标」换成更宽的整段刘海
    let collapsedChrome = morph.phase == .collapsed || morph.phase == .merging || morph.contentProgress < 0.35
    let stretch = (morph.phase == .merging) ? morph.mainRightStretch : 0
    let w: CGFloat
    let h: CGFloat
    if collapsedChrome {
      w = notch.width + stretch + 2 * IslandMetrics.badgeSideExtra
      h = max(morph.height, IslandMetrics.badgeSize)
    } else {
      w = max(morph.width, notch.width)
      h = morph.height
    }

    let animating = morph.isAnimating
    // 动画期保留亚像素，减少 ceil 量化跳变；静止再对齐整像素
    let size = animating
      ? CGSize(width: w, height: h)
      : CGSize(width: ceil(w), height: ceil(h))

    if !force {
      let eps: CGFloat = animating ? 0.05 : 0.5
      if abs(size.width - lastSize.width) < eps,
         abs(size.height - lastSize.height) < eps {
        return
      }
    }
    lastSize = size
    applyFrame(size: size, animating: animating)
    panel?.ignoresMouseEvents = false
  }

  /// 每帧直接贴合 morph，顶边/中轴锁定（不做第二套弹簧，避免和 SwiftUI 抢）
  private func applyFrame(size: CGSize, animating: Bool) {
    guard let panel else { return }
    let x = notch.midX - size.width / 2
    let y = notch.topY - size.height
    let rect = NSRect(x: x, y: y, width: size.width, height: size.height)
    // 动画期 display:false，交给下一帧合成，减轻主线程卡顿
    panel.setFrame(rect, display: !animating)
    if animating {
      panel.contentView?.needsDisplay = true
    }
  }
}
