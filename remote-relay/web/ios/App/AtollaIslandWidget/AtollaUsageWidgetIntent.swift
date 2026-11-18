import AppIntents
import WidgetKit

/// 小组件可选的 CLI 引擎（长按小组件 → 编辑可切换）。
@available(iOSApplicationExtension 17.0, *)
enum AtollaCLIEngineOption: String, AppEnum {
    case auto = "auto"
    case codex = "codex"
    case cursor = "cursor"
    case claude = "claude"

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "CLI 引擎")

    static var caseDisplayRepresentations: [AtollaCLIEngineOption: DisplayRepresentation] = [
        .auto: "自动（按已检测顺序）",
        .codex: "Codex",
        .cursor: "Cursor",
        .claude: "Claude",
    ]
}

/// 用量小组件配置：选上方 / 下方各一个引擎，默认展示两个。
@available(iOSApplicationExtension 17.0, *)
struct AtollaUsageWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "CLI 额度"
    static var description = IntentDescription("选择小组件展示的两个 CLI")

    @Parameter(title: "左侧引擎", default: .auto)
    var primary: AtollaCLIEngineOption

    @Parameter(title: "右侧引擎", default: .auto)
    var secondary: AtollaCLIEngineOption
}

/// 从快照里按配置挑出发动机行（最多 2 个；未检测到的跳过）。
enum AtollaUsageEnginePicker {
    static func pick(
        from snapshot: AtollaUsageSnapshot?,
        primaryID: String,
        secondaryID: String,
        limit: Int
    ) -> [AtollaUsageDisplayEngine] {
        guard let snapshot, !snapshot.engines.isEmpty, limit > 0 else { return [] }
        let detected = snapshot.engines
        var result: [AtollaUsageDisplayEngine] = []
        var used = Set<String>()

        func appendResolved(_ raw: String) {
            guard result.count < limit else { return }
            if raw == "auto" {
                for engine in detected where !used.contains(engine.id) {
                    result.append(engine)
                    used.insert(engine.id)
                    return
                }
                return
            }
            guard !used.contains(raw),
                  let engine = detected.first(where: { $0.id == raw }) else { return }
            result.append(engine)
            used.insert(raw)
        }

        appendResolved(primaryID)
        if limit > 1 {
            appendResolved(secondaryID)
        }
        // 配置引擎都未检测到时，回退已检测列表
        if result.isEmpty {
            return Array(detected.prefix(limit))
        }
        return result
    }
}
