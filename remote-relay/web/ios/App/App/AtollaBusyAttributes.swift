import ActivityKit
import Foundation

/// Live Activity 固定属性（App + Widget 共用同一源文件）
struct AtollaBusyAttributes: ActivityAttributes {
  /// 单个灵动岛事件摘要（最多同步 5 条）
  struct IslandItemSlice: Codable, Hashable {
    var id: String
    var kind: String
    var agentName: String
    var department: String
    /// unix 秒；0 表示未知
    var occurredAt: Double
    /// 毫秒；负数表示未知
    var durationMs: Int
    var summary: String
    var deepLink: String
    var jellyColor: String
  }

  /// 内容态：最高优先级事件列表 + 动画相位。
  public struct ContentState: Codable, Hashable {
    var activeKind: String
    var count: Int
    var items: [IslandItemSlice]
    var animPhase: Int
    var updatedAt: Double
  }

  var sessionId: String
}
