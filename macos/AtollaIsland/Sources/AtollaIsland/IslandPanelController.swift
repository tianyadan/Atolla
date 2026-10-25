import AppKit
import QuartzCore
import SwiftUI

/// 面板尺寸逐帧跟随 morph，位置与缩放由用户布局偏好叠加控制。
final class IslandPanelController {
  private var panel: NSPanel?
  private let model = IslandViewModel()
  private var hosting: NSHostingView<IslandRootView>?
  private var idleLink: CADisplayLink?
  private var notch = NotchGeometry.resolve()
  private var layout = IslandLayout.default
  private let layoutStore = IslandLayoutStore()
  private var layoutEditStart: IslandLayout?
  private var lastFrame: CGRect = .null
  private lazy var layoutEditor = IslandLayoutEditor(
    layout: layout,
    onMove: { [weak self] translation, completed in
      self?.moveLayout(by: translation, completed: completed)
    },
    onResize: { [weak self] edge, translation, completed in
      self?.resizeLayout(edge: edge, by: translation, completed: completed)
    },
    onToggleAspectRatio: { [weak self] in
      self?.toggleAspectRatioLock()
    },
    onReset: { [weak self] in
      self?.resetLayout()
    }
  )

  func show() {
    model.start()
    refreshNotch(loadLayout: true)
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

    let root = IslandRootView(model: model, morph: model.morph, layoutEditor: layoutEditor, notch: notch)
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

    syncSize(force: true)
    panel.orderFrontRegardless()

    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.refreshNotch(loadLayout: true)
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

  private func refreshNotch(loadLayout: Bool) {
    notch = NotchGeometry.resolve()
    model.notchWidth = notch.width
    model.notchHeight = notch.height
    if loadLayout {
      layout = layoutStore.load(displayID: displayID)
      layoutEditor.update(layout: layout)
    }
  }

  private func rebuildRoot() {
    guard let hosting else { return }
    hosting.rootView = IslandRootView(model: model, morph: model.morph, layoutEditor: layoutEditor, notch: notch)
  }

  private func syncSize(force: Bool) {
    let morph = model.morph
    // 收起态统一宽度（与有活动时一致），不再因「无角标」换成更宽的整段刘海
    let collapsedChrome = morph.phase == .collapsed || morph.phase == .merging || morph.contentProgress < 0.35
    let stretch = (morph.phase == .merging) ? morph.mainRightStretch : 0
    let contentSize: CGSize
    if collapsedChrome {
      contentSize = CGSize(
        width: notch.width + stretch + 2 * IslandMetrics.badgeSideExtra,
        height: max(morph.height, IslandMetrics.badgeSize)
      )
    } else {
      contentSize = CGSize(width: max(morph.width, notch.width), height: morph.height)
    }

    let animating = morph.isAnimating
    var frame = layout.frame(contentSize: contentSize, screenFrame: notch.screen.frame)
    // 动画期保留亚像素，减少 ceil 量化跳变；静止再对齐整像素。
    if !animating {
      frame = CGRect(x: round(frame.origin.x), y: round(frame.origin.y), width: ceil(frame.width), height: ceil(frame.height))
    }

    if !force {
      let eps: CGFloat = animating ? 0.05 : 0.5
      if abs(frame.origin.x - lastFrame.origin.x) < eps,
         abs(frame.origin.y - lastFrame.origin.y) < eps,
         abs(frame.width - lastFrame.width) < eps,
         abs(frame.height - lastFrame.height) < eps {
        return
      }
    }
    lastFrame = frame
    applyFrame(frame: frame, animating: animating)
    panel?.ignoresMouseEvents = false
  }

  /// 每帧直接贴合 morph 与布局偏好，不做第二套弹簧，避免和 SwiftUI 抢帧。
  private func applyFrame(frame: CGRect, animating: Bool) {
    guard let panel else { return }
    // 动画期 display:false，交给下一帧合成，减轻主线程卡顿
    panel.setFrame(frame, display: !animating)
    if animating {
      panel.contentView?.needsDisplay = true
    }
  }

  private var displayID: String {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    if let number = notch.screen.deviceDescription[key] as? NSNumber {
      return number.stringValue
    }
    return "\(notch.screen.localizedName)-\(notch.screen.frame.width)x\(notch.screen.frame.height)"
  }

  private func currentContentSize() -> CGSize {
    let morph = model.morph
    let collapsedChrome = morph.phase == .collapsed || morph.phase == .merging || morph.contentProgress < 0.35
    if collapsedChrome {
      let stretch = morph.phase == .merging ? morph.mainRightStretch : 0
      return CGSize(
        width: notch.width + stretch + 2 * IslandMetrics.badgeSideExtra,
        height: max(morph.height, IslandMetrics.badgeSize)
      )
    }
    return CGSize(width: max(morph.width, notch.width), height: morph.height)
  }

  private func moveLayout(by translation: CGSize, completed: Bool) {
    updateLayout(completed: completed) { startingLayout in
      startingLayout.moved(by: translation, contentSize: currentContentSize(), screenFrame: notch.screen.frame)
    }
  }

  private func resizeLayout(edge: IslandResizeEdge, by translation: CGSize, completed: Bool) {
    updateLayout(completed: completed) { startingLayout in
      startingLayout.resized(
        edge: edge,
        translation: translation,
        contentSize: currentContentSize(),
        screenFrame: notch.screen.frame
      )
    }
  }

  private func updateLayout(completed: Bool, transform: (IslandLayout) -> IslandLayout) {
    if layoutEditStart == nil {
      layoutEditStart = layout
    }
    guard let layoutEditStart else { return }
    layout = transform(layoutEditStart)
    layoutEditor.update(layout: layout)
    syncSize(force: true)
    if completed {
      layoutStore.save(layout, displayID: displayID)
      self.layoutEditStart = nil
    }
  }

  private func toggleAspectRatioLock() {
    layout.isAspectRatioLocked.toggle()
    layoutEditor.update(layout: layout)
    layoutStore.save(layout, displayID: displayID)
  }

  private func resetLayout() {
    layoutEditStart = nil
    layout = .default
    layoutEditor.update(layout: layout)
    layoutStore.save(layout, displayID: displayID)
    syncSize(force: true)
  }
}
