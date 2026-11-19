import UIKit
import Capacitor
import BackgroundTasks

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// 后台用量刷新任务标识（需与 Info.plist BGTaskSchedulerPermittedIdentifiers 一致）。
    private static let usageRefreshTaskID = "com.atolla.mobile.usage-refresh"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.usageRefreshTaskID, using: nil) { task in
            self.handleUsageRefresh(task: task as? BGAppRefreshTask)
        }
        scheduleUsageRefresh()
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        scheduleUsageRefresh()
        // 切入后台只刷新桌面组件用量；灵动岛保留最后真实状态，不再额外拉取。
        Task {
            _ = await AtollaUsageRemoteRefresh.refresh(forceFresh: true)
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Task { _ = await AtollaUsageRemoteRefresh.refresh(forceFresh: false) }
    }

    func application(_ application: UIApplication, performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task {
            let snap = await AtollaUsageRemoteRefresh.refresh(forceFresh: true)
            completionHandler(snap == nil ? .noData : .newData)
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    /// 预约下一次后台用量刷新（约 15 分钟，系统可合并）。
    private func scheduleUsageRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.usageRefreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// 处理后台刷新：只拉用量并预约下一次；灵动岛不依赖后台轮询。
    private func handleUsageRefresh(task: BGAppRefreshTask?) {
        scheduleUsageRefresh()
        guard let task else { return }
        let work = Task {
            let snap = await AtollaUsageRemoteRefresh.refresh(forceFresh: true)
            task.setTaskCompleted(success: snap != nil)
        }
        task.expirationHandler = { work.cancel() }
    }
}
