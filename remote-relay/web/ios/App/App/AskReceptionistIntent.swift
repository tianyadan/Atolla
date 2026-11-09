import AppIntents

struct AskReceptionistIntent: AppIntent {
    static let title: LocalizedStringResource = "询问前台助理"
    static let description = IntentDescription("通过 Atolla 的 Receptionist 回答问题。")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "问题", requestValueDialog: "你想问前台助理什么？")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("询问前台助理 \(\.$question)")
    }

    func perform() async -> some IntentResult & ProvidesDialog {
        do {
            let reply = try await AtollaRelayClient.shared.askReceptionist(question: question)
            let answer = reply.answer.trimmingCharacters(in: .whitespacesAndNewlines)
            if !answer.isEmpty {
                // 自用场景按约定完整朗读，不在 Intent 层做内容脱敏或摘要。
                return .result(dialog: "\(answer)")
            }
            return .result(dialog: "\(reply.speechText ?? "问题已提交，请稍后打开 Atolla 查看。")")
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "暂时无法询问前台助理，请稍后重试。"
            return .result(dialog: "\(message)")
        }
    }
}
