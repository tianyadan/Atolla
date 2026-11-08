import AppIntents

enum AtollaAgentListScope: String, AppEnum {
    case all
    case working

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "数字人范围")
    static let caseDisplayRepresentations: [AtollaAgentListScope: DisplayRepresentation] = [
        .all: "全部数字人",
        .working: "正在工作的数字人",
    ]
}

struct ListAgentsIntent: AppIntent {
    static let title: LocalizedStringResource = "查询有哪些数字人"
    static let description = IntentDescription("列出全部、指定工作组或正在工作的数字人。")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "范围", default: .all)
    var scope: AtollaAgentListScope

    @Parameter(title: "工作组")
    var group: String?

    static var parameterSummary: some ParameterSummary {
        Summary("查询 \(\.$scope)") {
            \.$group
        }
    }

    func perform() async -> some IntentResult & ProvidesDialog {
        do {
            let agents = try await AtollaRelayClient.shared.fetchAgents(
                group: group,
                working: scope == .working ? true : nil
            )
            guard !agents.isEmpty else {
                return .result(dialog: "没有找到符合条件的数字人。")
            }
            let names = agents.map { "\($0.groupName)的\($0.disambiguationLabel)" }
            return .result(dialog: "共有\(agents.count)位：\(names.joined(separator: "、"))。")
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "暂时无法查询数字人列表，请稍后重试。"
            return .result(dialog: "\(message)")
        }
    }
}
