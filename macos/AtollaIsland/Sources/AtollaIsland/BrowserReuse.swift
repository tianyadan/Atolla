import AppKit
import Foundation

/// 优先复用已打开的管理台标签页，避免每次从灵动岛点开都新建网页。
enum BrowserReuse {
  /// 在常见浏览器里找「同 host + 同 agent」标签并前置；没有则同 host 标签导航到目标 URL；都没有返回 false。
  static func activateOrNavigate(webBase: String, agentId: Int64, targetURL: URL) -> Bool {
    let hostKeys = hostMatchKeys(webBase: webBase)
    guard !hostKeys.isEmpty else { return false }
    let target = targetURL.absoluteString
    // 审批深链必须重新导航，不能只激活同一数字人的旧标签。
    let approvalNeedle = URLComponents(url: targetURL, resolvingAgainstBaseURL: false)?
      .queryItems?.first(where: { $0.name == "approval_request_id" })?.value
    let agentNeedle = approvalNeedle.map { "approval_request_id=\($0)" } ?? "agent=\(agentId)"

    // 1) 精确：同 host 且 URL 含 agent=id → 仅前置
    // 2) 回退：同 host 任意管理台标签 → 导航到目标深链（不新建窗口）
    for requireAgent in [true, false] {
      for browser in preferredBrowsers() {
        let hit: Bool
        if browser == "Safari" {
          hit = runSafari(
            hostKeys: hostKeys,
            agentNeedle: agentNeedle,
            navigateURL: target,
            requireAgent: requireAgent
          )
        } else {
          hit = runChromeFamily(
            appName: browser,
            hostKeys: hostKeys,
            agentNeedle: agentNeedle,
            navigateURL: target,
            requireAgent: requireAgent
          )
        }
        if hit { return true }
      }
    }
    return false
  }

  /// 解析可匹配的 host 关键字（含 localhost / 127.0.0.1 互换）。
  private static func hostMatchKeys(webBase: String) -> [String] {
    guard let u = URL(string: webBase), let host = u.host, !host.isEmpty else { return [] }
    var keys: [String] = []
    let port = u.port.map { ":\($0)" } ?? ""
    keys.append(host + port)
    if host == "127.0.0.1" {
      keys.append("localhost" + port)
    } else if host == "localhost" {
      keys.append("127.0.0.1" + port)
    }
    return Array(Set(keys))
  }

  /// 运行中的浏览器优先，再按常见顺序。
  private static func preferredBrowsers() -> [String] {
    let candidates = [
      "Google Chrome", "Arc", "Microsoft Edge", "Brave Browser",
      "Dia", "Vivaldi", "Chromium", "Safari",
    ]
    let running = Set(
      NSWorkspace.shared.runningApplications.compactMap(\.localizedName)
    )
    let front = NSWorkspace.shared.frontmostApplication?.localizedName
    var ordered: [String] = []
    if let front, candidates.contains(front) {
      ordered.append(front)
    }
    for name in candidates where running.contains(name) && !ordered.contains(name) {
      ordered.append(name)
    }
    for name in candidates where !ordered.contains(name) {
      ordered.append(name)
    }
    return ordered
  }

  private static func runChromeFamily(
    appName: String,
    hostKeys: [String],
    agentNeedle: String,
    navigateURL: String,
    requireAgent: Bool
  ) -> Bool {
    // Safari 单独处理
    if appName == "Safari" { return false }
    let hostList = hostKeys.map { "\"\($0)\"" }.joined(separator: ", ")
    let req = requireAgent ? "true" : "false"
    let script = """
    set hostList to {\(hostList)}
    set agentNeedle to "\(escape(agentNeedle))"
    set navigateURL to "\(escape(navigateURL))"
    set requireAgent to \(req)
    tell application "\(appName)"
      if not running then return "miss"
      repeat with w in windows
        set tabCount to count of tabs of w
        repeat with i from 1 to tabCount
          try
            set u to URL of tab i of w
            set hostHit to false
            repeat with h in hostList
              if u contains h then
                set hostHit to true
                exit repeat
              end if
            end repeat
            if hostHit then
              set agentHit to (u contains agentNeedle)
              if requireAgent and not agentHit then
                -- 下一轮再找
              else
                set active tab index of w to i
                set index of w to 1
                if not agentHit then
                  set URL of tab i of w to navigateURL
                end if
                activate
                return "hit"
              end if
            end if
          end try
        end repeat
      end repeat
    end tell
    return "miss"
    """
    return eval(script) == "hit"
  }

  private static func runSafari(
    hostKeys: [String],
    agentNeedle: String,
    navigateURL: String,
    requireAgent: Bool
  ) -> Bool {
    let hostList = hostKeys.map { "\"\($0)\"" }.joined(separator: ", ")
    let req = requireAgent ? "true" : "false"
    let script = """
    set hostList to {\(hostList)}
    set agentNeedle to "\(escape(agentNeedle))"
    set navigateURL to "\(escape(navigateURL))"
    set requireAgent to \(req)
    tell application "Safari"
      if not running then return "miss"
      repeat with w in windows
        repeat with t in tabs of w
          try
            set u to URL of t
            set hostHit to false
            repeat with h in hostList
              if u contains h then
                set hostHit to true
                exit repeat
              end if
            end repeat
            if hostHit then
              set agentHit to (u contains agentNeedle)
              if (not requireAgent) or agentHit then
                set current tab of w to t
                set index of w to 1
                if not agentHit then
                  set URL of t to navigateURL
                end if
                activate
                return "hit"
              end if
            end if
          end try
        end repeat
      end repeat
    end tell
    return "miss"
    """
    return eval(script) == "hit"
  }

  private static func escape(_ s: String) -> String {
    s
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
  }

  private static func eval(_ source: String) -> String {
    var error: NSDictionary?
    let script = NSAppleScript(source: source)
    let result = script?.executeAndReturnError(&error)
    if error != nil { return "miss" }
    return result?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "miss"
  }
}
