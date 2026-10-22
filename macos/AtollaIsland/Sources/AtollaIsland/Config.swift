import Foundation

/// 本机岛配置（由管理台登录后 POST /admin/island/sync 写入）。
struct IslandConfig: Codable {
  var api_base: String
  var web_base: String
  var token: String
  var updated_at: String?

  static var configURL: URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent(".atolla/island.json")
  }

  static func load() -> IslandConfig? {
    let url = configURL
    guard let data = try? Data(contentsOf: url) else { return nil }
    guard var cfg = try? JSONDecoder().decode(IslandConfig.self, from: data) else { return nil }
    // localhost → 127.0.0.1，避免 IPv6 ::1 触发后端 IP 白名单 403
    cfg.api_base = Self.preferIPv4Loopback(cfg.api_base)
    cfg.web_base = Self.preferIPv4Loopback(cfg.web_base)
    return cfg
  }

  /// 把 localhost / ::1 归一成 127.0.0.1。
  static func preferIPv4Loopback(_ raw: String) -> String {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let pairs = [
      ("http://localhost", "http://127.0.0.1"),
      ("https://localhost", "https://127.0.0.1"),
      ("http://[::1]", "http://127.0.0.1"),
      ("https://[::1]", "https://127.0.0.1"),
      ("http://::1", "http://127.0.0.1"),
      ("https://::1", "https://127.0.0.1"),
    ]
    for (from, to) in pairs {
      if s.lowercased().hasPrefix(from) {
        s = to + s.dropFirst(from.count)
        break
      }
    }
    return s
  }

  static func defaults() -> IslandConfig {
    IslandConfig(
      api_base: "http://127.0.0.1:8080",
      web_base: "http://127.0.0.1:5173",
      token: "",
      updated_at: nil
    )
  }
}
