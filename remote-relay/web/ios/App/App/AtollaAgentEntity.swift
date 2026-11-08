import AppIntents

struct AtollaAgentEntity: AppEntity, Identifiable, Hashable {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "数字人")
    static let defaultQuery = AtollaAgentQuery()

    let id: String
    let instanceID: String
    let agentID: String
    let name: String
    let disambiguationLabel: String
    let groupName: String
    let status: String
    let speechText: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(disambiguationLabel)",
            subtitle: "\(groupName) · \(statusText)"
        )
    }

    private var statusText: String {
        switch status {
        case "running", "busy": return "工作中"
        case "waiting": return "等待中"
        case "approval": return "待授权"
        case "compressing": return "整理上下文"
        case "error", "failed": return "异常"
        default: return "空闲"
        }
    }

    init(record: AtollaAgentRecord) {
        id = record.id
        instanceID = record.instanceID
        agentID = record.agentID
        name = record.name
        disambiguationLabel = record.disambiguationLabel
        groupName = record.groupName
        status = record.status
        speechText = record.speechText
    }
}

struct AtollaAgentQuery: EntityStringQuery {
    func entities(for identifiers: [AtollaAgentEntity.ID]) async throws -> [AtollaAgentEntity] {
        let requested = Set(identifiers)
        let instanceIDs = Set(identifiers.compactMap(Self.instanceID(from:)))
        var entities: [AtollaAgentEntity] = []
        for instanceID in instanceIDs {
            let rows = try await AtollaRelayClient.shared.fetchAgents(instanceID: instanceID)
            entities.append(contentsOf: rows.map(AtollaAgentEntity.init).filter { requested.contains($0.id) })
        }
        return entities
    }

    func suggestedEntities() async throws -> [AtollaAgentEntity] {
        try await AtollaRelayClient.shared.fetchAgents().map(AtollaAgentEntity.init)
    }

    func entities(matching string: String) async throws -> [AtollaAgentEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let entities = try await suggestedEntities()
        guard !query.isEmpty else { return entities }
        return entities.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || $0.groupName.localizedCaseInsensitiveContains(query)
                || $0.agentID.localizedCaseInsensitiveContains(query)
        }
    }

    private static func instanceID(from entityID: String) -> String? {
        guard let separator = entityID.lastIndex(of: ":") else { return nil }
        let instanceID = String(entityID[..<separator])
        return instanceID.isEmpty ? nil : instanceID
    }
}
