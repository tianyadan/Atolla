import AppKit
import Foundation

enum IslandEventKind: String, Codable {
  case error
  case approval
  case running
  case completed
}

struct IslandEvent: Identifiable, Codable, Equatable {
  let id: String
  let kind: IslandEventKind
  let agent_id: Int64
  let agent_name: String
  let status: String
  let jelly_color: String?
  let group_name: String?
  let occurred_at: String
  let duration_ms: Int?
  let summary: String?
  let request_id: String?
  /// 任务规划进度 0–100（running 时可有）
  let progress: Int?
  /// atolla.task_plan.v1 phase
  let plan_phase: String?

  var displayStatus: String {
    switch kind {
    case .error: return "任务报错"
    case .approval: return "待命令审批"
    case .completed: return "任务完成"
    case .running:
      if let p = progress, p > 0, p < 100 { return "\(p)%" }
      return "运行中"
    }
  }

  var displayGroup: String {
    let g = (group_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return g.isEmpty ? "未分组" : g
  }

  var occurredDate: Date? {
    let raw = occurred_at.trimmingCharacters(in: .whitespacesAndNewlines)
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = iso.date(from: raw) { return d }
    iso.formatOptions = [.withInternetDateTime]
    return iso.date(from: raw)
  }

  func subtitle(now: Date = Date()) -> String {
    switch kind {
    case .running:
      var parts: [String] = [displayGroup]
      if let start = occurredDate {
        parts.append(Self.formatDuration(seconds: Int(now.timeIntervalSince(start))))
      }
      // 任务规划摘要（后端 formatIslandTaskPlanSummary）
      let plan = (summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if !plan.isEmpty { parts.append(plan) }
      else { parts.append("运行中") }
      return parts.joined(separator: " · ")
    case .approval:
      let text = (summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? "\(displayGroup) · 点击审批" : "\(displayGroup) · \(text)"
    case .completed:
      let duration = Self.formatDuration(milliseconds: duration_ms ?? 0)
      if let date = occurredDate {
        return "\(displayGroup) · \(duration) · \(Self.clock.string(from: date))"
      }
      return "\(displayGroup) · \(duration)"
    case .error:
      let duration = Self.formatDuration(milliseconds: duration_ms ?? 0)
      let reason = (summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let time = occurredDate.map { Self.clock.string(from: $0) } ?? ""
      return [displayGroup, duration, time, reason].filter { !$0.isEmpty }.joined(separator: " · ")
    }
  }

  static func formatDuration(milliseconds: Int) -> String {
    formatDuration(seconds: max(0, milliseconds / 1000))
  }

  static func formatDuration(seconds: Int) -> String {
    let sec = max(0, seconds)
    if sec < 60 { return "\(sec)秒" }
    let m = sec / 60
    let s = sec % 60
    if m < 60 { return String(format: "%d分%02d秒", m, s) }
    let h = m / 60
    let rm = m % 60
    return String(format: "%d小时%02d分", h, rm)
  }

  private static let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm"
    return formatter
  }()
}

struct IslandPresentation: Codable, Equatable {
  let active_kind: IslandEventKind?
  let count: Int
  let items: [IslandEvent]

  static let empty = IslandPresentation(active_kind: nil, count: 0, items: [])
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

/// 轮询当前最高优先级的灵动岛事件。
final class AgentAPI {
  func fetchEvents(config: IslandConfig) async throws -> IslandPresentation {
    let token = config.token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else { throw AgentAPIError.noToken }
    let base = config.api_base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: "\(base)/api/admin/island/events") else { throw AgentAPIError.decode }
    var req = URLRequest(url: url, timeoutInterval: 8)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, resp) = try await URLSession.shared.data(for: req)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401 { throw AgentAPIError.http(401, "登录已过期，请重新打开管理台登录") }
    guard (200..<300).contains(code) else {
      let msg = String(data: data, encoding: .utf8) ?? ""
      throw AgentAPIError.http(code, msg)
    }
    return try JSONDecoder().decode(IslandPresentation.self, from: data)
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
  func openAgent(config: IslandConfig, id: Int64, approvalRequestID: String? = nil) {
    let web = config.web_base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard var components = URLComponents(string: "\(web)/") else { return }
    var query = [URLQueryItem(name: "agent", value: "\(id)")]
    if let approvalRequestID, !approvalRequestID.isEmpty {
      query.append(URLQueryItem(name: "approval_request_id", value: approvalRequestID))
      // 每次点击带时间戳，避免浏览器认为 URL 未变而不导航、前端无法重拉审批弹窗
      query.append(URLQueryItem(name: "_island", value: "\(Int(Date().timeIntervalSince1970 * 1000))"))
    }
    components.queryItems = query
    components.fragment = "agent=\(id)"
    guard let url = components.url else { return }
    if BrowserReuse.activateOrNavigate(webBase: web, agentId: id, targetURL: url) {
      return
    }
    NSWorkspace.shared.open(url)
  }
}
