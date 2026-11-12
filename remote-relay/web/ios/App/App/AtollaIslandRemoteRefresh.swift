import ActivityKit
import Foundation
import os.log

/**
 * 锁屏 / 后台时不依赖 WebView：原生拉镜像校准灵动岛。
 * - 运行中 agent 已空闲 → 立刻 end Live Activity（避免结束后仍计时）
 * - 仍忙碌 → 用 current_task / progress 刷新文案
 */
enum AtollaIslandRemoteRefresh {
  private static let log = OSLog(subsystem: "com.atolla.relay", category: "IslandRefresh")

  /// 与 JS agentBusy 对齐的忙碌判定
  static func isBusyStatus(_ raw: String) -> Bool {
    let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return [
      "running", "busy", "initializing", "compressing", "waiting", "插话中",
    ].contains(s)
  }

  /// 从事件 id（running:agentId）取出 agentId
  static func agentId(fromItemId id: String) -> String {
    if let idx = id.firstIndex(of: ":") {
      return String(id[id.index(after: idx)...])
    }
    return id
  }

  /// 校准所有 active Live Activity；有变更返回 true
  @available(iOS 16.2, *)
  @MainActor
  static func reconcile() async -> Bool {
    let activities = Activity<AtollaBusyAttributes>.activities.filter { $0.activityState == .active }
    guard !activities.isEmpty else { return false }

    let agents: [AtollaAgentRecord]
    do {
      agents = try await AtollaRelayClient.shared.fetchAgents()
    } catch {
      os_log(
        "island reconcile fetch failed: %{public}@",
        log: log,
        type: .info,
        error.localizedDescription
      )
      return false
    }

    let busyAgents = agents.filter { $0.working || isBusyStatus($0.status) }
    let busyById = Dictionary(uniqueKeysWithValues: busyAgents.map { ($0.agentID, $0) })
    var changed = false

    for activity in activities {
      let kind = activity.content.state.activeKind
      // 仅校准运行类；报错/审批仍等 JS（需更多 payload）
      guard kind == "running" || kind == "task_plan" else { continue }

      if busyAgents.isEmpty {
        await endActivity(activity, reason: "native-idle")
        changed = true
        continue
      }

      var state = activity.content.state
      var items = state.items
      var itemsChanged = false

      // 去掉已不忙碌的行
      let filtered = items.filter { busyById[agentId(fromItemId: $0.id)] != nil }
      if filtered.count != items.count {
        items = filtered
        itemsChanged = true
      }
      if items.isEmpty {
        await endActivity(activity, reason: "native-items-idle")
        changed = true
        continue
      }

      // 逐条拉 current_task，刷新锁屏文案
      for idx in items.indices {
        let aid = agentId(fromItemId: items[idx].id)
        guard let agent = busyById[aid] else { continue }
        do {
          let detail = try await AtollaRelayClient.shared.fetchAgentStatus(
            instanceID: agent.instanceID,
            agentID: agent.agentID
          )
          if let task = detail.currentTask?.trimmingCharacters(in: .whitespacesAndNewlines),
             !task.isEmpty,
             task != items[idx].workStatus {
            items[idx].workStatus = String(task.prefix(160))
            items[idx].summary = items[idx].workStatus
            itemsChanged = true
          }
          if let progress = detail.progress {
            let clamped = max(0, min(100, progress))
            if clamped != items[idx].progress {
              items[idx].progress = clamped
              itemsChanged = true
            }
          }
          // 状态文案兜底（无 current_task 时）
          if (items[idx].workStatus.isEmpty || items[idx].workStatus == "running"),
             !detail.status.isEmpty {
            let label = statusLabel(detail.status)
            if label != items[idx].workStatus {
              items[idx].workStatus = label
              items[idx].summary = label
              itemsChanged = true
            }
          }
        } catch {
          // 单条失败不影响其它
        }
      }

      // 后台每次校准都固化耗时，并续期 staleDate
      items = freezeItemDurations(items)
      state.items = items
      state.count = max(busyAgents.count, items.count)
      state.syncPaused = true
      state.updatedAt = Date().timeIntervalSince1970
      let stale = Date().addingTimeInterval(3 * 60)
      await activity.update(ActivityContent(state: state, staleDate: stale))
      changed = true
      if itemsChanged {
        os_log(
          "island reconcile updated id=%{public}@ count=%{public}d",
          log: log,
          type: .info,
          activity.id,
          state.count
        )
      }
    }

    return changed
  }

  /// 固化 running 耗时为 durationMs
  private static func freezeItemDurations(
    _ items: [AtollaBusyAttributes.IslandItemSlice]
  ) -> [AtollaBusyAttributes.IslandItemSlice] {
    let now = Date().timeIntervalSince1970
    return items.map { item in
      var copy = item
      if (item.kind == "running" || item.kind == "task_plan"), item.occurredAt > 0 {
        copy.durationMs = Int(max(0, now - item.occurredAt) * 1000)
      }
      return copy
    }
  }

  private static func statusLabel(_ status: String) -> String {
    switch status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "waiting": return "等待中"
    case "compressing": return "压缩中"
    case "initializing": return "初始化"
    case "插话中": return "插话中"
    default: return "运行中"
    }
  }

  @available(iOS 16.2, *)
  @MainActor
  private static func endActivity(_ activity: Activity<AtollaBusyAttributes>, reason: String) async {
    let done = AtollaBusyAttributes.ContentState(
      activeKind: "",
      count: 0,
      items: [],
      animPhase: 0,
      updatedAt: Date().timeIntervalSince1970,
      presentation: "list",
      moreDeepLink: "",
      syncPaused: false
    )
    await activity.end(ActivityContent(state: done, staleDate: nil), dismissalPolicy: .immediate)
    os_log(
      "island reconcile end id=%{public}@ reason=%{public}@",
      log: log,
      type: .info,
      activity.id,
      reason
    )
  }
}
