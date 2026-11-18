import ActivityKit
import Capacitor
import Foundation
import UIKit
import os.log

/**
 * Capacitor 插件：优先级事件 → 单个灵动岛。
 * Phase1（无 APNs）：
 * - 前台可创建/更新 Live Activity；
 * - 有活动时每 5s 发 refreshNeeded + 推一次 ContentState，展开岛/锁屏可更新步骤；
 * - 进后台：停假跳动；原生拉镜像刷新 current_task，空闲则 end（不依赖 WebView）；
 * - 回前台立刻校准；前台任务结束仍由 JS endAll。
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
  /// 展开岛 / 锁屏步骤刷新间隔（秒）
  private let contentRefreshInterval: TimeInterval = 5
  private var animTimer: Timer?
  private var orphanTimer: Timer?
  private var contentRefreshTimer: Timer?
  private var animPhase: Int = 0
  private var activeKind: String = ""
  private var lastItems: [AtollaBusyAttributes.IslandItemSlice] = []
  private var lastCount: Int = 0
  private var lastPresentation: String = "list"
  private var lastMoreDeepLink: String = ""
  private var lastJSSyncAt: Date?
  private var syncPaused: Bool = false
  private var bgTask: UIBackgroundTaskIdentifier = .invalid

  /// 监听前后台：后台停跳动，保留 5s 内容刷新；前台立刻校准
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
    // 停假跳动；开启 background task，尽量撑住 5s 刷新直到系统回收
    stopAnimTimer()
    beginIslandBackgroundTask()
    Task { @MainActor in
      await self.markSyncPausedForBackground(reason: "didEnterBackground")
      self.ensureContentRefreshTimer()
    }
  }

  @objc private func onAppForeground() {
    endBackgroundTask()
    // 立刻把 Activity 拉回前台态，并继续 5s 刷新（有活动时）
    Task { @MainActor in
      await self.clearSyncPausedAndRefresh(reason: "willEnterForeground")
      self.ensureContentRefreshTimer()
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
      stopAnimTimer()
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
        let stale = self.contentStaleDate()
        // 后台延迟 dismiss 后可能仍残留 ended 活动，先清掉再建
        if let existing = self.currentActivity(), existing.activityState == .active {
          await existing.update(ActivityContent(state: state, staleDate: stale))
          UserDefaults.standard.set(self.currentSchemaVersion, forKey: self.schemaVersionKey)
          if appActive {
            self.updateAnimTimer()
          } else {
            self.stopAnimTimer()
          }
          self.ensureContentRefreshTimer()
          os_log(
            "syncState updated id=%{public}@ kind=%{public}@ paused=%{public}@ count=%{public}d",
            log: self.log,
            type: .info,
            existing.id,
            kind,
            self.syncPaused ? "1" : "0",
            self.lastCount
          )
          call.resolve(["ok": true, "updated": true, "activityId": existing.id, "syncPaused": self.syncPaused])
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
        self.updateAnimTimer()
        self.ensureContentRefreshTimer()
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
    stopAnimTimer()
    if #available(iOS 16.2, *) {
      Task { @MainActor in
        await self.endAllActivitiesNow(reason: "js-endAll")
        call.resolve(["ok": true])
      }
      return
    }
    call.resolve(["ok": true])
  }

  // MARK: - 动画相位 Timer（灵动岛依赖 Activity.update，不能靠 Widget TimelineView）

  private func makeState() -> AtollaBusyAttributes.ContentState {
    // 后台暂停时把耗时写成静态 durationMs，锁屏不再用本地秒表狂奔
    let items = syncPaused ? Self.freezeItemDurations(lastItems) : lastItems
    return AtollaBusyAttributes.ContentState(
      activeKind: activeKind,
      count: lastCount,
      items: items,
      animPhase: syncPaused ? 0 : animPhase,
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

  private func updateAnimTimer() {
    // 仅前台且未暂停的 running/task_plan 跳动
    if !syncPaused,
       (activeKind == "running" || activeKind == "task_plan"),
       UIApplication.shared.applicationState == .active {
      startAnimTimer()
    } else {
      stopAnimTimer()
    }
  }

  private func startAnimTimer() {
    stopAnimTimer()
    // 对齐 PC jelly-jump 0.6s 一轮：0.3s 落地↔腾空翻转，SwiftUI easeInOut 插值成上下弹
    let timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
      self?.tickAnim()
    }
    RunLoop.main.add(timer, forMode: .common)
    animTimer = timer
  }

  private func stopAnimTimer() {
    animTimer?.invalidate()
    animTimer = nil
  }

  private func tickAnim() {
    guard #available(iOS 16.2, *) else { return }
    guard !syncPaused, (activeKind == "running" || activeKind == "task_plan"), !lastItems.isEmpty else {
      stopAnimTimer()
      return
    }
    if UIApplication.shared.applicationState != .active {
      stopAnimTimer()
      return
    }
    // 仅 0/1：上下跳，禁止 0...7 横滑切帧
    animPhase = (animPhase + 1) % 2
    let state = makeState()
    let stale = contentStaleDate()
    Task { @MainActor in
      guard let activity = self.currentActivity() else {
        self.stopAnimTimer()
        return
      }
      await activity.update(ActivityContent(state: state, staleDate: stale))
    }
  }

  /// JS 每次成功 sync 打点；启动孤儿巡检与 5s 内容刷新
  private func noteJSSync() {
    lastJSSyncAt = Date()
    ensureOrphanWatchdog()
    ensureContentRefreshTimer()
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

  /// 有活动时每 5s：唤醒 JS 拉数 + 推一次 ContentState（展开岛可见步骤变化）
  private func ensureContentRefreshTimer() {
    if contentRefreshTimer != nil { return }
    let timer = Timer.scheduledTimer(withTimeInterval: contentRefreshInterval, repeats: true) { [weak self] _ in
      self?.tickContentRefresh()
    }
    RunLoop.main.add(timer, forMode: .common)
    contentRefreshTimer = timer
    os_log("content refresh timer started (%.0fs)", log: log, type: .info, contentRefreshInterval)
  }

  private func stopContentRefreshTimer() {
    contentRefreshTimer?.invalidate()
    contentRefreshTimer = nil
  }

  private func tickContentRefresh() {
    guard #available(iOS 16.2, *) else { return }
    let hasActivity = !Activity<AtollaBusyAttributes>.activities.isEmpty
    if !hasActivity {
      stopContentRefreshTimer()
      if !lastItems.isEmpty { clearLocalIslandBookkeeping() }
      return
    }
    let appActive = UIApplication.shared.applicationState == .active && !syncPaused
    Task { @MainActor in
      if appActive {
        // 前台：唤醒 JS 拉数并推当前 bookkeeping
        self.notifyListeners("refreshNeeded", data: [
          "ts": Date().timeIntervalSince1970,
          "activeKind": self.activeKind,
        ])
        await self.pushCurrentStateToActivities(reason: "content-refresh-5s")
      } else {
        // 后台/锁屏：原生校准（更新任务文案；空闲则下岛）
        _ = await AtollaIslandRemoteRefresh.reconcile()
        let stillActive = !Activity<AtollaBusyAttributes>.activities.isEmpty
        if !stillActive {
          self.clearLocalIslandBookkeeping()
          return
        }
        if let activity = self.currentActivity() {
          let state = activity.content.state
          self.activeKind = state.activeKind
          self.lastItems = state.items
          self.lastCount = state.count
          self.lastPresentation = state.presentation
          self.lastMoreDeepLink = state.moreDeepLink
          self.syncPaused = true
        }
      }
    }
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

  /// 进后台：停跳动并标记 syncPaused，立刻原生拉一次镜像
  @available(iOS 16.2, *)
  @MainActor
  private func markSyncPausedForBackground(reason: String) async {
    stopAnimTimer()
    syncPaused = true
    await pushCurrentStateToActivities(reason: reason)
    _ = await AtollaIslandRemoteRefresh.reconcile()
    if Activity<AtollaBusyAttributes>.activities.isEmpty {
      clearLocalIslandBookkeeping()
    }
  }

  /// 回前台：清除 syncPaused 并立刻刷新 Activity，再等 JS 校准内容
  @MainActor
  private func clearSyncPausedAndRefresh(reason: String) async {
    syncPaused = false
    guard #available(iOS 16.2, *) else { return }
    await pushCurrentStateToActivities(reason: reason)
    updateAnimTimer()
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
  }

  private func clearLocalIslandBookkeeping() {
    UserDefaults.standard.removeObject(forKey: activityIdKey)
    activeKind = ""
    lastItems = []
    lastCount = 0
    lastPresentation = "list"
    lastMoreDeepLink = ""
    animPhase = 0
    lastJSSyncAt = nil
    syncPaused = false
    stopAnimTimer()
    stopOrphanWatchdog()
    stopContentRefreshTimer()
  }

  /// 后台尽量保住 5s 刷新，直到系统到期
  private func beginIslandBackgroundTask() {
    endBackgroundTask()
    bgTask = UIApplication.shared.beginBackgroundTask(withName: "AtollaIslandRefresh") { [weak self] in
      os_log("island background task expired", log: self?.log ?? .default, type: .info)
      self?.endBackgroundTask()
    }
  }

  private func endBackgroundTask() {
    if bgTask != .invalid {
      UIApplication.shared.endBackgroundTask(bgTask)
      bgTask = .invalid
    }
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
    stopAnimTimer()
    stopOrphanWatchdog()
    stopContentRefreshTimer()
    endBackgroundTask()
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
