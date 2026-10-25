import AppKit

/// Atolla 灵动岛：展示运行中数字人，点击跳转管理台。
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var island: IslandPanelController?
  private var statusItem: NSStatusItem?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    let ctrl = IslandPanelController()
    island = ctrl
    ctrl.show()
    setupMenuBar()
  }

  /** 只有浮层、没有普通窗口时也不要自动退出。 */
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  private func setupMenuBar() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let btn = item.button {
      btn.image = Self.statusBarLogo
      btn.imagePosition = .imageOnly
      btn.toolTip = "Atolla Island"
    }
    let menu = NSMenu()
    menu.addItem(NSMenuItem(title: "打开管理台", action: #selector(openAdmin), keyEquivalent: "o"))
    menu.addItem(NSMenuItem(title: "重新读取凭证", action: #selector(reloadConfig), keyEquivalent: "r"))
    let layoutItem = NSMenuItem(
      title: "灵动岛布局设置…",
      action: #selector(openIslandLayoutSettings),
      keyEquivalent: "l"
    )
    layoutItem.target = self
    layoutItem.toolTip = "设置灵动岛尺寸、位置与四周边距"
    menu.addItem(layoutItem)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q"))
    item.menu = menu
    statusItem = item
  }

  private static let statusBarLogo: NSImage? = {
    guard let imageURL = Bundle.module.url(
      forResource: "brand-jellyfish-white",
      withExtension: "png"
    ), let image = NSImage(contentsOf: imageURL) else {
      return nil
    }

    let iconSize = NSSize(width: 18, height: 18)
    let tintedImage = NSImage(size: iconSize)
    tintedImage.lockFocus()
    image.draw(
      in: NSRect(origin: .zero, size: iconSize),
      from: NSRect(origin: .zero, size: image.size),
      operation: .sourceOver,
      fraction: 1
    )
    if let context = NSGraphicsContext.current?.cgContext {
      context.setBlendMode(.sourceIn)
      context.setFillColor(NSColor.black.cgColor)
      context.fill(CGRect(origin: .zero, size: iconSize))
    }
    tintedImage.unlockFocus()

    // 顶部状态栏为白色，固定使用黑色品牌图标以确保可见性，不使用会自动反色的模板图标。
    tintedImage.isTemplate = false
    return tintedImage
  }()

  @objc private func openAdmin() {
    let cfg = IslandConfig.load() ?? .defaults()
    if let url = URL(string: cfg.web_base) {
      NSWorkspace.shared.open(url)
    }
  }

  @objc private func reloadConfig() {
    NotificationCenter.default.post(name: Notification.Name("AtollaIslandReload"), object: nil)
  }

  @objc private func openIslandLayoutSettings() {
    island?.showLayoutSettings()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
