import SwiftUI
import WidgetKit

/// 桌面 CLI 用量小组件（中尺寸左右双栏；可配置展示哪两个）。
struct AtollaUsageWidget: Widget {
    static let kind = "AtollaUsageWidget"

    var body: some WidgetConfiguration {
        if #available(iOSApplicationExtension 17.0, *) {
            return AppIntentConfiguration(
                kind: Self.kind,
                intent: AtollaUsageWidgetIntent.self,
                provider: AtollaUsageIntentProvider()
            ) { entry in
                AtollaUsageWidgetView(entry: entry)
            }
            .configurationDisplayName("CLI 额度")
            .description("左右并排展示两个 CLI 额度；长按可选择显示哪两个。")
            .supportedFamilies([.systemSmall, .systemMedium])
        } else {
            return StaticConfiguration(kind: Self.kind, provider: AtollaUsageTimelineProvider()) { entry in
                AtollaUsageWidgetView(entry: entry)
            }
            .configurationDisplayName("CLI 额度")
            .description("左右并排展示两个 CLI 额度。")
            .supportedFamilies([.systemSmall, .systemMedium])
        }
    }
}

struct AtollaUsageEntry: TimelineEntry {
    let date: Date
    let snapshot: AtollaUsageSnapshot?
    let message: String?
    /// 左侧 / 上方引擎 id（auto/codex/cursor/claude）
    var primaryID: String = "auto"
    /// 右侧 / 下方引擎 id
    var secondaryID: String = "auto"
}

// MARK: - Providers

struct AtollaUsageTimelineProvider: TimelineProvider {
    static let refreshMinutes = 5

    func placeholder(in context: Context) -> AtollaUsageEntry {
        AtollaUsageEntry(date: Date(), snapshot: sampleSnapshot(), message: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (AtollaUsageEntry) -> Void) {
        Task {
            let snapshot = await AtollaUsageRemoteRefresh.refresh(forceFresh: false)
                ?? AtollaUsageSnapshotStore.loadSnapshot()
                ?? sampleSnapshot()
            completion(AtollaUsageEntry(date: Date(), snapshot: snapshot, message: nil))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AtollaUsageEntry>) -> Void) {
        Task {
            let snapshot = await AtollaUsageRemoteRefresh.refresh(forceFresh: true)
                ?? AtollaUsageSnapshotStore.loadSnapshot()
            let entry = makeEntry(snapshot: snapshot)
            let next = Calendar.current.date(byAdding: .minute, value: Self.refreshMinutes, to: Date())
                ?? Date().addingTimeInterval(TimeInterval(Self.refreshMinutes * 60))
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

@available(iOSApplicationExtension 17.0, *)
struct AtollaUsageIntentProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> AtollaUsageEntry {
        AtollaUsageEntry(date: Date(), snapshot: sampleSnapshot(), message: nil)
    }

    func snapshot(for configuration: AtollaUsageWidgetIntent, in context: Context) async -> AtollaUsageEntry {
        let snapshot = await AtollaUsageRemoteRefresh.refresh(forceFresh: false)
            ?? AtollaUsageSnapshotStore.loadSnapshot()
            ?? sampleSnapshot()
        return AtollaUsageEntry(
            date: Date(),
            snapshot: snapshot,
            message: nil,
            primaryID: configuration.primary.rawValue,
            secondaryID: configuration.secondary.rawValue
        )
    }

    func timeline(for configuration: AtollaUsageWidgetIntent, in context: Context) async -> Timeline<AtollaUsageEntry> {
        let snapshot = await AtollaUsageRemoteRefresh.refresh(forceFresh: true)
            ?? AtollaUsageSnapshotStore.loadSnapshot()
        let entry = makeEntry(
            snapshot: snapshot,
            primaryID: configuration.primary.rawValue,
            secondaryID: configuration.secondary.rawValue
        )
        let next = Calendar.current.date(
            byAdding: .minute,
            value: AtollaUsageTimelineProvider.refreshMinutes,
            to: Date()
        ) ?? Date().addingTimeInterval(TimeInterval(AtollaUsageTimelineProvider.refreshMinutes * 60))
        return Timeline(entries: [entry], policy: .after(next))
    }
}

private func makeEntry(
    snapshot: AtollaUsageSnapshot?,
    primaryID: String = "auto",
    secondaryID: String = "auto"
) -> AtollaUsageEntry {
    if let snapshot, !snapshot.engines.isEmpty {
        return AtollaUsageEntry(
            date: Date(),
            snapshot: snapshot,
            message: nil,
            primaryID: primaryID,
            secondaryID: secondaryID
        )
    }
    return AtollaUsageEntry(
        date: Date(),
        snapshot: snapshot.flatMap { $0.engines.isEmpty ? nil : $0 },
        message: "打开 Atolla 并解锁实例后，这里会显示已登录 CLI 额度",
        primaryID: primaryID,
        secondaryID: secondaryID
    )
}

private func sampleSnapshot() -> AtollaUsageSnapshot {
    AtollaUsageSnapshot(
        updatedAt: Date(),
        instanceID: nil,
        engines: [
            .init(
                id: "codex", name: "Codex", ok: true, error: nil,
                shortUsedPercent: 43, shortLabel: "5h", shortWindowMinutes: 300,
                shortResetHint: "5h 下次 23:41",
                longUsedPercent: 16, longLabel: "7天", longWindowMinutes: 10080,
                longResetHint: nil
            ),
            .init(
                id: "cursor", name: "Cursor", ok: true, error: nil,
                shortUsedPercent: 27, shortLabel: "Auto", shortWindowMinutes: nil,
                shortResetHint: nil,
                longUsedPercent: 28, longLabel: "All", longWindowMinutes: nil,
                longResetHint: nil
            ),
        ],
        sourceNote: nil
    )
}

// MARK: - View

struct AtollaUsageWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AtollaUsageEntry

    private let canvas = Color.white
    private let cardFill = Color(red: 0.96, green: 0.97, blue: 0.98)
    private let ink = Color(red: 0.11, green: 0.12, blue: 0.14)
    private let muted = Color(red: 0.52, green: 0.54, blue: 0.58)
    private let labelFill = Color(red: 0.93, green: 0.94, blue: 0.96)

    var body: some View {
        Group {
            if let snapshot = entry.snapshot, !snapshot.engines.isEmpty {
                content(snapshot)
            } else {
                emptyState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(AtollaWidgetCanvasBackground(canvas: canvas))
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            header(updatedAt: nil)
            Text(entry.message ?? "暂无已登录 CLI")
                .font(.caption2)
                .foregroundStyle(muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func content(_ snapshot: AtollaUsageSnapshot) -> some View {
        let limit = family == .systemSmall ? 1 : 2
        let engines = AtollaUsageEnginePicker.pick(
            from: snapshot,
            primaryID: entry.primaryID,
            secondaryID: entry.secondaryID,
            limit: limit
        )

        return VStack(alignment: .leading, spacing: 6) {
            header(updatedAt: snapshot.updatedAt)

            if family == .systemSmall {
                if let engine = engines.first {
                    engineCard(engine)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            } else {
                // 中尺寸：严格左右双栏，等宽等高，吃满剩余高度消除底部空白
                HStack(alignment: .top, spacing: 8) {
                    ForEach(engines) { engine in
                        engineCard(engine)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                    // 只检测到 1 个时仍占半栏，避免单卡被拉满变丑
                    if engines.count == 1 {
                        Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func header(updatedAt: Date?) -> some View {
        HStack(spacing: 5) {
            Image("BrandJellyfish")
                .resizable()
                .scaledToFit()
                .frame(width: 15, height: 15)
            Text("CLI 额度")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ink)
            Spacer(minLength: 6)
            if let updatedAt {
                Text("更新 \(updatedAt, style: .time)")
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(muted)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// 单引擎卡片：名称 → 两行额度 → 底部重置（无图标）。
    private func engineCard(_ engine: AtollaUsageDisplayEngine) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(engine.name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ink)
                .lineLimit(1)

            VStack(alignment: .leading, spacing: 4) {
                if engine.shortUsedPercent != nil {
                    meterRow(label: engine.shortLabel ?? "5h", used: engine.shortUsedPercent)
                }
                if engine.longUsedPercent != nil {
                    meterRow(label: engine.longLabel ?? "月", used: engine.longUsedPercent)
                }
            }

            Spacer(minLength: 0)

            if let hint = engine.shortResetHint, !hint.isEmpty {
                Text(hint)
                    .font(.system(size: 9, weight: .regular))
                    .foregroundStyle(muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(cardFill)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// 标签 + 自适应进度条 + 百分比；百分比等宽右对齐，两卡视觉对齐。
    private func meterRow(label: String, used: Int?) -> some View {
        let pct = used ?? 0
        return HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(ink.opacity(0.55))
                .padding(.horizontal, 5)
                .padding(.vertical, 1.5)
                .background(labelFill)
                .clipShape(Capsule())
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .layoutPriority(1)

            ProgressTrack(progress: Double(pct) / 100.0, tone: barTone(used: pct))
                .frame(maxWidth: .infinity)
                .frame(height: 5)

            Text(used == nil ? "—" : "\(pct)%")
                .font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundStyle(barTone(used: pct).opacity(0.95))
                .lineLimit(1)
                .frame(minWidth: 28, alignment: .trailing)
                .layoutPriority(1)
        }
    }

    private func barTone(used: Int) -> Color {
        if used >= 90 { return Color(red: 0.92, green: 0.38, blue: 0.38) }
        if used >= 55 { return Color(red: 0.95, green: 0.62, blue: 0.22) }
        return Color(red: 0.28, green: 0.74, blue: 0.48)
    }
}

/// 自适应宽度进度条（随父布局伸缩，避免固定宽挤压）。
private struct ProgressTrack: View {
    let progress: Double
    let tone: Color

    var body: some View {
        GeometryReader { geo in
            let clamped = min(1, max(0, progress))
            ZStack(alignment: .leading) {
                Capsule().fill(Color.black.opacity(0.06))
                Capsule()
                    .fill(tone)
                    .frame(width: max(3, geo.size.width * clamped))
            }
        }
    }
}

/// 兼容 deployment 16.2：17+ 用 containerBackground。
private struct AtollaWidgetCanvasBackground: ViewModifier {
    let canvas: Color

    func body(content: Content) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(canvas, for: .widget)
        } else {
            content.background(canvas)
        }
    }
}
