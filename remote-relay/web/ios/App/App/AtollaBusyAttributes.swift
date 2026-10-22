import ActivityKit
import Foundation

/// Live Activity 固定属性（App + Widget 共用同一源文件）
struct AtollaBusyAttributes: ActivityAttributes {
  /// 单个忙碌数字人摘要（岛上行）
  struct BusyAgentSlice: Codable, Hashable {
    var name: String
    var jellyColor: String
    var statusLabel: String
    /// unix 秒；0 表示未知
    var runStartedAt: Double
  }

  /// 内容态：忙碌列表 + 动画相位（由 App 侧 Timer 驱动，岛上才能「跳」）
  public struct ContentState: Codable, Hashable {
    var count: Int
    var agents: [BusyAgentSlice]
    /// 跳动相位：0=落地 1=腾空（上下弹，不是精灵横滑帧）
    var animPhase: Int
  }

  var sessionId: String
}
