import ActivityKit
import SwiftUI
import WidgetKit

private let islandPurple = Color(red: 0.72, green: 0.42, blue: 0.98)
private let islandGreen = Color(red: 0.34, green: 0.86, blue: 0.52)
private let islandYellow = Color(red: 1.0, green: 0.82, blue: 0.38)
private let islandRed = Color(red: 1.0, green: 0.43, blue: 0.46)

/// 单个 Live Activity 承载报错、审批、运行中、任务规划重点、已完成。
struct AtollaBusyLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AtollaBusyAttributes.self) { context in
      IslandLockScreenBody(state: context.state)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .activityBackgroundTint(Color.black.opacity(0.92))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let state = context.state
      let first = state.items.first
      let count = max(state.count, state.items.count)
      let isPlan = state.presentation == "task_plan" || state.activeKind == "task_plan"

      return DynamicIsland {
        // 展开态：去掉左上水母+Atolla、中间重复「N 项」；右上只留总数
        DynamicIslandExpandedRegion(.leading) {
          EmptyView()
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 20, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(statusColor(state.activeKind))
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          EmptyView()
        }
        DynamicIslandExpandedRegion(.bottom) {
          if state.syncPaused {
            Text(syncPausedCaption(updatedAt: state.updatedAt))
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(.white.opacity(0.55))
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.top, 2)
          }
          if isPlan, let item = first {
            IslandTaskPlanFocus(item: item, syncPaused: state.syncPaused)
              .padding(.top, 2)
          } else {
            IslandExpandedList(state: state)
              .padding(.top, 2)
          }
        }
      } compactLeading: {
        if isDefaultRunning(state.activeKind) || state.activeKind == "task_plan" {
          IslandAppMark(size: 20)
        } else if state.activeKind == "error" {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(islandRed)
        } else {
          IslandStatusIcon(kind: state.activeKind, item: first, size: 15, animPhase: 0)
        }
      } compactTrailing: {
        if state.syncPaused {
          Text("已暂停")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white.opacity(0.75))
            .minimumScaleFactor(0.65)
            .lineLimit(1)
        } else if isDefaultRunning(state.activeKind) {
          Text(count > 99 ? "99+ 项运行中" : "\(count) 项运行中")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
            .minimumScaleFactor(0.65)
            .lineLimit(1)
        } else if state.activeKind == "task_plan", let item = first {
          Text("\(max(0, min(100, item.progress)))%")
            .font(.system(size: 13, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(islandPurple)
            .minimumScaleFactor(0.7)
        } else if state.activeKind == "approval" {
          ApprovalCountdownText(items: state.items, count: count)
        } else if state.activeKind == "error" {
          Text("出错啦")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(islandRed)
            .minimumScaleFactor(0.7)
            .lineLimit(1)
        } else {
          Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(statusColor(state.activeKind))
            .minimumScaleFactor(0.7)
        }
      } minimal: {
        if isDefaultRunning(state.activeKind) || state.activeKind == "task_plan" {
          IslandAppMark(size: 15)
        } else if state.activeKind == "error" {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(islandRed)
        } else {
          IslandStatusIcon(kind: state.activeKind, item: first, size: 15, animPhase: 0)
        }
      }
      .widgetURL(first.flatMap { URL(string: $0.deepLink) })
      .keylineTint(
        isDefaultRunning(state.activeKind) || state.activeKind == "task_plan"
          ? Color.white.opacity(0.35)
          : statusColor(state.activeKind)
      )
    }
  }
}

private func isDefaultRunning(_ kind: String) -> Bool {
  kind == "running" || kind.isEmpty
}

private struct IslandAppMark: View {
  let size: CGFloat

  var body: some View {
    Image("AppMark")
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
  }
}

private struct ApprovalCountdownText: View {
  let items: [AtollaBusyAttributes.IslandItemSlice]
  let count: Int

  var body: some View {
    if let end = soonestExpiry(items), end > Date() {
      Text(timerInterval: Date()...end, countsDown: true, showsHours: false)
        .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
        .foregroundStyle(islandYellow)
        .multilineTextAlignment(.trailing)
        .frame(minWidth: 36)
        .minimumScaleFactor(0.7)
    } else {
      Text(count > 99 ? "99+" : "\(max(count, 1))")
        .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
        .foregroundStyle(islandYellow)
        .minimumScaleFactor(0.7)
    }
  }

  private func soonestExpiry(_ items: [AtollaBusyAttributes.IslandItemSlice]) -> Date? {
    let dates = items
      .map(\.expiresAt)
      .filter { $0 > 0 }
      .map { Date(timeIntervalSince1970: $0) }
      .filter { $0 > Date().addingTimeInterval(-1) }
    return dates.min()
  }
}

private func statusColor(_ kind: String) -> Color {
  switch kind {
  case "error": return islandRed
  case "approval": return islandYellow
  case "completed": return islandGreen
  case "task_plan": return islandPurple
  default: return islandPurple
  }
}

private func statusTitle(_ kind: String) -> String {
  switch kind {
  case "error": return "报错"
  case "approval": return "待审批"
  case "completed": return "已完成"
  case "task_plan": return "任务规划"
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

/// 静态水母色头像（展开列表不用跳动动画）。
private struct IslandStatusIcon: View {
  let kind: String
  let item: AtollaBusyAttributes.IslandItemSlice?
  let size: CGFloat
  let animPhase: Int

  var body: some View {
    if (kind == "running" || kind == "task_plan"), let item {
      JellyAvatarView(
        color: item.jellyColor,
        size: size,
        state: .idle,
        animPhase: 0
      )
    } else {
      Image(systemName: statusSymbol(kind))
        .font(.system(size: size, weight: .semibold))
        .foregroundStyle(statusColor(kind))
    }
  }
}

// MARK: - Expanded / Lock Screen

private struct IslandLockScreenBody: View {
  let state: AtollaBusyAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Atolla · \(statusTitle(state.activeKind))")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.white.opacity(0.65))
        Spacer()
        Text(state.count > 99 ? "99+" : "\(state.count)")
          .font(.system(size: 18, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(statusColor(state.activeKind))
      }
      if state.syncPaused {
        Text(syncPausedCaption(updatedAt: state.updatedAt))
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.white.opacity(0.5))
      }
      if state.presentation == "task_plan" || state.activeKind == "task_plan",
         let item = state.items.first {
        IslandTaskPlanFocus(item: item, syncPaused: state.syncPaused)
      } else {
        IslandExpandedList(state: state)
      }
    }
  }
}

/// 后台同步暂停提示
private func syncPausedCaption(updatedAt: Double) -> String {
  guard updatedAt > 0 else { return "后台同步暂停" }
  let date = Date(timeIntervalSince1970: updatedAt)
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "zh_CN")
  formatter.dateFormat = "HH:mm"
  return "后台同步暂停 · 最后更新于 \(formatter.string(from: date))"
}

/// 任务规划重点模式：单 agent 进度条 + 当前步骤。
private struct IslandTaskPlanFocus: View {
  let item: AtollaBusyAttributes.IslandItemSlice
  var syncPaused: Bool = false

  var body: some View {
    let pct = max(0, min(100, item.progress))
    let stepLabel: String = {
      if item.planTotal > 0 {
        let cur = max(1, min(item.planTotal, item.planCurrent > 0 ? item.planCurrent : 1))
        return "\(cur)/\(item.planTotal)"
      }
      return ""
    }()

    return Group {
      if let url = URL(string: item.deepLink), !item.deepLink.isEmpty {
        Link(destination: url) { content(pct: pct, stepLabel: stepLabel) }
      } else {
        content(pct: pct, stepLabel: stepLabel)
      }
    }
  }

  private func content(pct: Int, stepLabel: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        JellyAvatarView(color: item.jellyColor, size: 22, state: .idle, animPhase: 0)
        VStack(alignment: .leading, spacing: 1) {
          Text(item.agentName)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
          Text(subtitle)
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.55))
            .lineLimit(1)
        }
        Spacer(minLength: 4)
        Text("\(pct)%")
          .font(.system(size: 16, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(islandPurple.opacity(syncPaused ? 0.7 : 1))
      }
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.12))
          Capsule()
            .fill(islandPurple)
            .frame(width: max(4, geo.size.width * CGFloat(pct) / 100.0))
        }
      }
      .frame(height: 6)
      if !item.planStepTitle.isEmpty || !stepLabel.isEmpty {
        HStack(spacing: 6) {
          if !stepLabel.isEmpty {
            Text(stepLabel)
              .font(.system(size: 10, weight: .semibold).monospacedDigit())
              .foregroundStyle(.white.opacity(0.45))
          }
          Text(item.planStepTitle.isEmpty ? "任务进行中" : item.planStepTitle)
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.7))
            .lineLimit(1)
        }
      }
    }
    .padding(.horizontal, 4)
  }

  private var subtitle: String {
    let dept = item.department.isEmpty ? "未分组" : item.department
    let work = item.workStatus.isEmpty ? statusTitle(item.kind) : item.workStatus
    if syncPaused {
      return "\(dept) · 同步暂停"
    }
    return "\(dept) · \(work)"
  }
}

private struct IslandExpandedList: View {
  let state: AtollaBusyAttributes.ContentState

  var body: some View {
    let rows = Array(state.items.prefix(3))
    VStack(alignment: .leading, spacing: 0) {
      ForEach(rows, id: \.id) { item in
        IslandEventRow(item: item, syncPaused: state.syncPaused, updatedAt: state.updatedAt)
      }
      if state.count > rows.count {
        moreRow
      }
    }
  }

  @ViewBuilder
  private var moreRow: some View {
    let label = "还有 \(state.count - min(3, state.items.count)) 项 · 查看全部"
    if let url = URL(string: state.moreDeepLink), !state.moreDeepLink.isEmpty {
      Link(destination: url) {
        Text(label)
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(.white.opacity(0.4))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
          .padding(.top, 4)
      }
    } else {
      Text(label)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.white.opacity(0.4))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .padding(.top, 4)
    }
  }
}

private struct IslandEventRow: View {
  let item: AtollaBusyAttributes.IslandItemSlice
  var syncPaused: Bool = false
  var updatedAt: Double = 0

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
      IslandStatusIcon(kind: item.kind, item: item, size: 22, animPhase: 0)
      VStack(alignment: .leading, spacing: 1) {
        Text(item.agentName)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(.white)
          .lineLimit(1)
        Text(subtitle)
          .font(.system(size: 11))
          .foregroundStyle(.white.opacity(0.55))
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      VStack(alignment: .trailing, spacing: 2) {
        IslandEventMeta(item: item, syncPaused: syncPaused, updatedAt: updatedAt)
        Text(syncPaused ? "同步暂停" : statusTitle(item.kind))
          .font(.system(size: 9, weight: .medium))
          .foregroundStyle(.white.opacity(0.35))
      }
    }
    .padding(.horizontal, 4)
    .frame(minHeight: 40)
  }

  private var subtitle: String {
    let dept = item.department.isEmpty ? "未分组" : item.department
    let work = item.workStatus.isEmpty
      ? (item.summary.isEmpty ? statusTitle(item.kind) : item.summary)
      : item.workStatus
    return "\(dept) · \(work)"
  }
}

private struct IslandEventMeta: View {
  let item: AtollaBusyAttributes.IslandItemSlice
  var syncPaused: Bool = false
  var updatedAt: Double = 0

  var body: some View {
    // 后台暂停：冻结计时，展示最后同步时刻，避免继续「假增长」
    if syncPaused, updatedAt > 0 {
      Text(Date(timeIntervalSince1970: updatedAt), style: .time)
        .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(.white.opacity(0.75))
    } else if !syncPaused, item.kind == "running" || item.kind == "task_plan", item.occurredAt > 0 {
      let start = Date(timeIntervalSince1970: item.occurredAt)
      Text(timerInterval: start...Date.distantFuture, countsDown: false, showsHours: true)
        .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(.white)
    } else if item.durationMs >= 0 {
      Text(durationText(item.durationMs))
        .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(statusColor(item.kind))
    } else if item.occurredAt > 0 {
      Text(Date(timeIntervalSince1970: item.occurredAt), style: .time)
        .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(statusColor(item.kind))
    } else {
      Text("—")
        .font(.system(size: 12, weight: .semibold))
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
