import Foundation
import Security

enum AtollaCredentialStoreError: LocalizedError {
    case invalidInstanceID
    case invalidStoredValue
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidInstanceID:
            return "实例 ID 不能为空"
        case .invalidStoredValue:
            return "Keychain 中的凭据格式无效"
        case .keychain(let status):
            let message = SecCopyErrorMessageString(status, nil) as String?
            return message ?? "Keychain 操作失败（\(status)）"
        }
    }
}

struct AtollaCredentialSnapshot {
    let relayAPIBase: String?
    let siteToken: String?
    let recentInstanceID: String?
    let recentInstanceUnlockToken: String?
}

struct AtollaLanConnection: Codable {
    let instanceID: String
    let baseURL: String
    let deviceID: String
    let deviceSecret: String
    let strategy: String
}

/// Atolla 原生凭据存储，供 App 与后续 App Intents 统一读取。
final class AtollaCredentialStore {
    static let shared = AtollaCredentialStore()

    private enum Account {
        static let relayAPIBase = "relay-api-base"
        static let siteToken = "site-token"
        static let recentInstanceID = "recent-instance-id"
        static let lanConnectionPrefix = "lan-connection:"
    }

    private let credentialService: String
    private let unlockTokenService: String

    init(
        credentialService: String = "com.atolla.relay.credentials",
        unlockTokenService: String = "com.atolla.relay.credentials.unlock-tokens"
    ) {
        self.credentialService = credentialService
        self.unlockTokenService = unlockTokenService
    }

    func setRelayAPIBase(_ value: String?) throws {
        let normalized = value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        try write(normalized, account: Account.relayAPIBase, service: credentialService)
    }

    func relayAPIBase() throws -> String? {
        try read(account: Account.relayAPIBase, service: credentialService)
    }

    func setSiteToken(_ token: String?) throws {
        try write(token, account: Account.siteToken, service: credentialService)
    }

    func siteToken() throws -> String? {
        try read(account: Account.siteToken, service: credentialService)
    }

    func setUnlockToken(_ token: String?, for instanceID: String) throws {
        let account = try normalizedInstanceID(instanceID)
        try write(token, account: account, service: unlockTokenService)
    }

    func unlockToken(for instanceID: String) throws -> String? {
        let account = try normalizedInstanceID(instanceID)
        return try read(account: account, service: unlockTokenService)
    }

    func setRecentInstanceID(_ instanceID: String?) throws {
        let normalized: String?
        if let instanceID {
            normalized = try normalizedInstanceID(instanceID)
        } else {
            normalized = nil
        }
        try write(normalized, account: Account.recentInstanceID, service: credentialService)
    }

    func recentInstanceID() throws -> String? {
        try read(account: Account.recentInstanceID, service: credentialService)
    }

    func snapshot() throws -> AtollaCredentialSnapshot {
        let instanceID = try recentInstanceID()
        return AtollaCredentialSnapshot(
            relayAPIBase: try relayAPIBase(),
            siteToken: try siteToken(),
            recentInstanceID: instanceID,
            recentInstanceUnlockToken: try instanceID.flatMap { try unlockToken(for: $0) }
        )
    }

    func removeUnlockToken(for instanceID: String) throws {
        let account = try normalizedInstanceID(instanceID)
        try remove(account: account, service: unlockTokenService)
    }

    func removeAllUnlockTokens() throws {
        try removeAll(service: unlockTokenService)
    }

    func removeAllCredentials() throws {
        try removeAll(service: credentialService)
        try removeAll(service: unlockTokenService)
    }

    // LAN pairing material is a capability to control the local Mac. It must
    // not remain only in WebView localStorage, which can be copied by a web
    // inspection tool or lost during storage cleanup.
    func setLanConnection(_ connection: AtollaLanConnection?, for instanceID: String) throws {
        let id = try normalizedInstanceID(instanceID)
        guard let connection else {
            try remove(account: Account.lanConnectionPrefix + id, service: credentialService)
            return
        }
        let data = try JSONEncoder().encode(connection)
        guard let serialized = String(data: data, encoding: .utf8) else { throw AtollaCredentialStoreError.invalidStoredValue }
        try write(serialized, account: Account.lanConnectionPrefix + id, service: credentialService)
    }

    func lanConnection(for instanceID: String) throws -> AtollaLanConnection? {
        let id = try normalizedInstanceID(instanceID)
        guard let serialized = try read(account: Account.lanConnectionPrefix + id, service: credentialService) else { return nil }
        guard let data = serialized.data(using: .utf8) else { throw AtollaCredentialStoreError.invalidStoredValue }
        return try JSONDecoder().decode(AtollaLanConnection.self, from: data)
    }

    func removeLanConnection(for instanceID: String) throws {
        let id = try normalizedInstanceID(instanceID)
        try remove(account: Account.lanConnectionPrefix + id, service: credentialService)
    }

    private func normalizedInstanceID(_ instanceID: String) throws -> String {
        let normalized = instanceID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            throw AtollaCredentialStoreError.invalidInstanceID
        }
        return normalized
    }

    private func write(_ value: String?, account: String, service: String) throws {
        guard let value, !value.isEmpty else {
            try remove(account: account, service: service)
            return
        }

        let query = baseQuery(account: account, service: service)
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            // Siri 锁屏调用需要设备首次解锁后仍可读取，且凭据不随备份迁移。
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw AtollaCredentialStoreError.keychain(updateStatus)
        }

        var item = query
        attributes.forEach { item[$0.key] = $0.value }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw AtollaCredentialStoreError.keychain(addStatus)
        }
    }

    private func read(account: String, service: String) throws -> String? {
        var query = baseQuery(account: account, service: service)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw AtollaCredentialStoreError.keychain(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw AtollaCredentialStoreError.invalidStoredValue
        }
        return value
    }

    private func remove(account: String, service: String) throws {
        let status = SecItemDelete(baseQuery(account: account, service: service) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AtollaCredentialStoreError.keychain(status)
        }
    }

    private func removeAll(service: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AtollaCredentialStoreError.keychain(status)
        }
    }

    private func baseQuery(account: String, service: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
