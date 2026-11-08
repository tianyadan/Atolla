import AppIntents

/// 独立验证 Intent：即使主 App 已被终止，也可从 Keychain 读取凭据并请求 Relay。
struct CheckAtollaConnectionIntent: AppIntent {
    static let title: LocalizedStringResource = "检查 Atolla 连接"
    static let description = IntentDescription("检查 Atolla 登录状态以及中继服务是否可以访问。")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    func perform() async -> some IntentResult & ProvidesDialog {
        do {
            let status = try await AtollaRelayClient.shared.checkConnection()
            return .result(dialog: "\(status.speechText)")
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "暂时无法连接 Atolla，请稍后重试。"
            return .result(dialog: "\(message)")
        }
    }
}

struct AtollaAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CheckAtollaConnectionIntent(),
            phrases: [
                "检查 \(.applicationName) 连接",
                "\(.applicationName) 是否在线",
            ],
            shortTitle: "检查连接",
            systemImageName: "wave.3.right"
        )
        AppShortcut(
            intent: QueryAgentProgressIntent(),
            phrases: [
                "用 \(.applicationName) 查询 \(\.$agent) 的进度",
                "用 \(.applicationName) 看 \(\.$agent) 现在怎么样",
            ],
            shortTitle: "查询数字人进度",
            systemImageName: "chart.bar.fill"
        )
        AppShortcut(
            intent: ListAgentsIntent(),
            phrases: [
                "用 \(.applicationName) 查询有哪些数字人",
                "\(.applicationName) 有哪些数字人",
                "\(.applicationName) 有哪些数字员工",
                "问 \(.applicationName) 有哪些数字员工",
                "用 \(.applicationName) 查询数字员工",
                "用 \(.applicationName) 列出数字员工",
            ],
            shortTitle: "查询数字员工",
            systemImageName: "person.3.fill"
        )
        AppShortcut(
            intent: SendAgentTaskIntent(),
            phrases: [
                "用 \(.applicationName) 给 \(\.$agent) 安排任务",
                "用 \(.applicationName) 让 \(\.$agent) 执行任务",
            ],
            shortTitle: "安排数字人任务",
            systemImageName: "text.badge.plus"
        )
        AppShortcut(
            intent: AskReceptionistIntent(),
            phrases: [
                "用 \(.applicationName) 问前台助理",
                "询问 \(.applicationName) 前台助理",
            ],
            shortTitle: "询问前台助理",
            systemImageName: "bubble.left.and.bubble.right.fill"
        )
    }
}
