import Foundation
import WidgetKit

/// 中继 engines/usage 原始窗口。
struct AtollaUsageWindowDTO: Codable, Hashable {
    var kind: String?
    var label: String?
    var hint: String?
    var usedPercent: Int?
    var windowMinutes: Int?
    var resetsAt: String?
    var resetHint: String?

    enum CodingKeys: String, CodingKey {
        case kind, label, hint
        case usedPercent = "used_percent"
        case windowMinutes = "window_minutes"
        case resetsAt = "resets_at"
        case resetHint = "reset_hint"
    }
}

/// 单个引擎用量。
struct AtollaEngineUsageDTO: Codable, Hashable {
    var id: String
    var ok: Bool?
    var error: String?
    var source: String?
    var plan: String?
    var windows: [AtollaUsageWindowDTO]?
}

/// 中继完整用量响应。
struct AtollaEnginesUsageDTO: Codable, Hashable {
    var cachedAt: String?
    var ttlSeconds: Int?
    var engines: [AtollaEngineUsageDTO]?

    enum CodingKeys: String, CodingKey {
        case cachedAt = "cached_at"
        case ttlSeconds = "ttl_seconds"
        case engines
    }
}

/// Widget 展示用精简行（仅成功探测到的 CLI）。
struct AtollaUsageDisplayEngine: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var ok: Bool
    var error: String?
    /// 短周期已用 %（5h / Auto / session）
    var shortUsedPercent: Int?
    var shortLabel: String?
    var shortWindowMinutes: Int?
    var shortResetHint: String?
    /// 长周期已用 %（月 / 周 / All）
    var longUsedPercent: Int?
    var longLabel: String?
    var longWindowMinutes: Int?
    var longResetHint: String?

    var shortRemainingPercent: Int? {
        guard let used = shortUsedPercent else { return nil }
        return max(0, min(100, 100 - used))
    }

    var longRemainingPercent: Int? {
        guard let used = longUsedPercent else { return nil }
        return max(0, min(100, 100 - used))
    }

    /// 已用绝对值，如「2.15h / 5h」。
    func absoluteUsedText(usedPercent: Int?, windowMinutes: Int?) -> String? {
        guard let used = usedPercent, let mins = windowMinutes, mins > 0 else { return nil }
        let usedMins = Double(mins) * Double(used) / 100.0
        if mins >= 24 * 60 {
            let totalDays = Double(mins) / 1440.0
            let usedDays = usedMins / 1440.0
            return String(format: "%.2fd / %.0fd", usedDays, totalDays.rounded())
        }
        if mins >= 60 {
            let totalHours = Double(mins) / 60.0
            let usedHours = usedMins / 60.0
            return String(format: "%.2fh / %.0fh", usedHours, totalHours.rounded())
        }
        return String(format: "%.0fm / %dm", usedMins.rounded(), mins)
    }
}

/// 写入 App Group 的快照。
struct AtollaUsageSnapshot: Codable, Hashable {
    var updatedAt: Date
    var instanceID: String?
    var engines: [AtollaUsageDisplayEngine]
    var sourceNote: String?
}

/// Widget 刷新所需连接信息（镜像自 Keychain，便于扩展进程读取）。
struct AtollaUsageConnection: Codable, Hashable {
    var relayAPIBase: String?
    var siteToken: String?
    var instanceID: String?
    var unlockToken: String?
}

/// App Group 用量快照读写。
enum AtollaUsageSnapshotStore {
    private static let snapshotKey = "engines.usage.snapshot.v1"
    private static let connectionKey = "engines.usage.connection.v1"

    static func loadSnapshot() -> AtollaUsageSnapshot? {
        guard let data = AtollaAppGroup.defaults.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(AtollaUsageSnapshot.self, from: data)
    }

    static func saveSnapshot(_ snapshot: AtollaUsageSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        AtollaAppGroup.defaults.set(data, forKey: snapshotKey)
        reloadWidgets()
    }

    static func loadConnection() -> AtollaUsageConnection? {
        guard let data = AtollaAppGroup.defaults.data(forKey: connectionKey) else { return nil }
        return try? JSONDecoder().decode(AtollaUsageConnection.self, from: data)
    }

    static func saveConnection(_ connection: AtollaUsageConnection) {
        guard let data = try? JSONEncoder().encode(connection) else { return }
        AtollaAppGroup.defaults.set(data, forKey: connectionKey)
    }

    static func clearConnection() {
        AtollaAppGroup.defaults.removeObject(forKey: connectionKey)
    }

    /// 从中继 DTO 生成桌面展示快照（自动跳过未检测到的 CLI）。
    static func makeSnapshot(
        from dto: AtollaEnginesUsageDTO,
        instanceID: String?
    ) -> AtollaUsageSnapshot {
        let wanted = ["codex", "cursor", "claude"]
        var rows: [AtollaUsageDisplayEngine] = []
        for id in wanted {
            let engine = dto.engines?.first(where: { $0.id.lowercased() == id })
            let row = displayEngine(id: id, engine: engine)
            // 未登录 / 无凭证 / 无窗口数据：不展示
            guard row.ok, row.shortUsedPercent != nil || row.longUsedPercent != nil else { continue }
            rows.append(row)
        }
        return AtollaUsageSnapshot(
            updatedAt: Date(),
            instanceID: instanceID,
            engines: rows,
            sourceNote: dto.cachedAt
        )
    }

    static func reloadWidgets() {
        WidgetCenter.shared.reloadTimelines(ofKind: "AtollaUsageWidget")
    }

    private static func displayEngine(id: String, engine: AtollaEngineUsageDTO?) -> AtollaUsageDisplayEngine {
        let name: String = [
            "codex": "Codex",
            "cursor": "Cursor",
            "claude": "Claude",
        ][id] ?? id
        guard let engine, engine.ok != false else {
            return AtollaUsageDisplayEngine(
                id: id,
                name: name,
                ok: false,
                error: engine?.error ?? "暂无数据",
                shortUsedPercent: nil,
                shortLabel: nil,
                shortWindowMinutes: nil,
                shortResetHint: nil,
                longUsedPercent: nil,
                longLabel: nil,
                longWindowMinutes: nil,
                longResetHint: nil
            )
        }
        let windows = engine.windows ?? []
        let short = pickShortWindow(engineID: id, windows: windows)
        let long = pickLongWindow(engineID: id, windows: windows)
        return AtollaUsageDisplayEngine(
            id: id,
            name: name,
            ok: true,
            error: nil,
            shortUsedPercent: clamp(short?.usedPercent),
            shortLabel: shortLabel(engineID: id, short),
            shortWindowMinutes: short?.windowMinutes,
            shortResetHint: compactResetHint(window: short, fallbackLabel: shortLabel(engineID: id, short) ?? "5h"),
            longUsedPercent: clamp(long?.usedPercent),
            longLabel: longLabel(engineID: id, long),
            longWindowMinutes: long?.windowMinutes,
            longResetHint: compactResetHint(window: long, fallbackLabel: longLabel(engineID: id, long) ?? "周")
        )
    }

    /// 缩短重置文案，避免小组件里被截成「2026-11-07 22:…」。
    private static func compactResetHint(window: AtollaUsageWindowDTO?, fallbackLabel: String) -> String? {
        guard let window else { return nil }
        if let resetsAt = window.resetsAt?.trimmingCharacters(in: .whitespacesAndNewlines), !resetsAt.isEmpty,
           let date = parseResetsAt(resetsAt) {
            let cal = Calendar.current
            let time = DateFormatter()
            time.locale = Locale(identifier: "zh_CN")
            time.dateFormat = "HH:mm"
            let hm = time.string(from: date)
            if cal.isDateInToday(date) {
                return "\(fallbackLabel) 下次 \(hm)"
            }
            if cal.isDateInTomorrow(date) {
                return "\(fallbackLabel) 下次 明天 \(hm)"
            }
            let day = DateFormatter()
            day.locale = Locale(identifier: "zh_CN")
            day.dateFormat = "M/d HH:mm"
            return "\(fallbackLabel) 下次 \(day.string(from: date))"
        }
        // 已有短 hint 直接用；过长则截断
        let raw = (window.resetHint ?? window.hint)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return nil }
        if raw.count <= 18 { return raw }
        return String(raw.prefix(16)) + "…"
    }

    private static func parseResetsAt(_ value: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: value) { return d }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: value) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        for format in ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm"] {
            f.dateFormat = format
            if let d = f.date(from: value) { return d }
        }
        return nil
    }

    private static func pickShortWindow(engineID: String, windows: [AtollaUsageWindowDTO]) -> AtollaUsageWindowDTO? {
        if engineID == "cursor" {
            return windows.first(where: {
                "\($0.label ?? "") \($0.hint ?? "") \($0.kind ?? "")".localizedCaseInsensitiveContains("auto")
            }) ?? windows.first(where: { $0.kind == "session" }) ?? windows.first
        }
        return windows.first(where: { $0.kind == "session" })
            ?? windows.first(where: { "\($0.label ?? "")".contains("5") })
            ?? windows.first
    }

    private static func pickLongWindow(engineID: String, windows: [AtollaUsageWindowDTO]) -> AtollaUsageWindowDTO? {
        if engineID == "cursor" {
            return windows.first(where: {
                "\($0.label ?? "") \($0.hint ?? "")".localizedCaseInsensitiveContains("all")
            }) ?? windows.first(where: { $0.kind == "monthly" })
                ?? windows.first(where: { $0.kind == "weekly" })
        }
        return windows.first(where: { $0.kind == "monthly" })
            ?? windows.first(where: { "\($0.label ?? "")".contains("月") })
            ?? windows.first(where: { $0.kind == "weekly" })
            ?? windows.first(where: { "\($0.label ?? "")".contains("周") || "\($0.label ?? "")".contains("7") })
    }

    private static func shortLabel(engineID: String, _ window: AtollaUsageWindowDTO?) -> String? {
        guard let window else { return nil }
        let blob = "\(window.label ?? "") \(window.kind ?? "")"
        if blob.localizedCaseInsensitiveContains("auto") { return "Auto" }
        if window.kind == "session" || blob.contains("5") { return "5h" }
        return (window.label ?? window.kind)?.prefix(6).description
    }

    private static func longLabel(engineID: String, _ window: AtollaUsageWindowDTO?) -> String? {
        guard let window else { return nil }
        let blob = "\(window.label ?? "") \(window.kind ?? "")"
        if engineID == "cursor", blob.localizedCaseInsensitiveContains("all") || window.kind == "monthly" {
            return "All"
        }
        if window.kind == "monthly" || "\(window.label ?? "")".contains("月") { return "月" }
        if window.kind == "weekly" || "\(window.label ?? "")".contains("周") || "\(window.label ?? "")".contains("7") {
            return "7天"
        }
        return (window.label ?? window.kind)?.prefix(6).description
    }

    private static func clamp(_ value: Int?) -> Int? {
        guard let value else { return nil }
        return max(0, min(100, value))
    }
}

/// 用 App Group 镜像凭据拉中继用量（App / Widget 共用，不依赖打开 Web 页）。
enum AtollaUsageRemoteRefresh {
    /// forceFresh=true 时带 ?fresh=1，跳过中继短缓存。
    static func refresh(forceFresh: Bool) async -> AtollaUsageSnapshot? {
        guard
            let conn = AtollaUsageSnapshotStore.loadConnection(),
            let base = conn.relayAPIBase?.trimmingCharacters(in: .whitespacesAndNewlines), !base.isEmpty,
            let siteToken = conn.siteToken, !siteToken.isEmpty,
            let instanceID = conn.instanceID, !instanceID.isEmpty,
            let unlock = conn.unlockToken, !unlock.isEmpty
        else {
            return nil
        }
        let trimmed = base.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        let encoded = instanceID.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        ) ?? instanceID
        var urlString = "\(trimmed)/api/instances/\(encoded)/engines/usage"
        if forceFresh { urlString += "?fresh=1" }
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 25
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(siteToken)", forHTTPHeaderField: "Authorization")
        request.setValue(unlock, forHTTPHeaderField: "X-Instance-Unlock")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            let dto = try JSONDecoder().decode(AtollaEnginesUsageDTO.self, from: data)
            let snapshot = AtollaUsageSnapshotStore.makeSnapshot(from: dto, instanceID: instanceID)
            AtollaUsageSnapshotStore.saveSnapshot(snapshot)
            return snapshot
        } catch {
            return nil
        }
    }
}
