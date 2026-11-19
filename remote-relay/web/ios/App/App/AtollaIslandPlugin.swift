import ActivityKit
import Capacitor
import Foundation
import UIKit
import os.log

/**
 * Capacitor 插件：优先级事件 → 单个灵动岛。
 * 当前阶段（无 APNs）：
 * - 前台可创建/更新 Live Activity；
 * - 状态变化时更新，普通运行事件做阈值过滤与短窗口合并；
 * - 进后台后停止轮询，仅保留最后一次真实状态并标记 stale；
 * - 回前台由 JS 立刻校准，前台另有 30s 低频兜底。
 */
@objc(AtollaIslandPlugin)
public class AtollaIslandPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AtollaIslandPlugin"
  public let jsName = "AtollaIsland"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "syncState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
  ]

  private let log = OSLog(subsystem: "com.atolla.relay", category: "Island")
  private let activityIdKey = "atolla.island.activityId"
  private let schemaVersionKey = "atolla.island.schemaVersion"
  private let currentSchemaVersion = 5
  /// 前台超过此时长未收到 JS 同步，视为孤儿活动并下岛
  private let maxOrphanAge: TimeInterval = 180
  private var orphanTimer: Timer?
  private var activeKind: String = ""
  private var lastItems: [AtollaBusyAttributes.IslandItemSlice] = []
  private var lastCount: Int = 0
  private var lastPresentation: String = "list"
  private var lastMoreDeepLink: String = ""
  private var lastJSSyncAt: Date?
  private var syncPaused: Bool = false
  private var lastCommittedState: AtollaBusyAttributes.ContentState?
  private var pendingUpdate: DispatchWorkItem?

  /// 监听前后台：后台停止本地刷新；前台由 Web 层立即校准。
  override public func load() {
    super.load()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(onAppBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(onAppForeground),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )
    if #available(iOS 16.2, *) {
      let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
      os_log("load areActivitiesEnabled=%{public}@", log: log, type: .info, enabled ? "true" : "false")
    }
  }

  @objc private func onAppBackground() {
    Task { @MainActor in
      await self.markSyncPausedForBackground(reason: "didEnterBackground")
    }
  }

  @objc private func onAppForeground() {
    // 先恢复计时展示，随后由 Web 层拉取一次最新业务状态。
    Task { @MainActor in
      await self.clearSyncPausedAndRefresh(reason: "willEnterForeground")
    }
  }

  @objc func isAvailable(_ call: CAPPluginCall) {
    if #available(iOS 16.2, *) {
      let ok = ActivityAuthorizationInfo().areActivitiesEnabled
      os_log("isAvailable=%{public}@", log: log, type: .info, ok ? "true" : "false")
      call.resolve([
        "available": ok,
        "reason": ok ? "" : "系统未开启实时活动（设置 → Atolla → 实时活动）",
      ])
    } else {
      call.resolve(["available": false, "reason": "需要 iOS 16.2+"])
    }
  }

  @objc func syncState(_ call: CAPPluginCall) {
    guard #available(iOS 16.2, *) else {
      call.reject("需要 iOS 16.2+")
      return
    }
    guard let kind = Self.parseActiveKind(call.getString("activeKind")) else {
      call.reject("无效的灵动岛状态")
      return
    }
    let count = call.getInt("count") ?? 0
    let items = Self.parseItems(call.getArray("items", JSObject.self) ?? [])
    let presentation = Self.parsePresentation(call.getString("presentation"))
    let moreDeepLink = Self.clampAtollaLink(call.getString("moreDeepLink"))
    let authEnabled = ActivityAuthorizationInfo().areActivitiesEnabled

    if count <= 0 || items.isEmpty {
      Task { @MainActor in
        os_log("syncState empty → endAll auth=%{public}@", log: self.log, type: .info, authEnabled ? "1" : "0")
        await self.endAllActivitiesNow(reason: "js-empty")
        call.resolve(["ok": true])
      }
      return
    }

    Task { @MainActor in
      do {
        if Self.needsActivityReplacement(
          storedSchemaVersion: UserDefaults.standard.object(forKey: self.schemaVersionKey) as? Int
        ) {
          os_log("schema mismatch → replace activity", log: self.log, type: .info)
          await self.endAllActivitiesNow(reason: "schema-replace")
        }
        // 前台同步视为恢复；后台同步仍保持 paused
        let appActive = UIApplication.shared.applicationState == .active
        self.syncPaused = !appActive
        self.activeKind = kind
        self.lastItems = items
        self.lastCount = max(count, items.count)
        self.lastPresentation = presentation
        self.lastMoreDeepLink = moreDeepLink
        self.noteJSSync()
        let state = self.makeState()
        // 后台延迟 dismiss 后可能仍残留 ended 活动，先清掉再建
        if let existing = self.currentActivity(), existing.activityState == .active {
          UserDefaults.standard.set(self.currentSchemaVersion, forKey: self.schemaVersionKey)
          let result = self.scheduleOrCommitUpdate(activity: existing, state: state)
          os_log(
            "syncState %{public}@ id=%{public}@ kind=%{public}@ paused=%{public}@ count=%{public}d",
            log: self.log,
            type: .info,
            result,
            existing.id,
            kind,
            self.syncPaused ? "1" : "0",
            self.lastCount
          )
          call.resolve([
            "ok": true,
            "updated": result == "updated",
            "queued": result == "queued",
            "skipped": result == "skipped",
            "activityId": existing.id,
            "syncPaused": self.syncPaused,
          ])
          return
        }
        if !Activity<AtollaBusyAttributes>.activities.isEmpty {
          await self.endAllActivitiesNow(reason: "stale-before-create")
          self.syncPaused = !appActive
          self.activeKind = kind
          self.lastItems = items
          self.lastCount = max(count, items.count)
          self.lastPresentation = presentation
          self.lastMoreDeepLink = moreDeepLink
          self.noteJSSync()
        }
        // 后台不再新建，避免挂起后无法校准的幽灵活动
        if !appActive {
          os_log("syncState skip create: app not active", log: self.log, type: .info)
          call.resolve(["ok": true, "updated": false, "syncPaused": true])
          return
        }
        guard authEnabled else {
          os_log("syncState skip create: Live Activities disabled", log: self.log, type: .error)
          call.resolve(["ok": false, "reason": "系统未开启实时活动"])
          return
        }
        let attrs = AtollaBusyAttributes(sessionId: UUID().uuidString)
        let activity = try Activity.request(
          attributes: attrs,
          content: ActivityContent(state: self.makeState(), staleDate: self.contentStaleDate()),
          pushType: nil
        )
        UserDefaults.standard.set(activity.id, forKey: self.activityIdKey)
        UserDefaults.standard.set(self.currentSchemaVersion, forKey: self.schemaVersionKey)
        self.lastCommittedState = self.makeState()
        os_log(
          "syncState started id=%{public}@ kind=%{public}@ count=%{public}d",
          log: self.log,
          type: .info,
          activity.id,
          kind,
          self.lastCount
        )
        call.resolve(["ok": true, "started": true, "activityId": activity.id, "syncPaused": false])
      } catch {
        os_log("syncState failed: %{public}@", log: self.log, type: .error, error.localizedDescription)
        call.reject("启动灵动岛失败: \(error.localizedDescription)")
      }
    }
  }

  @objc func endAll(_ call: CAPPluginCall) {
    if #available(iOS 16.2, *) {
      Task { @MainActor in
        await self.endAllActivitiesNow(reason: "js-endAll")
        call.resolve(["ok": true])
      }
      return
    }
    call.resolve(["ok": true])
  }

  // MARK: - 状态生成与更新节流

  private func makeState() -> AtollaBusyAttributes.ContentState {
    // 后台暂停时把耗时写成静态 durationMs，锁屏不再用本地秒表狂奔
    let items = syncPaused ? Self.freezeItemDurations(lastItems) : lastItems
    return AtollaBusyAttributes.ContentState(
      activeKind: activeKind,
      count: lastCount,
      items: items,
      // 保留字段以兼容既有 Activity schema；不再用相位驱动高频刷新。
      animPhase: 0,
      updatedAt: lastJSSyncAt?.timeIntervalSince1970 ?? Date().timeIntervalSince1970,
      presentation: lastPresentation,
      moreDeepLink: lastMoreDeepLink,
      syncPaused: syncPaused
    )
  }

  /// 将 running/task_plan 的 occurredAt 固化为 durationMs，供 Widget 静态展示
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

  /// 无远端推送时给系统一个过期点；后台缩短 stale，避免锁屏长时间显示「假新鲜」
  private func contentStaleDate() -> Date {
    if syncPaused {
      return Date().addingTimeInterval(3 * 60)
    }
    // 待审批：优先用最近一条授权 deadline，过期后系统标 stale
    if activeKind == "approval" {
      let ends = lastItems.map(\.expiresAt).filter { $0 > 0 }.map { Date(timeIntervalSince1970: $0) }
      if let soonest = ends.min(), soonest > Date() {
        return soonest
      }
    }
    let seconds: TimeInterval
    switch activeKind {
    case "running", "task_plan":
      seconds = 90
    case "approval":
      seconds = 180
    default:
      seconds = 120
    }
    return Date().addingTimeInterval(seconds)
  }

  /// 已存在的活动只在展示内容确实变化时更新；运行态事件合并 2 秒。
  @available(iOS 16.2, *)
  @MainActor
  private func scheduleOrCommitUpdate(
    activity: Activity<AtollaBusyAttributes>,
    state: AtollaBusyAttributes.ContentState
  ) -> String {
    guard Self.hasMeaningfulDisplayChange(from: lastCommittedState, to: state) else {
      return "skipped"
    }

    if Self.requiresImmediateUpdate(state.activeKind) {
      cancelPendingUpdate()
      commitUpdate(activity: activity, state: state, reason: "priority-event")
      return "updated"
    }

    pendingUpdate?.cancel()
    let work = DispatchWorkItem { [weak self, weak activity] in
      guard let self, let activity else { return }
      Task { @MainActor in
        self.pendingUpdate = nil
        let latest = self.makeState()
        guard Self.hasMeaningfulDisplayChange(from: self.lastCommittedState, to: latest) else {
          return
        }
        self.commitUpdate(activity: activity, state: latest, reason: "coalesced-event")
      }
    }
    pendingUpdate = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    return "queued"
  }

  @available(iOS 16.2, *)
  @MainActor
  private func commitUpdate(
    activity: Activity<AtollaBusyAttributes>,
    state: AtollaBusyAttributes.ContentState,
    reason: String
  ) {
    lastCommittedState = state
    let stale = contentStaleDate()
    Task { @MainActor in
      await activity.update(ActivityContent(state: state, staleDate: stale))
      os_log(
        "activity update id=%{public}@ kind=%{public}@ reason=%{public}@",
        log: self.log,
        type: .info,
        activity.id,
        state.activeKind,
        reason
      )
    }
  }

  /// 错误、审批和终态不能被普通运行事件延迟。
  private static func requiresImmediateUpdate(_ kind: String) -> Bool {
    kind == "error" || kind == "approval" || kind == "completed"
  }

  /// 排除更新时间和动画相位；普通进度不足 5% 时不唤醒 ActivityKit。
  private static func hasMeaningfulDisplayChange(
    from previous: AtollaBusyAttributes.ContentState?,
    to next: AtollaBusyAttributes.ContentState
  ) -> Bool {
    guard let previous else { return true }
    guard previous.activeKind == next.activeKind,
          previous.count == next.count,
          previous.presentation == next.presentation,
          previous.moreDeepLink == next.moreDeepLink,
          previous.syncPaused == next.syncPaused,
          previous.items.count == next.items.count else {
      return true
    }

    for (old, new) in zip(previous.items, next.items) {
      guard old.id == new.id,
            old.kind == new.kind,
            old.agentName == new.agentName,
            old.department == new.department,
            old.occurredAt == new.occurredAt,
            old.expiresAt == new.expiresAt,
            old.summary == new.summary,
            old.workStatus == new.workStatus,
            old.deepLink == new.deepLink,
            old.jellyColor == new.jellyColor,
            old.planPhase == new.planPhase,
            old.planStepTitle == new.planStepTitle,
            old.planCurrent == new.planCurrent,
            old.planTotal == new.planTotal else {
        return true
      }
      // 有起始时间时由系统计时视图刷新，durationMs 变化不应唤醒 ActivityKit。
      let usesSystemTimer = (new.kind == "running" || new.kind == "task_plan") && new.occurredAt > 0
      if !usesSystemTimer, old.durationMs != new.durationMs { return true }
      if abs(old.progress - new.progress) >= 5 { return true }
    }
    return false
  }

  private func cancelPendingUpdate() {
    pendingUpdate?.cancel()
    pendingUpdate = nil
  }

  /// JS 每次成功 sync 打点并启动前台孤儿巡检。
  private func noteJSSync() {
    lastJSSyncAt = Date()
    if UIApplication.shared.applicationState == .active {
      ensureOrphanWatchdog()
    }
  }

  private func ensureOrphanWatchdog() {
    if orphanTimer != nil { return }
    let timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
      self?.checkOrphanActivity()
    }
    RunLoop.main.add(timer, forMode: .common)
    orphanTimer = timer
  }

  private func stopOrphanWatchdog() {
    orphanTimer?.invalidate()
    orphanTimer = nil
  }

  /// 仅前台检查孤儿：后台无 JS 轮询属预期，不可因此下岛
  private func checkOrphanActivity() {
    guard UIApplication.shared.applicationState == .active else { return }
    guard !syncPaused else { return }
    guard let last = lastJSSyncAt else { return }
    guard Date().timeIntervalSince(last) >= maxOrphanAge else { return }
    guard #available(iOS 16.2, *) else { return }
    os_log("orphan watchdog → end (%.0fs without JS sync)", log: log, type: .info, maxOrphanAge)
    Task { @MainActor in
      await self.endAllActivitiesNow(reason: "orphan-watchdog")
    }
  }

  /// 进后台：停止所有本地刷新，只提交一次最后真实状态。
  @available(iOS 16.2, *)
  @MainActor
  private func markSyncPausedForBackground(reason: String) async {
    cancelPendingUpdate()
    stopOrphanWatchdog()
    syncPaused = true
    await pushCurrentStateToActivities(reason: reason)
  }

  /// 回前台：恢复系统计时展示，再等待 Web 层立即校准内容。
  @MainActor
  private func clearSyncPausedAndRefresh(reason: String) async {
    syncPaused = false
    guard #available(iOS 16.2, *) else { return }
    await pushCurrentStateToActivities(reason: reason)
    if !Activity<AtollaBusyAttributes>.activities.isEmpty {
      ensureOrphanWatchdog()
    }
    os_log("foreground: syncPaused cleared + activity refreshed", log: log, type: .info)
  }

  /// 把当前 bookkeeping 推到所有 active Live Activity
  @available(iOS 16.2, *)
  @MainActor
  private func pushCurrentStateToActivities(reason: String) async {
    let activities = Activity<AtollaBusyAttributes>.activities.filter { $0.activityState == .active }
    guard !activities.isEmpty else {
      os_log("push state skipped: no active activity (%{public}@)", log: log, type: .info, reason)
      return
    }
    guard !lastItems.isEmpty, !activeKind.isEmpty else {
      os_log("push state skipped: empty bookkeeping (%{public}@)", log: log, type: .info, reason)
      return
    }
    let state = makeState()
    guard Self.hasMeaningfulDisplayChange(from: lastCommittedState, to: state) else {
      os_log("push state skipped: unchanged (%{public}@)", log: log, type: .info, reason)
      return
    }
    let stale = contentStaleDate()
    for activity in activities {
      await activity.update(ActivityContent(state: state, staleDate: stale))
      os_log(
        "push state id=%{public}@ kind=%{public}@ paused=%{public}@ reason=%{public}@",
        log: log,
        type: .info,
        activity.id,
        activeKind,
        syncPaused ? "1" : "0",
        reason
      )
    }
    lastCommittedState = state
  }

  private func clearLocalIslandBookkeeping() {
    UserDefaults.standard.removeObject(forKey: activityIdKey)
    activeKind = ""
    lastItems = []
    lastCount = 0
    lastPresentation = "list"
    lastMoreDeepLink = ""
    lastJSSyncAt = nil
    syncPaused = false
    lastCommittedState = nil
    cancelPendingUpdate()
    stopOrphanWatchdog()
  }

  private static func parseActiveKind(_ raw: String?) -> String? {
    let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return ["error", "approval", "running", "completed", "task_plan"].contains(value) ? value : nil
  }

  private static func parsePresentation(_ raw: String?) -> String {
    let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return value == "task_plan" ? "task_plan" : "list"
  }

  private static func clampAtollaLink(_ raw: String?) -> String {
    let link = clamp(raw, limit: 512)
    guard URL(string: link)?.scheme?.lowercased() == "atolla" else { return "" }
    return link
  }

  private static func clamp(_ raw: Any?, limit: Int) -> String {
    let value = (raw as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return String(value.prefix(limit))
  }

  private static func number(_ raw: Any?, fallback: Double = 0) -> Double {
    if let value = raw as? Double { return value }
    if let value = raw as? Int { return Double(value) }
    if let value = raw as? String, let number = Double(value) { return number }
    return fallback
  }

  /// 解析 JS 事件，限制数量和文本长度，避免 ActivityKit payload 过大。
  private static func parseItems(_ raw: [JSObject]) -> [AtollaBusyAttributes.IslandItemSlice] {
    raw.prefix(5).compactMap { obj in
      let id = clamp(obj["id"], limit: 160)
      let name = clamp(obj["agentName"], limit: 48)
      guard !id.isEmpty, !name.isEmpty, let kind = parseActiveKind(obj["kind"] as? String) else {
        return nil
      }
      let rawLink = clamp(obj["deepLink"], limit: 512)
      let deepLink = URL(string: rawLink)?.scheme?.lowercased() == "atolla" ? rawLink : ""
      let work = clamp(obj["workStatus"], limit: 160)
      let summary = clamp(obj["summary"], limit: 160)
      return AtollaBusyAttributes.IslandItemSlice(
        id: id,
        kind: kind,
        agentName: name,
        department: clamp(obj["department"], limit: 48),
        occurredAt: max(0, number(obj["occurredAt"])),
        expiresAt: max(0, number(obj["expiresAt"])),
        durationMs: Int(number(obj["durationMs"], fallback: -1)),
        summary: summary,
        workStatus: work.isEmpty ? summary : work,
        deepLink: deepLink,
        jellyColor: clamp(obj["jellyColor"], limit: 16).isEmpty
          ? "blue" : clamp(obj["jellyColor"], limit: 16),
        progress: max(0, min(100, Int(number(obj["progress"])))),
        planPhase: clamp(obj["planPhase"], limit: 32),
        planStepTitle: clamp(obj["planStepTitle"], limit: 120),
        planCurrent: max(0, Int(number(obj["planCurrent"]))),
        planTotal: max(0, Int(number(obj["planTotal"])))
      )
    }
  }

  static func needsActivityReplacement(storedSchemaVersion: Int?) -> Bool {
    storedSchemaVersion != 5
  }

  @available(iOS 16.2, *)
  private func currentActivity() -> Activity<AtollaBusyAttributes>? {
    let id = UserDefaults.standard.string(forKey: activityIdKey)
    return Activity<AtollaBusyAttributes>.activities.first { $0.id == id }
      ?? Activity<AtollaBusyAttributes>.activities.first
  }

  @available(iOS 16.2, *)
  @MainActor
  private func endAllActivitiesNow(reason: String) async {
    cancelPendingUpdate()
    stopOrphanWatchdog()
    let ids = Activity<AtollaBusyAttributes>.activities.map(\.id)
    for activity in Activity<AtollaBusyAttributes>.activities {
      let done = AtollaBusyAttributes.ContentState(
        activeKind: "", count: 0, items: [], animPhase: 0,
        updatedAt: Date().timeIntervalSince1970,
        presentation: "list", moreDeepLink: "",
        syncPaused: false
      )
      await activity.end(
        ActivityContent(state: done, staleDate: nil),
        dismissalPolicy: .immediate
      )
    }
    os_log(
      "endAll reason=%{public}@ ids=%{public}@",
      log: log,
      type: .info,
      reason,
      ids.joined(separator: ",")
    )
    clearLocalIslandBookkeeping()
  }
}
