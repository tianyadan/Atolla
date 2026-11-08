import AppIntents

struct SendAgentTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "给数字人安排任务"
    static let description = IntentDescription("确认后将任务加入指定数字人的任务队列。")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "数字人", requestValueDialog: "要把任务交给哪位数字人？")
    var agent: AtollaAgentEntity

    @Parameter(title: "任务内容", requestValueDialog: "要安排什么任务？")
    var task: String

    static var parameterSummary: some ParameterSummary {
        Summary("让 \(\.$agent) 执行 \(\.$task)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let content = task.trimmingCharacters(in: .whitespacesAndNewlines)
        let confirmation = "将任务“\(content)”发送给\(agent.groupName)的\(agent.name)，并加入任务队列。"
        try await requestConfirmation(result: .result(dialog: "\(confirmation)"))

        do {
            try await AtollaRelayClient.shared.enqueueTask(
                instanceID: agent.instanceID,
                agentID: agent.agentID,
                task: content
            )
            return .result(dialog: "任务已加入\(agent.name)的队列。")
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "任务下发失败，请稍后重试。"
            return .result(dialog: "\(message)")
        }
    }
}
