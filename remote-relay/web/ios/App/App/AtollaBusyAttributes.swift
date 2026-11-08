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
    /// 审批截止 unix 秒；0 表示未知（仅 approval）
    var expiresAt: Double
    /// 毫秒；负数表示未知
    var durationMs: Int
    var summary: String
    /// 工作状态文案：正在思考 / 正在执行 git …
    var workStatus: String
    var deepLink: String
    var jellyColor: String
    /// 任务规划进度 0…100（task_plan 重点模式）
    var progress: Int
    var planPhase: String
    var planStepTitle: String
    var planCurrent: Int
    var planTotal: Int
  }

  /// 内容态：最高优先级事件列表 + 动画相位 + 展示模式。
  public struct ContentState: Codable, Hashable {
    var activeKind: String
    var count: Int
    var items: [IslandItemSlice]
    var animPhase: Int
    var updatedAt: Double
    /// list | task_plan
    var presentation: String
    /// 「还有 N 项」跳数字人列表
    var moreDeepLink: String
    /// App 进后台后同步暂停：保留最后真实进度，不再伪造跳动
    var syncPaused: Bool
  }

  var sessionId: String
}
