import ActivityKit
import SwiftUI
import WidgetKit

private let islandPurple = Color(red: 0.72, green: 0.42, blue: 0.98)

/// 忙碌数字人 Live Activity（水母跳动靠 ContentState.animPhase）
struct AtollaBusyLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AtollaBusyAttributes.self) { context in
      LockScreenBusyView(state: context.state)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .activityBackgroundTint(Color.black.opacity(0.92))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let agents = context.state.agents
      let first = agents.first
      let count = max(context.state.count, agents.count)
      let phase = context.state.animPhase

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            if let first {
              JellyAvatarView(
                color: first.jellyColor,
                size: 18,
                state: .from(statusLabel: first.statusLabel),
                animPhase: phase
              )
            }
            Text("Atolla")
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(.white.opacity(0.45))
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 22, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(islandPurple)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          if count == 1, let first {
            Text(first.name)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(.white)
              .lineLimit(1)
          } else if count > 1 {
            Text("\(count) 位忙碌中")
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(.white)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if count == 1, let first {
            SingleBusyDetail(agent: first)
              .padding(.top, 2)
          } else {
            BusyAgentListView(agents: agents, animPhase: phase, maxRows: 3)
              .padding(.top, 2)
          }
        }
      } compactLeading: {
        if let first {
          JellyAvatarView(
            color: first.jellyColor,
            size: 15,
            state: .from(statusLabel: first.statusLabel),
            animPhase: phase
          )
        } else {
          Image(systemName: "sparkles")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(islandPurple)
        }
      } compactTrailing: {
        Text(count > 99 ? "99+" : "\(count)")
          .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(islandPurple)
          .minimumScaleFactor(0.7)
      } minimal: {
        Text(count > 9 ? "9+" : "\(count)")
          .font(.system(size: 12, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(islandPurple)
      }
      .widgetURL(URL(string: "atolla://island"))
      .keylineTint(islandPurple)
    }
  }
}

private struct ElapsedTimerText: View {
  let runStartedAt: Double
  var font: Font = .system(size: 13, weight: .semibold, design: .rounded)

  var body: some View {
    if runStartedAt > 0 {
      let start = Date(timeIntervalSince1970: runStartedAt)
      Text(timerInterval: start...Date.distantFuture, countsDown: false, showsHours: true)
        .font(font.monospacedDigit())
        .foregroundStyle(islandPurple)
        .multilineTextAlignment(.leading)
        .monospacedDigit()
    } else {
      Text("—")
        .font(font)
        .foregroundStyle(islandPurple.opacity(0.6))
    }
  }
}

private struct SingleBusyDetail: View {
  let agent: AtollaBusyAttributes.BusyAgentSlice

  var body: some View {
    HStack(spacing: 8) {
      Text(agent.statusLabel.isEmpty ? "运行中" : agent.statusLabel)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(.white.opacity(0.85))
      Text("·")
        .foregroundStyle(.white.opacity(0.3))
      ElapsedTimerText(runStartedAt: agent.runStartedAt)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 4)
  }
}

private struct BusyAgentListView: View {
  let agents: [AtollaBusyAttributes.BusyAgentSlice]
  var animPhase: Int = 0
  var maxRows: Int = 4

  var body: some View {
    let rows = Array(agents.prefix(maxRows))
    VStack(spacing: 0) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, agent in
        BusyAgentRow(agent: agent, animPhase: animPhase)
      }
      if agents.count > maxRows {
        Text("还有 \(agents.count - maxRows) 位…")
          .font(.system(size: 10))
          .foregroundStyle(.white.opacity(0.35))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
          .padding(.top, 2)
      }
    }
  }
}

private struct BusyAgentRow: View {
  let agent: AtollaBusyAttributes.BusyAgentSlice
  var animPhase: Int = 0

  var body: some View {
    HStack(spacing: 8) {
      JellyAvatarView(
        color: agent.jellyColor,
        size: 20,
        state: .from(statusLabel: agent.statusLabel),
        animPhase: animPhase
      )
      VStack(alignment: .leading, spacing: 1) {
        Text(agent.name)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white)
          .lineLimit(1)
        HStack(spacing: 4) {
          Text(agent.statusLabel.isEmpty ? "运行中" : agent.statusLabel)
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.45))
            .lineLimit(1)
          Text("·")
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.3))
          ElapsedTimerText(
            runStartedAt: agent.runStartedAt,
            font: .system(size: 11, weight: .semibold, design: .rounded)
          )
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 4)
    .frame(height: 32)
  }
}

private struct LockScreenBusyView: View {
  let state: AtollaBusyAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Atolla")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.white.opacity(0.45))
        Spacer()
        Text(state.count > 99 ? "99+" : "\(state.count)")
          .font(.system(size: 18, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(islandPurple)
      }
      BusyAgentListView(agents: state.agents, animPhase: state.animPhase, maxRows: 4)
    }
  }
}
