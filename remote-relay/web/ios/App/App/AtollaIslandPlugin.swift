import ActivityKit
import Capacitor
import Foundation
import UIKit

/**
 * Capacitor 插件：优先级事件 → 单个灵动岛。
 * 无 APNs：JS 停轮询后不能感知数字人已结束，因此：
 * - 写入 staleDate，让系统标明过期；
 * - 超过 maxOrphanAge 未收到 JS syncState 则立即下岛，避免锁屏挂数小时；
 * - 进后台停止跳动 Timer，禁止用冻结的 running 态反复 update「续命」。
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

  private let activityIdKey = "atolla.island.activityId"
  private let schemaVersionKey = "atolla.island.schemaVersion"
  private let currentSchemaVersion = 2
  /// 超过此时长未收到 JS 同步，视为孤儿活动并下岛（无 APNs 时的安全网）
  private let maxOrphanAge: TimeInterval = 180
  private var animTimer: Timer?
  private var orphanTimer: Timer?
  private var animPhase: Int = 0
  private var activeKind: String = ""
  private var lastItems: [AtollaBusyAttributes.IslandItemSlice] = []
  private var lastCount: Int = 0
  private var lastJSSyncAt: Date?
  private var bgTask: UIBackgroundTaskIdentifier = .invalid

  /// 监听前后台：后台停跳动，前台由 JS 立刻再同步
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
  }

  @objc private func onAppBackground() {
    // 禁止后台假跳动：冻结的 running + 持续 update 会把「已结束」伪装成仍在工作数小时
    stopAnimTimer()
    beginBriefBackgroundTask()
    // 系统回收后台前预约下岛；短暂进控制中心会在回前台时取消（applicationState == active）
    DispatchQueue.main.asyncAfter(deadline: .now() + 25.0) { [weak self] in
      Task { @MainActor in
        guard UIApplication.shared.applicationState != .active else {
          self?.endBackgroundTask()
          return
        }
        await self?.endForBackgroundSuspension()
        self?.endBackgroundTask()
      }
    }
  }

  @objc private func onAppForeground() {
    endBackgroundTask()
    // JS IslandBusySyncHost 会立刻 tick；仍忙碌则重建活动
  }

  @objc func isAvailable(_ call: CAPPluginCall) {
    if #available(iOS 16.2, *) {
      let ok = ActivityAuthorizationInfo().areActivitiesEnabled
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

    if count <= 0 || items.isEmpty {
      stopAnimTimer()
      Task { @MainActor in
        await self.endAllActivitiesNow()
        call.resolve(["ok": true])
      }
      return
    }

    Task { @MainActor in
      do {
        if Self.needsActivityReplacement(
          storedSchemaVersion: UserDefaults.standard.object(forKey: self.schemaVersionKey) as? Int
        ) {
          await self.endAllActivitiesNow()
        }
        self.activeKind = kind
        self.lastItems = items
        self.lastCount = max(count, items.count)
        self.noteJSSync()
        let state = self.makeState()
        let stale = self.contentStaleDate()
        // 后台延迟 dismiss 后可能仍残留 ended 活动，先清掉再建
        if let existing = self.currentActivity(), existing.activityState == .active {
          await existing.update(ActivityContent(state: state, staleDate: stale))
          UserDefaults.standard.set(self.currentSchemaVersion, forKey: self.schemaVersionKey)
          if UIApplication.shared.applicationState == .active {
            self.updateAnimTimer()
          } else {
            self.stopAnimTimer()
          }
          call.resolve(["ok": true, "updated": true])
          return
        }
        if !Activity<AtollaBusyAttributes>.activities.isEmpty {
          await self.endAllActivitiesNow()
          self.activeKind = kind
          self.lastItems = items
          self.lastCount = max(count, items.count)
          self.noteJSSync()
        }
        // 后台不再新建，避免挂起后续命；由 onAppBackground 延迟 dismiss
        if UIApplication.shared.applicationState != .active {
          call.resolve(["ok": true, "updated": false])
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
        call.resolve(["ok": true, "started": true])
      } catch {
        call.reject("启动灵动岛失败: \(error.localizedDescription)")
      }
    }
  }

  @objc func endAll(_ call: CAPPluginCall) {
    stopAnimTimer()
    if #available(iOS 16.2, *) {
      Task { @MainActor in
        await self.endAllActivitiesNow()
        call.resolve(["ok": true])
      }
      return
    }
    call.resolve(["ok": true])
  }

  // MARK: - 动画相位 Timer（灵动岛依赖 Activity.update，不能靠 Widget TimelineView）

  private func makeState() -> AtollaBusyAttributes.ContentState {
    AtollaBusyAttributes.ContentState(
      activeKind: activeKind,
      count: lastCount,
      items: lastItems,
      animPhase: animPhase,
      updatedAt: Date().timeIntervalSince1970
    )
  }

  /// 无远端推送时给系统一个过期点，避免锁屏一直显示「新鲜进行中」
  private func contentStaleDate() -> Date {
    let seconds: TimeInterval
    switch activeKind {
    case "running":
      seconds = 90
    case "approval":
      seconds = 180
    default:
      seconds = 120
    }
    return Date().addingTimeInterval(seconds)
  }

  private func updateAnimTimer() {
    // 仅前台 running 跳动；后台一律停，防止假续命
    if activeKind == "running", UIApplication.shared.applicationState == .active {
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
    guard activeKind == "running", !lastItems.isEmpty else {
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

  /// JS 每次成功 sync 打点；启动孤儿巡检
  private func noteJSSync() {
    lastJSSyncAt = Date()
    ensureOrphanWatchdog()
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

  /// 长时间无 JS 同步则下岛（锁屏后数字人已结束却仍显示 running 的主修复）
  private func checkOrphanActivity() {
    guard let last = lastJSSyncAt else { return }
    guard Date().timeIntervalSince(last) >= maxOrphanAge else { return }
    guard #available(iOS 16.2, *) else { return }
    Task { @MainActor in
      await self.endAllActivitiesNow()
    }
  }

  /// 进后台：结束活动并在约 2 分钟后从锁屏移除（挂起后 Timer 不可靠，必须用 dismissalPolicy）
  @available(iOS 16.2, *)
  @MainActor
  private func endForBackgroundSuspension() async {
    stopAnimTimer()
    let activities = Activity<AtollaBusyAttributes>.activities
    guard !activities.isEmpty else {
      clearLocalIslandBookkeeping()
      return
    }
    let state: AtollaBusyAttributes.ContentState
    if !lastItems.isEmpty, !activeKind.isEmpty {
      state = makeState()
    } else if let current = activities.first?.content.state {
      state = current
    } else {
      state = AtollaBusyAttributes.ContentState(
        activeKind: "", count: 0, items: [], animPhase: 0,
        updatedAt: Date().timeIntervalSince1970
      )
    }
    let dismissAt = Date().addingTimeInterval(120)
    for activity in activities where activity.activityState == .active {
      await activity.end(
        ActivityContent(state: state, staleDate: Date().addingTimeInterval(30)),
        dismissalPolicy: .after(dismissAt)
      )
    }
    clearLocalIslandBookkeeping()
  }

  private func clearLocalIslandBookkeeping() {
    UserDefaults.standard.removeObject(forKey: activityIdKey)
    activeKind = ""
    lastItems = []
    lastCount = 0
    animPhase = 0
    lastJSSyncAt = nil
    stopAnimTimer()
    stopOrphanWatchdog()
  }

  private func beginBriefBackgroundTask() {
    endBackgroundTask()
    bgTask = UIApplication.shared.beginBackgroundTask(withName: "AtollaIslandDismiss") { [weak self] in
      Task { @MainActor in
        guard UIApplication.shared.applicationState != .active else {
          self?.endBackgroundTask()
          return
        }
        await self?.endForBackgroundSuspension()
        self?.endBackgroundTask()
      }
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
    return ["error", "approval", "running", "completed"].contains(value) ? value : nil
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
      return AtollaBusyAttributes.IslandItemSlice(
        id: id,
        kind: kind,
        agentName: name,
        department: clamp(obj["department"], limit: 48),
        occurredAt: max(0, number(obj["occurredAt"])),
        durationMs: Int(number(obj["durationMs"], fallback: -1)),
        summary: clamp(obj["summary"], limit: 160),
        deepLink: deepLink,
        jellyColor: clamp(obj["jellyColor"], limit: 16).isEmpty
          ? "blue" : clamp(obj["jellyColor"], limit: 16)
      )
    }
  }

  static func needsActivityReplacement(storedSchemaVersion: Int?) -> Bool {
    storedSchemaVersion != 2
  }

  @available(iOS 16.2, *)
  private func currentActivity() -> Activity<AtollaBusyAttributes>? {
    let id = UserDefaults.standard.string(forKey: activityIdKey)
    return Activity<AtollaBusyAttributes>.activities.first { $0.id == id }
      ?? Activity<AtollaBusyAttributes>.activities.first
  }

  @available(iOS 16.2, *)
  @MainActor
  private func endAllActivitiesNow() async {
    stopAnimTimer()
    stopOrphanWatchdog()
    endBackgroundTask()
    for activity in Activity<AtollaBusyAttributes>.activities {
      let done = AtollaBusyAttributes.ContentState(
        activeKind: "", count: 0, items: [], animPhase: 0,
        updatedAt: Date().timeIntervalSince1970
      )
      await activity.end(
        ActivityContent(state: done, staleDate: nil),
        dismissalPolicy: .immediate
      )
    }
    clearLocalIslandBookkeeping()
  }
}
