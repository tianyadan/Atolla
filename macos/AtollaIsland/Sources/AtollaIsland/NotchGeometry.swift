import AppKit

/// MacBook 刘海几何（MBP 2021+ / 2024）：扁长摄像头切口，不是 iPhone 灵动岛。
struct NotchGeometry {
  let screen: NSScreen
  /// 刘海宽度（点）
  let width: CGFloat
  /// 菜单栏/刘海高度
  let height: CGFloat
  /// 刘海水平中心（全局坐标）
  let midX: CGFloat
  /// 屏幕顶边 y（全局）
  let topY: CGFloat

  /// 优先选带刘海的内建屏；没有则退回 main。
  static func resolve() -> NotchGeometry {
    let screens = NSScreen.screens
    let notched = screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? screens[0]
    return NotchGeometry(screen: notched)
  }

  init(screen: NSScreen) {
    self.screen = screen
    let full = screen.frame
    self.topY = full.maxY

    let safeTop = screen.safeAreaInsets.top
    // 刘海高度 ≈ safeArea.top（本机实测约 32）
    self.height = max(24, safeTop > 0 ? safeTop : 32)

    if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
      // 左右菜单可用区之间的空隙即刘海
      let gapMinX = left.maxX
      let gapMaxX = right.minX
      let w = max(160, gapMaxX - gapMinX)
      self.width = w
      self.midX = (gapMinX + gapMaxX) / 2
    } else if safeTop > 0 {
      // 无 auxiliary 时按常见 MBP 比例估算（约屏宽 12%）
      let w = min(220, max(170, full.width * 0.122))
      self.width = w
      self.midX = full.midX
    } else {
      // 外接屏无刘海：仍居中，用「伪刘海」尺寸
      self.width = 200
      self.midX = full.midX
    }
  }
}
