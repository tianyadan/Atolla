import Foundation
import SwiftUI

final class IslandViewModel: ObservableObject {
  @Published var presentation: IslandPresentation = .empty
  @Published var errorText: String = ""
  @Published var hasConfig = false

  let morph = IslandMorphDriver()

  private let api = AgentAPI()
  private var timer: Timer?
  private(set) var config: IslandConfig = .defaults()

  var notchWidth: CGFloat = 185
  var notchHeight: CGFloat = 32

  var expandedWidth: CGFloat { notchWidth + IslandMetrics.expandedExtraWidth }
  var expandedHeight: CGFloat { IslandMetrics.expandedHeight(notchH: notchHeight) }
  var events: [IslandEvent] { presentation.items }

  func start() {
    reloadConfig()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
      Task { await self?.refresh() }
    }
    Task { await refresh() }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  func reloadConfig() {
    if let c = IslandConfig.load() {
      config = c
      hasConfig = !c.token.isEmpty
    } else {
      config = .defaults()
      hasConfig = false
    }
  }

  @MainActor
  func refresh() async {
    reloadConfig()
    guard hasConfig else {
      presentation = .empty
      errorText = "请先登录管理台以同步凭证"
      return
    }
    do {
      presentation = try await api.fetchEvents(config: config)
      errorText = ""
    } catch {
      errorText = error.localizedDescription
    }
  }

  func open(_ event: IslandEvent) {
    // 终态点击即视为已读；审批只有裁决或过期后才由后端移除。
    if event.kind == .completed || event.kind == .error {
      let agentID = event.agent_id
      let cfg = config
      let remaining = events.filter { $0.id != event.id }
      presentation = IslandPresentation(
        active_kind: remaining.isEmpty ? nil : presentation.active_kind,
        count: max(0, presentation.count - 1),
        items: remaining
      )
      Task {
        await api.markRead(config: cfg, id: agentID)
        await refresh()
      }
    }
    api.openAgent(
      config: config,
      id: event.agent_id,
      approvalRequestID: event.kind == .approval ? event.request_id : nil
    )
  }

  /// 点主岛：直接 morph 展开
  func requestExpandFromMain() {
    morph.expand(toWidth: expandedWidth, toHeight: expandedHeight)
  }

  /// 点副岛：merge → 顺势 expand（禁止直接 expanded）
  func requestMergeThenExpand(travel: CGFloat) {
    morph.mergeThenExpand(
      toWidth: expandedWidth,
      toHeight: expandedHeight,
      travelDistance: travel
    )
  }

  /// 兼容旧名
  func requestExpand() {
    requestExpandFromMain()
  }

  func requestCollapse() {
    morph.collapse(toWidth: notchWidth, toHeight: notchHeight)
  }

  func toggleExpand() {
    if morph.targetExpanded {
      requestCollapse()
    } else {
      requestExpandFromMain()
    }
  }
}
