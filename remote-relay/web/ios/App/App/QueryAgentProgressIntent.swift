import AppIntents

struct QueryAgentProgressIntent: AppIntent {
    static let title: LocalizedStringResource = "查询数字人进度"
    static let description = IntentDescription("查询指定数字人的工作状态和当前任务进度。")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "数字人", requestValueDialog: "要查询哪位数字人？")
    var agent: AtollaAgentEntity

    static var parameterSummary: some ParameterSummary {
        Summary("查询 \(\.$agent) 的进度")
    }

    func perform() async -> some IntentResult & ProvidesDialog {
        do {
            let status = try await AtollaRelayClient.shared.fetchAgentStatus(
                instanceID: agent.instanceID,
                agentID: agent.agentID
            )
            return .result(dialog: "\(status.speechText)")
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "暂时无法查询数字人状态，请稍后重试。"
            return .result(dialog: "\(message)")
        }
    }
}
