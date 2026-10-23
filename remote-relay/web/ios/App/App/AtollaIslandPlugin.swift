import ActivityKit
import Capacitor
import Foundation
import UIKit

/**
 * Capacitor 插件：优先级事件 → 单个灵动岛。
 * 只有运行态使用 App 内 Timer 更新 animPhase，终态与审批保持静态以节省电量。
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
  private var animTimer: Timer?
  private var animPhase: Int = 0
  private var activeKind: String = ""
  private var lastItems: [AtollaBusyAttributes.IslandItemSlice] = []
  private var lastCount: Int = 0
  private var bgTask: UIBackgroundTaskIdentifier = .invalid

  /// 监听进后台，延长跳动 Timer
  override public func load() {
    super.load()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(onAppBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
  }

  @objc private func onAppBackground() {
    keepAnimatingInBackground()
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
        let state = self.makeState()
        if let existing = self.currentActivity() {
          await existing.update(ActivityContent(state: state, staleDate: nil))
          self.updateAnimTimer()
          UserDefaults.standard.set(self.currentSchemaVersion, forKey: self.schemaVersionKey)
          call.resolve(["ok": true, "updated": true])
          return
        }
        let attrs = AtollaBusyAttributes(sessionId: UUID().uuidString)
        let activity = try Activity.request(
          attributes: attrs,
          content: ActivityContent(state: state, staleDate: nil),
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

  private func updateAnimTimer() {
    if activeKind == "running" {
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
    endBackgroundTask()
  }

  private func tickAnim() {
    guard #available(iOS 16.2, *) else { return }
    guard activeKind == "running", !lastItems.isEmpty else {
      stopAnimTimer()
      return
    }
    // 仅 0/1：上下跳，禁止 0...7 横滑切帧
    animPhase = (animPhase + 1) % 2
    let state = makeState()
    Task { @MainActor in
      guard let activity = self.currentActivity() else {
        self.stopAnimTimer()
        return
      }
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }
  }

  /// 进后台时申请短时后台，让跳动再持续一小段
  func keepAnimatingInBackground() {
    endBackgroundTask()
    bgTask = UIApplication.shared.beginBackgroundTask(withName: "AtollaIslandAnim") { [weak self] in
      self?.endBackgroundTask()
    }
    if animTimer == nil, activeKind == "running", !lastItems.isEmpty {
      startAnimTimer()
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
    activeKind = ""
    lastItems = []
    lastCount = 0
    animPhase = 0
    stopAnimTimer()
    UserDefaults.standard.removeObject(forKey: activityIdKey)
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
  }
}
