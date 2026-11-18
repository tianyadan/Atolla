import Capacitor
import Foundation
import WidgetKit

/// 将 Web 端 engines/usage 同步到 App Group，供桌面小组件展示。
@objc(AtollaUsagePlugin)
public class AtollaUsagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AtollaUsagePlugin"
    public let jsName = "AtollaUsage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publishEnginesUsage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise),
    ]

    /// JS 传入中继用量 JSON + 当前实例 ID。
    @objc func publishEnginesUsage(_ call: CAPPluginCall) {
        guard let payload = call.getObject("usage") else {
            call.reject("缺少 usage 对象")
            return
        }
        let instanceID = call.getString("instanceId")
        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            let dto = try JSONDecoder().decode(AtollaEnginesUsageDTO.self, from: data)
            let snapshot = AtollaUsageSnapshotStore.makeSnapshot(from: dto, instanceID: instanceID)
            AtollaUsageSnapshotStore.saveSnapshot(snapshot)
            mirrorConnection(instanceID: instanceID)
            call.resolve(["ok": true, "engines": snapshot.engines.count])
        } catch {
            call.reject("用量快照写入失败：\(error.localizedDescription)")
        }
    }

    @objc func reloadWidgets(_ call: CAPPluginCall) {
        AtollaUsageSnapshotStore.reloadWidgets()
        call.resolve(["ok": true])
    }

    /// 把 Keychain 连接信息镜像到 App Group，供 Widget 后台刷新。
    private func mirrorConnection(instanceID: String?) {
        let store = AtollaCredentialStore.shared
        let id = (instanceID?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? (try? store.recentInstanceID())
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
