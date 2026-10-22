import ActivityKit
import Capacitor
import Foundation
import UIKit

/**
 * Capacitor 插件：忙碌数字人 → 灵动岛。
 * 灵动岛上 TimelineView 几乎不刷新，故用 App 内 Timer 每 0.2s update animPhase 驱动水母跳动。
 */
@objc(AtollaIslandPlugin)
public class AtollaIslandPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AtollaIslandPlugin"
  public let jsName = "AtollaIsland"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "syncBusy", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
  ]

  private let activityIdKey = "atolla.island.activityId"
  private var animTimer: Timer?
  private var animPhase: Int = 0
  private var lastAgents: [AtollaBusyAttributes.BusyAgentSlice] = []
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

  @objc func syncBusy(_ call: CAPPluginCall) {
    guard #available(iOS 16.2, *) else {
      call.reject("需要 iOS 16.2+")
      return
    }
    let count = call.getInt("count") ?? 0
    let agents = Self.parseAgents(call.getArray("agents", JSObject.self) ?? [])

    if count <= 0 || agents.isEmpty {
      stopAnimTimer()
      endAllActivities()
      call.resolve(["ok": true])
      return
    }

    lastAgents = agents
    lastCount = max(count, agents.count)
    let state = makeState()

    Task { @MainActor in
      do {
        if let existing = self.currentActivity() {
          await existing.update(ActivityContent(state: state, staleDate: nil))
          self.startAnimTimer()
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
        self.startAnimTimer()
        call.resolve(["ok": true, "started": true])
      } catch {
        call.reject("启动灵动岛失败: \(error.localizedDescription)")
      }
    }
  }

  @objc func endAll(_ call: CAPPluginCall) {
    stopAnimTimer()
    if #available(iOS 16.2, *) {
      endAllActivities()
    }
    call.resolve(["ok": true])
  }

  // MARK: - 动画相位 Timer（灵动岛依赖 Activity.update，不能靠 Widget TimelineView）

  private func makeState() -> AtollaBusyAttributes.ContentState {
    AtollaBusyAttributes.ContentState(
      count: lastCount,
      agents: lastAgents,
      animPhase: animPhase
    )
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
    guard !lastAgents.isEmpty else {
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
    if animTimer == nil, !lastAgents.isEmpty {
      startAnimTimer()
    }
  }

  private func endBackgroundTask() {
    if bgTask != .invalid {
      UIApplication.shared.endBackgroundTask(bgTask)
      bgTask = .invalid
    }
  }

  /// 解析 JS agents
  private static func parseAgents(_ raw: [JSObject]) -> [AtollaBusyAttributes.BusyAgentSlice] {
    raw.prefix(5).compactMap { obj in
      let name = (obj["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard !name.isEmpty else { return nil }
      let color = (obj["jellyColor"] as? String) ?? "blue"
      let status = (obj["statusLabel"] as? String) ?? "运行中"
      let started: Double
      if let n = obj["runStartedAt"] as? Double {
        started = n
      } else if let n = obj["runStartedAt"] as? Int {
        started = Double(n)
      } else if let s = obj["runStartedAt"] as? String, let n = Double(s) {
        started = n
      } else {
        started = 0
      }
      return AtollaBusyAttributes.BusyAgentSlice(
        name: name,
        jellyColor: color,
        statusLabel: status,
        runStartedAt: started
      )
    }
  }

  @available(iOS 16.2, *)
  private func currentActivity() -> Activity<AtollaBusyAttributes>? {
    let id = UserDefaults.standard.string(forKey: activityIdKey)
    return Activity<AtollaBusyAttributes>.activities.first { $0.id == id }
      ?? Activity<AtollaBusyAttributes>.activities.first
  }

  @available(iOS 16.2, *)
  private func endAllActivities() {
    lastAgents = []
    lastCount = 0
    animPhase = 0
    UserDefaults.standard.removeObject(forKey: activityIdKey)
    Task { @MainActor in
      for activity in Activity<AtollaBusyAttributes>.activities {
        let done = AtollaBusyAttributes.ContentState(count: 0, agents: [], animPhase: 0)
        await activity.end(
          ActivityContent(state: done, staleDate: nil),
          dismissalPolicy: .immediate
        )
      }
    }
  }
}
