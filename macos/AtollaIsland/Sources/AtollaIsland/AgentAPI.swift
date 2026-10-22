import AppKit
import Foundation

struct BusyAgent: Identifiable, Codable, Equatable {
  let id: Int64
  let name: String
  let engine: String
  let status: String
  let jelly_color: String?
  let reason: String?
  /// 工作组名（后端空时已归一为「未分组」）
  let group_name: String?
  /// 本轮运行开始时间 RFC3339
  let run_started_at: String?
  /// 任务完成未读（非忙碌，蓝呼吸灯）
  let unread: Bool?

  var isUnread: Bool { unread == true || reason == "unread" }

  var displayStatus: String {
    if isUnread { return "任务完成" }
    let s = status.lowercased()
    if reason == "workflow" { return "协作中" }
    if s == "waiting" { return "等待中" }
    if s == "compressing" { return "压缩中" }
    if s == "initializing" { return "初始化" }
    return "运行中"
  }

  var displayGroup: String {
    let g = (group_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return g.isEmpty ? "未分组" : g
  }

  /// 解析运行起点；无则 nil
  var runStartedDate: Date? {
    guard let raw = run_started_at?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
      return nil
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = iso.date(from: raw) { return d }
    iso.formatOptions = [.withInternetDateTime]
    return iso.date(from: raw)
  }

  /// 副标题：组名 · 运行时长 / 未读提示
  func subtitle(now: Date = Date()) -> String {
    let group = displayGroup
    if isUnread {
      return "\(group) · 点击查看结果"
    }
    if let start = runStartedDate {
      return "\(group) · \(Self.formatDuration(from: start, to: now))"
    }
    return "\(group) · \(displayStatus)"
  }

  /// 将时长格式化为 12秒 / 3分12秒 / 1小时05分
  static func formatDuration(from start: Date, to now: Date) -> String {
    let sec = max(0, Int(now.timeIntervalSince(start)))
    if sec < 60 { return "\(sec)秒" }
    let m = sec / 60
    let s = sec % 60
    if m < 60 { return String(format: "%d分%02d秒", m, s) }
    let h = m / 60
    let rm = m % 60
    return String(format: "%d小时%02d分", h, rm)
  }
}

struct BusyResponse: Codable {
  let items: [BusyAgent]
  let count: Int?
}

enum AgentAPIError: LocalizedError {
  case noToken
  case http(Int, String)
  case decode

  var errorDescription: String? {
    switch self {
    case .noToken: return "尚未同步凭证：请先在管理台登录（会写入 ~/.atolla/island.json）"
    case .http(let c, let m): return "HTTP \(c): \(m)"
    case .decode: return "响应解析失败"
    }
  }
}

/// 轮询忙碌 / 未读数字人。
final class AgentAPI {
  func fetchBusy(config: IslandConfig) async throws -> [BusyAgent] {
    let token = config.token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else { throw AgentAPIError.noToken }
    let base = config.api_base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: "\(base)/api/admin/island/busy") else { throw AgentAPIError.decode }
    var req = URLRequest(url: url, timeoutInterval: 8)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, resp) = try await URLSession.shared.data(for: req)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401 { throw AgentAPIError.http(401, "登录已过期，请重新打开管理台登录") }
    guard (200..<300).contains(code) else {
      let msg = String(data: data, encoding: .utf8) ?? ""
      throw AgentAPIError.http(code, msg)
    }
    let decoded = try JSONDecoder().decode(BusyResponse.self, from: data)
    return decoded.items
  }

  /// 标记任务完成已读（从岛上移除未读项）
  func markRead(config: IslandConfig, id: Int64) async {
    let token = config.token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else { return }
    let base = config.api_base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: "\(base)/api/admin/agents/\(id)/mark-read") else { return }
    var req = URLRequest(url: url, timeoutInterval: 6)
    req.httpMethod = "POST"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = Data("{}".utf8)
    _ = try? await URLSession.shared.data(for: req)
  }

  /// 打开管理台并定位数字人：优先复用已有标签，没有再新建。
  func openAgent(config: IslandConfig, id: Int64) {
    let web = config.web_base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let raw = "\(web)/?agent=\(id)#agent=\(id)"
    guard let url = URL(string: raw) else { return }
    if BrowserReuse.activateOrNavigate(webBase: web, agentId: id, targetURL: url) {
      return
    }
    NSWorkspace.shared.open(url)
  }
}
