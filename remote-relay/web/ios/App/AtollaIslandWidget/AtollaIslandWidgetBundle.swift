import SwiftUI
import WidgetKit

/// 灵动岛 Live Activity + 桌面 CLI 用量小组件入口
@main
struct AtollaIslandWidgetBundle: WidgetBundle {
  var body: some Widget {
    AtollaBusyLiveActivity()
    AtollaUsageWidget()
  }
}
