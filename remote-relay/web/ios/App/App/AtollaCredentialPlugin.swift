import Capacitor
import Foundation

/// Capacitor 凭据桥：将 Web 登录态同步到原生 Keychain，供后续 Siri Intent 使用。
@objc(AtollaCredentialPlugin)
public class AtollaCredentialPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AtollaCredentialPlugin"
    public let jsName = "AtollaCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveRelayAPIBase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSiteToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveUnlockToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveRecentInstance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSiteSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearUnlockToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllUnlockTokens", returnType: CAPPluginReturnPromise),
    ]

    private let store = AtollaCredentialStore.shared

    @objc func saveRelayAPIBase(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("缺少 Relay API Base")
            return
        }
        perform(call) {
            try store.setRelayAPIBase(value)
            mirrorUsageConnection()
        }
    }

    @objc func saveSiteToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("缺少 Site Token")
            return
        }
        perform(call) {
            try store.setSiteToken(token)
            mirrorUsageConnection()
        }
    }

    @objc func saveUnlockToken(_ call: CAPPluginCall) {
        guard
            let instanceID = call.getString("instanceId"),
            let token = call.getString("token"),
            !token.isEmpty
        else {
            call.reject("缺少实例 ID 或 Unlock Token")
            return
        }
        perform(call) {
            try store.setUnlockToken(token, for: instanceID)
            try store.setRecentInstanceID(instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func saveRecentInstance(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else {
            call.reject("缺少实例 ID")
            return
        }
        perform(call) {
            try store.setRecentInstanceID(instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func clearSiteSession(_ call: CAPPluginCall) {
        perform(call) {
            try store.setSiteToken(nil)
            try store.setRecentInstanceID(nil)
            try store.removeAllUnlockTokens()
            AtollaUsageSnapshotStore.clearConnection()
        }
    }

    @objc func clearUnlockToken(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else {
            call.reject("缺少实例 ID")
            return
        }
        perform(call) {
            try store.removeUnlockToken(for: instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func clearAllUnlockTokens(_ call: CAPPluginCall) {
        perform(call) {
            try store.removeAllUnlockTokens()
            mirrorUsageConnection()
        }
    }

    private func perform(_ call: CAPPluginCall, operation: () throws -> Void) {
        do {
            try operation()
            call.resolve(["ok": true])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    /// 同步连接信息到 App Group，供桌面用量小组件后台刷新。
    private func mirrorUsageConnection() {
        let id = try? store.recentInstanceID()
        let unlock = id.flatMap { try? store.unlockToken(for: $0) }
        AtollaUsageSnapshotStore.saveConnection(
            AtollaUsageConnection(
                relayAPIBase: try? store.relayAPIBase(),
                siteToken: try? store.siteToken(),
                instanceID: id,
                unlockToken: unlock
            )
        )
    }
}
