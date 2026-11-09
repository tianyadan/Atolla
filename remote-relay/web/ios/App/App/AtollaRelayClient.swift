import Foundation

enum AtollaRelayClientError: LocalizedError {
    case missingAPIBase
    case invalidAPIBase
    case missingSiteToken
    case missingRecentInstance
    case missingUnlockToken
    case siteTokenExpired
    case instanceUnlockExpired
    case instanceUnavailable
    case agentUnavailable
    case siriFeatureUnavailable
    case macOffline
    case networkUnavailable
    case server(statusCode: Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingAPIBase:
            return "尚未配置 Atolla 中继地址，请先打开 Atolla 完成设置。"
        case .invalidAPIBase:
            return "Atolla 中继地址无效，请打开 Atolla 检查设置。"
        case .missingSiteToken:
            return "Atolla 尚未登录，请先打开 Atolla 登录。"
        case .missingRecentInstance:
            return "还没有选择数字人实例，请先打开 Atolla 进入一个实例。"
        case .missingUnlockToken:
            return "数字人实例尚未解锁，请先打开 Atolla 解锁实例。"
        case .siteTokenExpired:
            return "Atolla 登录已过期，请打开 Atolla 重新登录。"
        case .instanceUnlockExpired:
            return "数字人实例登录已过期，请打开 Atolla 重新解锁实例。"
        case .instanceUnavailable:
            return "这个数字人实例已被移除或撤销，请打开 Atolla 重新选择实例。"
        case .agentUnavailable:
            return "没有找到这个数字人，请重新选择后再试。"
        case .siriFeatureUnavailable:
            return "当前 Atolla 中继版本还不支持这个 Siri 功能，请更新并重启 Remote Relay。"
        case .macOffline:
            return "Atolla 所在的 Mac 当前离线，请确认 Mac 和 Atolla 服务已经启动。"
        case .networkUnavailable:
            return "当前无法连接 Atolla 中继，请检查网络和中继地址。"
        case .server(let statusCode):
            return "Atolla 中继暂时不可用，服务器返回 \(statusCode)。"
        case .invalidResponse:
            return "Atolla 中继返回了无法识别的响应。"
        }
    }
}

struct AtollaAgentRecord: Decodable {
    let id: String
    let instanceID: String
    let agentID: String
    let name: String
    let disambiguationLabel: String
    let groupName: String
    let status: String
    let working: Bool
    let syncedAt: Int64
    let speechText: String

    enum CodingKeys: String, CodingKey {
        case id
        case instanceID = "instance_id"
        case agentID = "agent_id"
        case name
        case disambiguationLabel = "disambiguation_label"
        case groupName = "group_name"
        case status
        case working
        case syncedAt = "synced_at"
        case speechText = "speech_text"
    }
}

private struct AtollaAgentListResponse: Decodable {
    let agents: [AtollaAgentRecord]
}

/// 兼容尚未部署 Siri 专用路由的 Relay，复用原有数字人镜像接口。
private struct AtollaLegacyAgentRecord: Decodable {
    struct Payload: Decodable {
        let folderName: String?

        enum CodingKeys: String, CodingKey {
            case folderName = "folder_name"
        }
    }

    let agentID: String
    let displayName: String?
    let status: String?
    let payload: Payload
    let syncedAt: Int64

    enum CodingKeys: String, CodingKey {
        case agentID = "agent_id"
        case displayName = "display_name"
        case status
        case payload
        case syncedAt = "synced_at"
    }
}

private struct AtollaLegacyAgentListResponse: Decodable {
    let agents: [AtollaLegacyAgentRecord]
}

struct AtollaAgentStatusRecord: Decodable {
    let id: String
    let instanceID: String
    let agentID: String
    let name: String
    let groupName: String
    let machineStatus: String
    let status: String
    let progress: Int?
    let currentTask: String?
    let syncedAt: Int64
    let stale: Bool
    let source: String
    let speechText: String

    enum CodingKeys: String, CodingKey {
        case id
        case instanceID = "instance_id"
        case agentID = "agent_id"
        case name
        case groupName = "group_name"
        case machineStatus = "machine_status"
        case status
        case progress
        case currentTask = "current_task"
        case syncedAt = "synced_at"
        case stale
        case source
        case speechText = "speech_text"
    }
}

struct AtollaRelayConnectionStatus {
    let recentInstanceID: String?
    let recentInstanceUnlocked: Bool

    var speechText: String {
        guard let recentInstanceID else {
            return "Atolla 已连接，目前还没有最近使用的数字人实例。"
        }
        if recentInstanceUnlocked {
            return "Atolla 已连接，最近使用的实例是 \(recentInstanceID)，实例登录状态有效。"
        }
        return "Atolla 已连接，最近使用的实例是 \(recentInstanceID)，但需要重新解锁实例。"
    }
}

struct AtollaReceptionistReply: Decodable {
    let answer: String
    let conversationID: Int64
    let replyMs: Int
    let submitted: Bool?
    let pending: Bool?
    let speechText: String?

    enum CodingKeys: String, CodingKey {
        case answer
        case conversationID = "conversation_id"
        case replyMs = "reply_ms"
        case submitted
        case pending
        case speechText = "speech_text"
    }
}

/// App Intent 专用 Relay 客户端，不依赖 WKWebView 或 App 前台进程。
final class AtollaRelayClient {
    static let shared = AtollaRelayClient()

    private let credentialStore: AtollaCredentialStore
    private let session: URLSession

    init(
        credentialStore: AtollaCredentialStore = .shared,
        session: URLSession = .shared
    ) {
        self.credentialStore = credentialStore
        self.session = session
    }

    func checkConnection() async throws -> AtollaRelayConnectionStatus {
        let credentials = try credentialStore.snapshot()
        guard let rawAPIBase = credentials.relayAPIBase, !rawAPIBase.isEmpty else {
            throw AtollaRelayClientError.missingAPIBase
        }
        guard let siteToken = credentials.siteToken, !siteToken.isEmpty else {
            throw AtollaRelayClientError.missingSiteToken
        }
        let endpoint = try makeEndpoint(base: rawAPIBase, path: "/api/auth/me")

        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("Bearer \(siteToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw mapTransportError(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AtollaRelayClientError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            clearExpiredSiteSession()
            throw AtollaRelayClientError.siteTokenExpired
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw AtollaRelayClientError.server(statusCode: httpResponse.statusCode)
        }

        return AtollaRelayConnectionStatus(
            recentInstanceID: credentials.recentInstanceID,
            recentInstanceUnlocked: credentials.recentInstanceUnlockToken != nil
        )
    }

    func fetchAgents(
        instanceID requestedInstanceID: String? = nil,
        group: String? = nil,
        working: Bool? = nil
    ) async throws -> [AtollaAgentRecord] {
        let credentials = try credentialStore.snapshot()
        guard let siteToken = credentials.siteToken, !siteToken.isEmpty else {
            throw AtollaRelayClientError.missingSiteToken
        }
        guard
            let instanceID = requestedInstanceID ?? credentials.recentInstanceID,
            !instanceID.isEmpty
        else {
            throw AtollaRelayClientError.missingRecentInstance
        }
        guard let unlockToken = try credentialStore.unlockToken(for: instanceID), !unlockToken.isEmpty else {
            throw AtollaRelayClientError.missingUnlockToken
        }

        var queryItems: [URLQueryItem] = []
        if let group = group?.trimmingCharacters(in: .whitespacesAndNewlines), !group.isEmpty {
            queryItems.append(URLQueryItem(name: "group", value: group))
        }
        if let working {
            queryItems.append(URLQueryItem(name: "working", value: working ? "true" : "false"))
        }
        let encodedInstanceID = instanceID.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        ) ?? instanceID
        let endpoint = try makeEndpoint(
            base: credentials.relayAPIBase ?? "",
            path: "/api/instances/\(encodedInstanceID)/siri/agents",
            queryItems: queryItems
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("Bearer \(siteToken)", forHTTPHeaderField: "Authorization")
        request.setValue(unlockToken, forHTTPHeaderField: "X-Instance-Unlock")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        do {
            data = try await perform(request, instanceID: instanceID)
        } catch AtollaRelayClientError.siriFeatureUnavailable {
            // 数字人列表不依赖 Siri 专用协议，旧 Relay 可安全回退到原镜像接口。
            return try await fetchLegacyAgents(
                instanceID: instanceID,
                group: group,
                working: working,
                siteToken: siteToken,
                unlockToken: unlockToken,
                apiBase: credentials.relayAPIBase ?? ""
            )
        }
        do {
            return try JSONDecoder().decode(AtollaAgentListResponse.self, from: data).agents
        } catch {
            throw AtollaRelayClientError.invalidResponse
        }
    }

    private func fetchLegacyAgents(
        instanceID: String,
        group: String?,
        working: Bool?,
        siteToken: String,
        unlockToken: String,
        apiBase: String
    ) async throws -> [AtollaAgentRecord] {
        let endpoint = try makeEndpoint(
            base: apiBase,
            path: "/api/instances/\(encodedPath(instanceID))/agents"
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        applyAuthorization(request: &request, siteToken: siteToken, unlockToken: unlockToken)
        let data = try await perform(request, instanceID: instanceID)
        let legacy: [AtollaLegacyAgentRecord]
        do {
            legacy = try JSONDecoder().decode(AtollaLegacyAgentListResponse.self, from: data).agents
        } catch {
            throw AtollaRelayClientError.invalidResponse
        }

        let requestedGroup = group?.trimmingCharacters(in: .whitespacesAndNewlines)
        let mapped = legacy.map { agent -> AtollaAgentRecord in
            let name = agent.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolvedName = (name?.isEmpty == false ? name : nil) ?? agent.agentID
            let groupName = agent.payload.folderName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolvedGroup = (groupName?.isEmpty == false ? groupName : nil) ?? "未分组"
            let status = agent.status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "idle"
            let isWorking = ["running", "busy", "initializing", "compressing", "waiting", "approval", "插话中"]
                .contains(status)
            return AtollaAgentRecord(
                id: "\(instanceID):\(agent.agentID)",
                instanceID: instanceID,
                agentID: agent.agentID,
                name: resolvedName,
                disambiguationLabel: resolvedName,
                groupName: resolvedGroup,
                status: status,
                working: isWorking,
                syncedAt: agent.syncedAt,
                speechText: "\(resolvedGroup)的\(resolvedName)\(isWorking ? "正在工作" : "当前空闲")。"
            )
        }
        return mapped.filter { agent in
            if let requestedGroup, !requestedGroup.isEmpty,
               agent.groupName.localizedCaseInsensitiveCompare(requestedGroup) != .orderedSame {
                return false
            }
            if let working, agent.working != working {
                return false
            }
            return true
        }
    }

    func fetchAgentStatus(instanceID: String, agentID: String) async throws -> AtollaAgentStatusRecord {
        let credentials = try authorizedCredentials(instanceID: instanceID)
        let endpoint = try makeEndpoint(
            base: credentials.apiBase,
            path: "/api/instances/\(encodedPath(instanceID))/siri/agents/\(encodedPath(agentID))/status"
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        applyAuthorization(
            request: &request,
            siteToken: credentials.siteToken,
            unlockToken: credentials.unlockToken
        )
        let data = try await perform(request, instanceID: instanceID)
        do {
            return try JSONDecoder().decode(AtollaAgentStatusRecord.self, from: data)
        } catch {
            throw AtollaRelayClientError.invalidResponse
        }
    }

    func enqueueTask(instanceID: String, agentID: String, task: String) async throws {
        let question = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else {
            throw AtollaRelayClientError.invalidResponse
        }
        let credentials = try authorizedCredentials(instanceID: instanceID)
        let endpoint = try makeEndpoint(
            base: credentials.apiBase,
            path: "/api/instances/\(encodedPath(instanceID))/agents/\(encodedPath(agentID))/task-queue"
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.httpBody = try JSONSerialization.data(withJSONObject: ["question": question])
        applyAuthorization(
            request: &request,
            siteToken: credentials.siteToken,
            unlockToken: credentials.unlockToken
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try await perform(request, instanceID: instanceID)
    }

    func askReceptionist(question: String) async throws -> AtollaReceptionistReply {
        let content = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            throw AtollaRelayClientError.invalidResponse
        }
        let snapshot = try credentialStore.snapshot()
        guard let instanceID = snapshot.recentInstanceID, !instanceID.isEmpty else {
            throw AtollaRelayClientError.missingRecentInstance
        }
        let credentials = try authorizedCredentials(instanceID: instanceID)
        let endpoint = try makeEndpoint(
            base: credentials.apiBase,
            path: "/api/instances/\(encodedPath(instanceID))/siri/receptionist/ask"
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.httpBody = try JSONSerialization.data(withJSONObject: ["question": content])
        applyAuthorization(
            request: &request,
            siteToken: credentials.siteToken,
            unlockToken: credentials.unlockToken
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let data = try await perform(request, instanceID: instanceID)
        do {
            return try JSONDecoder().decode(AtollaReceptionistReply.self, from: data)
        } catch {
            throw AtollaRelayClientError.invalidResponse
        }
    }

    private func makeEndpoint(
        base: String,
        path: String,
        queryItems: [URLQueryItem] = []
    ) throws -> URL {
        let normalized = base
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard
            var components = URLComponents(string: normalized + path),
            let scheme = components.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            components.host != nil
        else {
            throw AtollaRelayClientError.invalidAPIBase
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw AtollaRelayClientError.invalidAPIBase
        }
        return url
    }

    private func perform(_ request: URLRequest, instanceID: String) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw mapTransportError(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AtollaRelayClientError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            clearExpiredSiteSession()
            throw AtollaRelayClientError.siteTokenExpired
        }
        if httpResponse.statusCode == 403 {
            try? credentialStore.removeUnlockToken(for: instanceID)
            throw AtollaRelayClientError.instanceUnlockExpired
        }
        if httpResponse.statusCode == 404 {
            let errorBody = try? JSONDecoder().decode(AtollaRelayErrorBody.self, from: data)
            let message = errorBody?.error?.lowercased() ?? ""
            if message.contains("instance") {
                throw AtollaRelayClientError.instanceUnavailable
            }
            if message.contains("agent") {
                throw AtollaRelayClientError.agentUnavailable
            }
            // Express 对未注册路由返回 HTML 404；这是旧 Relay，不是实例被删除。
            throw AtollaRelayClientError.siriFeatureUnavailable
        }
        if httpResponse.statusCode == 504 {
            throw AtollaRelayClientError.macOffline
        }
        if let errorBody = try? JSONDecoder().decode(AtollaRelayErrorBody.self, from: data),
           errorBody.code == "MAC_OFFLINE" {
            throw AtollaRelayClientError.macOffline
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw AtollaRelayClientError.server(statusCode: httpResponse.statusCode)
        }
        return data
    }

    private func authorizedCredentials(instanceID: String) throws -> (
        apiBase: String,
        siteToken: String,
        unlockToken: String
    ) {
        let apiBase = try credentialStore.relayAPIBase()
        let siteToken = try credentialStore.siteToken()
        let unlockToken = try credentialStore.unlockToken(for: instanceID)
        guard let apiBase, !apiBase.isEmpty else {
            throw AtollaRelayClientError.missingAPIBase
        }
        guard let siteToken, !siteToken.isEmpty else {
            throw AtollaRelayClientError.missingSiteToken
        }
        guard let unlockToken, !unlockToken.isEmpty else {
            throw AtollaRelayClientError.missingUnlockToken
        }
        return (apiBase, siteToken, unlockToken)
    }

    private func applyAuthorization(
        request: inout URLRequest,
        siteToken: String,
        unlockToken: String
    ) {
        request.setValue("Bearer \(siteToken)", forHTTPHeaderField: "Authorization")
        request.setValue(unlockToken, forHTTPHeaderField: "X-Instance-Unlock")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    private func encodedPath(_ value: String) -> String {
        value.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        ) ?? value
    }

    private func clearExpiredSiteSession() {
        try? credentialStore.setSiteToken(nil)
        try? credentialStore.setRecentInstanceID(nil)
        try? credentialStore.removeAllUnlockTokens()
    }

    private func mapTransportError(_ error: URLError) -> AtollaRelayClientError {
        switch error.code {
        case .timedOut, .cannotConnectToHost, .networkConnectionLost,
             .notConnectedToInternet, .cannotFindHost, .dnsLookupFailed:
            return .networkUnavailable
        default:
            return .networkUnavailable
        }
    }
}

private struct AtollaRelayErrorBody: Decodable {
    let code: String?
    let error: String?
}
