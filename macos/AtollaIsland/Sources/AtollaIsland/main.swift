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
      btn.title = "🏝️"
      btn.toolTip = "Atolla Island"
    }
    let menu = NSMenu()
    menu.addItem(NSMenuItem(title: "打开管理台", action: #selector(openAdmin), keyEquivalent: "o"))
    menu.addItem(NSMenuItem(title: "重新读取凭证", action: #selector(reloadConfig), keyEquivalent: "r"))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q"))
    item.menu = menu
    statusItem = item
  }

  @objc private func openAdmin() {
    let cfg = IslandConfig.load() ?? .defaults()
    if let url = URL(string: cfg.web_base) {
      NSWorkspace.shared.open(url)
    }
  }

  @objc private func reloadConfig() {
    NotificationCenter.default.post(name: Notification.Name("AtollaIslandReload"), object: nil)
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
