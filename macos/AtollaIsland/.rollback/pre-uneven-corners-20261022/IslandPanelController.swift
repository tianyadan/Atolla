import AppKit
import SwiftUI

/// 钉在刘海：窗口尺寸每帧跟随 morph.width/height，顶边 + 中轴锁定（无独立 popup 窗口感）。
final class IslandPanelController {
  private var panel: NSPanel?
  private let model = IslandViewModel()
  private var hosting: NSHostingView<IslandRootView>?
  private var tick: Timer?
  private var notch = NotchGeometry.resolve()
  private var lastSize: CGSize = .zero

  func show() {
    model.start()
    refreshNotch()
    model.morph.syncIdle(width: notch.width, height: notch.height, expanded: false)

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

    applyFrame(size: CGSize(width: notch.width, height: notch.height))
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

    tick = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      self?.syncSize(force: false)
    }
    if let tick { RunLoop.main.add(tick, forMode: .common) }
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
    let needBadgePad = morph.secondaryInLayout || morph.phase == .merging
    let stretch = (morph.phase == .merging) ? morph.mainRightStretch : 0
    let w: CGFloat = needBadgePad
      ? max(morph.width + stretch, notch.width + 2 * IslandMetrics.badgeSideExtra)
      : max(morph.width, notch.width)
    let h: CGFloat = needBadgePad
      ? max(morph.height, IslandMetrics.badgeSize)
      : morph.height
    let size = CGSize(width: ceil(w), height: ceil(h))

    if !force,
       abs(size.width - lastSize.width) < 0.5,
       abs(size.height - lastSize.height) < 0.5 {
      return
    }
    lastSize = size
    applyFrame(size: size)
    panel?.ignoresMouseEvents = false
  }

  /// 每帧直接贴合 morph，顶边/中轴锁定（不做第二套弹簧，避免和 SwiftUI 抢）
  private func applyFrame(size: CGSize) {
    guard let panel else { return }
    let x = notch.midX - size.width / 2
    let y = notch.topY - size.height
    panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
  }
}
