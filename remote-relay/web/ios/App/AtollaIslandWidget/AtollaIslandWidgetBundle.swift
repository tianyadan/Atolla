import SwiftUI
import WidgetKit

/// 灵动岛 / 锁屏 Live Activity 入口
@main
struct AtollaIslandWidgetBundle: WidgetBundle {
  var body: some Widget {
    AtollaBusyLiveActivity()
  }
}
