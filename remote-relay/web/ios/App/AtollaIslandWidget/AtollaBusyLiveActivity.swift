import ActivityKit
import SwiftUI
import WidgetKit

private let islandPurple = Color(red: 0.72, green: 0.42, blue: 0.98)
private let islandGreen = Color(red: 0.34, green: 0.86, blue: 0.52)
private let islandYellow = Color(red: 1.0, green: 0.82, blue: 0.38)
private let islandRed = Color(red: 1.0, green: 0.43, blue: 0.46)

/// 单个 Live Activity 承载报错、审批、运行中和已完成四种状态。
struct AtollaBusyLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AtollaBusyAttributes.self) { context in
      IslandExpandedList(state: context.state, lockScreen: true)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .activityBackgroundTint(Color.black.opacity(0.92))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let state = context.state
      let first = state.items.first
      let count = max(state.count, state.items.count)

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            IslandStatusIcon(kind: state.activeKind, item: first, size: 18, animPhase: state.animPhase)
            Text("Atolla")
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(.white.opacity(0.45))
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 22, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(statusColor(state.activeKind))
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(count) 项\(statusTitle(state.activeKind))")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          IslandExpandedList(state: state)
            .padding(.top, 2)
        }
      } compactLeading: {
        IslandStatusIcon(kind: state.activeKind, item: first, size: 15, animPhase: state.animPhase)
      } compactTrailing: {
        Text(count > 99 ? "99+" : "\(count)")
          .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(statusColor(state.activeKind))
          .minimumScaleFactor(0.7)
      } minimal: {
        IslandStatusIcon(kind: state.activeKind, item: first, size: 15, animPhase: state.animPhase)
      }
      .widgetURL(first.flatMap { URL(string: $0.deepLink) })
      .keylineTint(statusColor(state.activeKind))
    }
  }
}

private func statusColor(_ kind: String) -> Color {
  switch kind {
  case "error": return islandRed
  case "approval": return islandYellow
  case "completed": return islandGreen
  default: return islandPurple
  }
}

private func statusTitle(_ kind: String) -> String {
  switch kind {
  case "error": return "报错"
  case "approval": return "待审批"
  case "completed": return "已完成"
  default: return "运行中"
  }
}

private func statusSymbol(_ kind: String) -> String {
  switch kind {
  case "error": return "xmark.circle.fill"
  case "approval": return "exclamationmark.circle.fill"
  case "completed": return "checkmark.circle.fill"
  default: return "circle.fill"
  }
}

private struct IslandStatusIcon: View {
  let kind: String
  let item: AtollaBusyAttributes.IslandItemSlice?
  let size: CGFloat
  let animPhase: Int

  var body: some View {
    if kind == "running", let item {
      JellyAvatarView(
        color: item.jellyColor,
        size: size,
        state: .working,
        animPhase: animPhase
      )
    } else {
      StatusSymbolImage(kind: kind, size: size)
    }
  }
}

private struct StatusSymbolImage: View {
  let kind: String
  let size: CGFloat

  @ViewBuilder
  var body: some View {
    if #available(iOSApplicationExtension 17.0, *) {
      Image(systemName: statusSymbol(kind))
        .font(.system(size: size, weight: .semibold))
        .foregroundStyle(statusColor(kind))
        .symbolEffect(.pulse, value: kind)
    } else {
      Image(systemName: statusSymbol(kind))
        .font(.system(size: size, weight: .semibold))
        .foregroundStyle(statusColor(kind))
    }
  }
}

private struct IslandExpandedList: View {
  let state: AtollaBusyAttributes.ContentState
  var lockScreen = false

  var body: some View {
    let rows = Array(state.items.prefix(3))
    VStack(alignment: .leading, spacing: 0) {
      if lockScreen {
        HStack {
          Text("Atolla · \(statusTitle(state.activeKind))")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white.opacity(0.65))
          Spacer()
          Text(state.count > 99 ? "99+" : "\(state.count)")
            .font(.system(size: 18, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(statusColor(state.activeKind))
        }
        .padding(.bottom, 4)
      }
      ForEach(rows, id: \.id) { item in
        IslandEventRow(item: item, animPhase: state.animPhase)
      }
      if state.count > rows.count {
        Text("还有 \(state.count - rows.count) 项")
          .font(.system(size: 10))
          .foregroundStyle(.white.opacity(0.35))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
          .padding(.top, 2)
      }
    }
  }
}

private struct IslandEventRow: View {
  let item: AtollaBusyAttributes.IslandItemSlice
  let animPhase: Int

  @ViewBuilder
  var body: some View {
    if let url = URL(string: item.deepLink), !item.deepLink.isEmpty {
      Link(destination: url) { rowContent }
    } else {
      rowContent
    }
  }

  private var rowContent: some View {
    HStack(spacing: 8) {
      IslandStatusIcon(kind: item.kind, item: item, size: 19, animPhase: animPhase)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 5) {
          Text(item.agentName)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white)
            .lineLimit(1)
          Text(item.department.isEmpty ? "未分组" : item.department)
            .font(.system(size: 10))
            .foregroundStyle(.white.opacity(0.4))
            .lineLimit(1)
        }
        HStack(spacing: 4) {
          Text(item.summary.isEmpty ? statusTitle(item.kind) : item.summary)
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.55))
            .lineLimit(1)
          Text("·")
            .foregroundStyle(.white.opacity(0.25))
          IslandEventMeta(item: item)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 4)
    .frame(height: 36)
  }
}

private struct IslandEventMeta: View {
  let item: AtollaBusyAttributes.IslandItemSlice

  var body: some View {
    if item.kind == "running", item.occurredAt > 0 {
      let start = Date(timeIntervalSince1970: item.occurredAt)
      Text(timerInterval: start...Date.distantFuture, countsDown: false, showsHours: true)
        .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(statusColor(item.kind))
    } else if item.durationMs >= 0 {
      Text(durationText(item.durationMs))
        .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(statusColor(item.kind))
    } else if item.occurredAt > 0 {
      Text(Date(timeIntervalSince1970: item.occurredAt), style: .time)
        .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(statusColor(item.kind))
    } else {
      Text("—")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(.white.opacity(0.35))
    }
  }
}

private func durationText(_ milliseconds: Int) -> String {
  let seconds = max(0, milliseconds / 1000)
  if seconds >= 3600 {
    return String(format: "%d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
  }
  return String(format: "%d:%02d", seconds / 60, seconds % 60)
}
