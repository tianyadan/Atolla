import SwiftUI

/// 灵动岛静态尺寸（动画节奏见 IslandMorphDriver）。
enum IslandMetrics {
  static let expandedExtraWidth: CGFloat = 120
  static let rowHeight: CGFloat = 34
  static let maxVisibleRows: CGFloat = 3
  static let listBottomPad: CGFloat = 6
  static let badgeSize: CGFloat = 22
  static let badgeGap: CGFloat = 14
  static let purpleCount = Color(red: 0.72, green: 0.42, blue: 0.98)

  static var fixedListHeight: CGFloat {
    maxVisibleRows * rowHeight + listBottomPad
  }

  static func expandedHeight(notchH: CGFloat) -> CGFloat {
    notchH + 1 + fixedListHeight
  }

  static var badgeSideExtra: CGFloat { badgeGap + badgeSize }

  static var openAnimation: Animation {
    .spring(response: 0.40, dampingFraction: 0.82, blendDuration: 0)
  }

  static var closeAnimation: Animation {
    .spring(response: 0.36, dampingFraction: 0.90, blendDuration: 0)
  }
}

final class IslandLayoutEditor: ObservableObject {
  @Published private(set) var layout: IslandLayout

  private let onMove: (CGSize, Bool) -> Void
  private let onResize: (IslandResizeEdge, CGSize, Bool) -> Void
  private let onToggleAspectRatio: () -> Void
  private let onReset: () -> Void

  init(
    layout: IslandLayout,
    onMove: @escaping (CGSize, Bool) -> Void,
    onResize: @escaping (IslandResizeEdge, CGSize, Bool) -> Void,
    onToggleAspectRatio: @escaping () -> Void,
    onReset: @escaping () -> Void
  ) {
    self.layout = layout
    self.onMove = onMove
    self.onResize = onResize
    self.onToggleAspectRatio = onToggleAspectRatio
    self.onReset = onReset
  }

  func update(layout: IslandLayout) {
    self.layout = layout
  }

  func move(by translation: CGSize, completed: Bool) {
    onMove(translation, completed)
  }

  func resize(edge: IslandResizeEdge, by translation: CGSize, completed: Bool) {
    onResize(edge, translation, completed)
  }

  func toggleAspectRatio() {
    onToggleAspectRatio()
  }

  func reset() {
    onReset()
  }
}

/// 主岛 + 副岛同一坐标空间；mergeProgress 驱动吸收，再顺势 expand。
struct IslandRootView: View {
  @ObservedObject var model: IslandViewModel
  @ObservedObject var morph: IslandMorphDriver
  @ObservedObject var layoutEditor: IslandLayoutEditor
  var notch: NotchGeometry
  @State private var isLayoutEditorHovering = false

  private var collapsedW: CGFloat { notch.width }
  private var collapsedH: CGFloat { notch.height }
  private var expandedW: CGFloat { notch.width + IslandMetrics.expandedExtraWidth }
  private var eventCount: Int { model.presentation.count }
  private var showSecondary: Bool {
    eventCount > 0 && morph.secondaryInLayout && morph.contentProgress < 0.35
  }

  /// 收起态（含 merge）：统一用「有活动」布局，主岛宽固定为刘海宽，不再因无角标换成另一种宽度
  private var useCollapsedChromeLayout: Bool {
    morph.phase == .collapsed || morph.phase == .merging || morph.contentProgress < 0.35
  }

  /// 主岛绘制宽度：收起态始终 = 刘海宽（与有活动时相同）；展开跟 morph
  private var shapeWidth: CGFloat {
    let stretch = (morph.phase == .merging || morph.phase == .collapsed) ? morph.mainRightStretch : 0
    let base = useCollapsedChromeLayout ? collapsedW : morph.width
    return base + stretch
  }

  private var panelWidth: CGFloat {
    if useCollapsedChromeLayout {
      // 与有活动时同一套：刘海 + 左右角标位（无活动时右侧留空，不放大主岛）
      return collapsedW + 2 * IslandMetrics.badgeSideExtra + (morph.phase == .merging ? morph.mainRightStretch : 0)
    }
    return max(morph.width, collapsedW)
  }

  private var panelHeight: CGFloat {
    max(morph.height, useCollapsedChromeLayout ? IslandMetrics.badgeSize : morph.height)
  }

  private var layoutWidthScale: CGFloat { max(0.1, layoutEditor.layout.widthScale) }
  private var layoutHeightScale: CGFloat { max(0.1, layoutEditor.layout.heightScale) }

  /// 主岛左缘：收起态始终与有活动时相同（左侧角标位留白）；stretch 溢出时钳制
  private var mainLeadingX: CGFloat {
    if useCollapsedChromeLayout {
      let ideal = IslandMetrics.badgeSideExtra
      let maxLeading = max(0, panelWidth - shapeWidth)
      return min(ideal, maxLeading)
    }
    return max(0, (panelWidth - shapeWidth) / 2)
  }

  /// 副岛静止中心 X（面板坐标）
  private var secondaryRestCenterX: CGFloat {
    mainLeadingX + collapsedW + IslandMetrics.badgeGap + IslandMetrics.badgeSize / 2
  }

  private var secondaryCenterX: CGFloat {
    secondaryRestCenterX + morph.secondaryOffsetX
  }

  private var secondaryCenterY: CGFloat {
    max(collapsedH, IslandMetrics.badgeSize) / 2
  }

  /// 副岛并入行程
  private var mergeTravel: CGFloat {
    IslandMetrics.badgeGap + IslandMetrics.badgeSize / 2 + morph.mergeOverlap
  }

  var body: some View {
    ZStack(alignment: .topLeading) {
      // —— 主岛：左右镜像 MacNotchShape；frame 必须完整落入 panel，禁止右侧 clip ——
      let notchShape = MacNotchShape.from(morph: morph)
      notchShape
        .fill(Color.black)
        .overlay(
          notchShape
            .stroke(Color.white.opacity(0.06 * morph.contentProgress), lineWidth: 0.5)
        )
        .frame(width: shapeWidth, height: morph.height, alignment: .topLeading)
        .offset(x: mainLeadingX, y: 0)
        .allowsHitTesting(false)

      // —— 液态桥：主岛右缘 ↔ 副岛 ——
      if morph.bridgeProgress > 0.01, showSecondary || morph.phase == .merging {
        mergeBridge
          .allowsHitTesting(false)
      }

      // —— 副岛圆形 + 数字（始终同层，不 if 删除到 merge 完）——
      if showSecondary || morph.phase == .merging {
        secondaryIsland
      }

      // 主岛点击热区（刘海本体）
      if morph.phase == .collapsed || morph.phase == .merging {
        Color.clear
          .frame(width: collapsedW, height: collapsedH)
          .contentShape(Rectangle())
          .offset(x: mainLeadingX, y: 0)
          .onTapGesture { model.requestExpandFromMain() }
          .allowsHitTesting(morph.phase == .collapsed)
      }

      // 展开内容
      expandedContent(width: expandedW)
        .frame(width: morph.width, height: morph.height, alignment: .top)
        .offset(x: mainLeadingX, y: 0)
        .clipped()
        .opacity(Double(morph.contentProgress))
        .offset(y: (1 - morph.contentProgress) * 5)
        .scaleEffect(0.97 + 0.03 * morph.contentProgress, anchor: .top)
        .allowsHitTesting(morph.contentProgress > 0.45)
    }
    .frame(width: panelWidth, height: panelHeight, alignment: .topLeading)
    // 尺寸偏好以渲染缩放叠加在 morph 之上，避免展开/收起时回退到默认刘海尺寸。
    .scaleEffect(x: layoutWidthScale, y: layoutHeightScale, anchor: .topLeading)
    .frame(
      width: panelWidth * layoutWidthScale,
      height: panelHeight * layoutHeightScale,
      alignment: .topLeading
    )
    .overlay(alignment: .topLeading) {
      IslandLayoutEditOverlay(editor: layoutEditor, isHovering: isLayoutEditorHovering)
    }
    // morph 已由 DisplayLink 逐帧插值，禁止 SwiftUI 隐式动画再插一层（会掉帧/卡顿）
    .transaction { $0.animation = nil }
    .onAppear {
      morph.syncIdle(width: collapsedW, height: collapsedH, expanded: false)
    }
    .onHover { isLayoutEditorHovering = $0 }
  }

  /// 副岛：位置/缩放/数字透明度由 mergeProgress 派生量驱动
  private var secondaryIsland: some View {
    let size = IslandMetrics.badgeSize * morph.secondaryScale
    return ZStack {
      Circle()
        .fill(Color.black)
        .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 0.5))
      HStack(spacing: 1) {
        if model.presentation.active_kind == .running {
          JellyAvatarView(
            color: model.events.first?.jelly_color ?? "blue",
            size: 10,
            state: .working
          )
        } else {
          IslandStatusSymbol(kind: model.presentation.active_kind, size: 10)
        }
        Text(eventCount > 99 ? "99+" : "\(eventCount)")
          .font(.system(size: eventCount > 9 ? 6 : 7, weight: .bold, design: .rounded))
          .foregroundStyle(statusColor)
          .minimumScaleFactor(0.6)
      }
      .opacity(morph.secondaryTextOpacity)
    }
    .frame(width: size, height: size)
    .position(x: secondaryCenterX, y: secondaryCenterY)
    .opacity(Double(max(0, 1 - morph.mergeProgress * 0.15))) // 末段略融进主岛，不 abrupt 0
    .onTapGesture {
      model.requestMergeThenExpand(travel: mergeTravel)
    }
    .allowsHitTesting(morph.phase == .collapsed && !morph.blocksSecondaryTap)
    .help("\(eventCount) 个\(statusLabel)事件")
  }

  /// 主岛右缘与副岛之间的液态桥（Capsule 几何连接）
  private var mergeBridge: some View {
    let mainRight = mainLeadingX + morph.width + morph.mainRightStretch
    let secR = IslandMetrics.badgeSize * morph.secondaryScale / 2
    let secLeft = secondaryCenterX - secR
    let gap = max(0, secLeft - mainRight)
    let bridgeW = max(4, (mainRight + morph.bridgeProgress * 8) - (secLeft - morph.bridgeProgress * 6) + (1 - gap / 40) * 12)
    // 桥中心
    let midX = (mainRight + secLeft) / 2
    let bridgeH = IslandMetrics.badgeSize * (0.35 + 0.55 * morph.bridgeProgress) * morph.secondaryScale
    return Capsule(style: .continuous)
      .fill(Color.black)
      .frame(width: max(bridgeW, abs(secLeft - mainRight) + 6), height: bridgeH)
      .position(x: midX, y: secondaryCenterY)
      .opacity(Double(morph.bridgeProgress))
  }

  private func expandedContent(width: CGFloat) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        Spacer(minLength: 0)
        Button { model.requestCollapse() } label: {
          Image(systemName: "xmark")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white.opacity(0.45))
            .frame(width: 18, height: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(IslandPressStyle())
        .help("收起")
      }
      .padding(.horizontal, 12)
      .frame(width: width, height: collapsedH)

      Divider().overlay(Color.white.opacity(0.08))

      // 任何情况都不展示竖直滚动条（内容可滚，指示器隐藏）
      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: 0) {
          if !model.errorText.isEmpty {
            Text(model.errorText)
              .font(.system(size: 11))
              .foregroundStyle(.orange.opacity(0.95))
              .padding(.horizontal, 12)
              .padding(.vertical, 6)
              .frame(maxWidth: .infinity, alignment: .leading)
          }

          if model.events.isEmpty {
            // 空态：紧凑居中，避免撑出滚动条
            VStack(spacing: 5) {
              IslandEmptyBusyIcon()
                .frame(width: 18, height: 18)
                .foregroundStyle(.white.opacity(0.28))
              Text(model.hasConfig ? "暂无数字人事件" : "请先登录管理台同步凭证")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.4))
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
          } else {
            ForEach(Array(model.events.prefix(Int(IslandMetrics.maxVisibleRows)).enumerated()), id: \.element.id) { index, event in
              Button { model.open(event) } label: {
                HStack(spacing: 8) {
                  if event.kind == .running {
                    JellyAvatarView(
                      color: event.jelly_color ?? "blue",
                      size: 20,
                      state: .from(agentStatus: event.status, reason: nil)
                    )
                  } else {
                    IslandStatusSymbol(kind: event.kind, size: 20)
                  }
                  VStack(alignment: .leading, spacing: 1) {
                    Text(event.agent_name)
                      .font(.system(size: 12, weight: .medium))
                      .foregroundStyle(.white)
                      .lineLimit(1)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                      Text(event.subtitle(now: context.date))
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)
                    }
                  }
                  Spacer(minLength: 0)
                  Text(event.displayStatus)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(statusColor(for: event.kind).opacity(0.9))
                }
                .padding(.horizontal, 10)
                .frame(height: IslandMetrics.rowHeight)
                .contentShape(Rectangle())
              }
              .buttonStyle(IslandPressStyle())
              .opacity(Double(min(1, max(0, morph.contentProgress * 1.35 - CGFloat(index) * 0.08))))
            }
            if model.presentation.count > Int(IslandMetrics.maxVisibleRows) {
              Text("还有 \(model.presentation.count - Int(IslandMetrics.maxVisibleRows)) 项")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.38))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
            }
          }
        }
        .padding(.bottom, IslandMetrics.listBottomPad)
      }
      .scrollIndicators(.hidden)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .frame(width: width, alignment: .top)
  }

  private var statusColor: Color { statusColor(for: model.presentation.active_kind) }

  private var statusLabel: String {
    switch model.presentation.active_kind {
    case .error: return "报错"
    case .approval: return "待审批"
    case .running: return "运行中"
    case .completed: return "已完成"
    case nil: return ""
    }
  }

  private func statusColor(for kind: IslandEventKind?) -> Color {
    switch kind {
    case .error: return Color(red: 1.0, green: 0.48, blue: 0.48)
    case .approval: return Color(red: 1.0, green: 0.82, blue: 0.38)
    case .completed: return Color(red: 0.32, green: 0.86, blue: 0.48)
    case .running: return IslandMetrics.purpleCount
    case nil: return .white.opacity(0.4)
    }
  }
}

private struct IslandLayoutEditOverlay: View {
  @ObservedObject var editor: IslandLayoutEditor
  let isHovering: Bool

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .topLeading) {
        if isHovering {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(Color.white.opacity(0.42), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .padding(1)
            .allowsHitTesting(false)

          moveHandle
            .position(x: proxy.size.width / 2, y: 8)

          aspectRatioButton
            .position(x: max(16, proxy.size.width - 16), y: 10)

          resizeHandle(.left, x: 0, y: proxy.size.height / 2)
          resizeHandle(.right, x: proxy.size.width, y: proxy.size.height / 2)
          resizeHandle(.top, x: proxy.size.width / 2, y: 0)
          resizeHandle(.bottom, x: proxy.size.width / 2, y: proxy.size.height)
          resizeHandle(.topLeft, x: 0, y: 0)
          resizeHandle(.topRight, x: proxy.size.width, y: 0)
          resizeHandle(.bottomLeft, x: 0, y: proxy.size.height)
          resizeHandle(.bottomRight, x: proxy.size.width, y: proxy.size.height)
        }
      }
    }
  }

  private var moveHandle: some View {
    Capsule(style: .continuous)
      .fill(Color.white.opacity(0.65))
      .frame(width: 28, height: 4)
      .contentShape(Rectangle().inset(by: -6))
      .gesture(moveGesture)
      .onTapGesture(count: 2) { editor.reset() }
      .help("拖动移动灵动岛，双击恢复默认位置")
  }

  private var aspectRatioButton: some View {
    Button { editor.toggleAspectRatio() } label: {
      Image(systemName: editor.layout.isAspectRatioLocked ? "lock.fill" : "lock.open")
        .font(.system(size: 8, weight: .bold))
        .foregroundStyle(.white.opacity(0.82))
        .frame(width: 18, height: 18)
        .background(.black.opacity(0.52), in: Circle())
    }
    .buttonStyle(.plain)
    .help(editor.layout.isAspectRatioLocked ? "已锁定宽高比" : "已解锁宽高比")
  }

  private func resizeHandle(_ edge: IslandResizeEdge, x: CGFloat, y: CGFloat) -> some View {
    Circle()
      .fill(Color.white.opacity(0.8))
      .frame(width: 6, height: 6)
      .contentShape(Rectangle().inset(by: -6))
      .position(x: x, y: y)
      .gesture(resizeGesture(edge))
  }

  private var moveGesture: some Gesture {
    DragGesture()
      .onChanged { value in
        editor.move(by: appKitTranslation(value.translation), completed: false)
      }
      .onEnded { value in
        editor.move(by: appKitTranslation(value.translation), completed: true)
      }
  }

  private func resizeGesture(_ edge: IslandResizeEdge) -> some Gesture {
    DragGesture()
      .onChanged { value in
        editor.resize(edge: edge, by: appKitTranslation(value.translation), completed: false)
      }
      .onEnded { value in
        editor.resize(edge: edge, by: appKitTranslation(value.translation), completed: true)
      }
  }

  private func appKitTranslation(_ translation: CGSize) -> CGSize {
    CGSize(width: translation.width, height: -translation.height)
  }
}

private struct IslandStatusSymbol: View {
  let kind: IslandEventKind?
  let size: CGFloat

  var body: some View {
    Group {
      switch kind {
      case .error:
        Image(systemName: "xmark.circle.fill").foregroundStyle(Color(red: 1.0, green: 0.48, blue: 0.48))
      case .approval:
        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color(red: 1.0, green: 0.82, blue: 0.38))
      case .completed:
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(red: 0.32, green: 0.86, blue: 0.48))
      case .running:
        Image(systemName: "waveform.circle.fill").foregroundStyle(IslandMetrics.purpleCount)
      case nil:
        EmptyView()
      }
    }
    .font(.system(size: size, weight: .semibold))
    .frame(width: size, height: size)
  }
}

private struct IslandPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .opacity(configuration.isPressed ? 0.9 : 1)
      .animation(
        .spring(response: 0.22, dampingFraction: 0.78, blendDuration: 0),
        value: configuration.isPressed
      )
  }
}

/// 空态简笔图标：空胶囊轮廓 + 中间虚点，表示暂无忙碌数字人。
private struct IslandEmptyBusyIcon: View {
  var body: some View {
    Canvas { context, size in
      let inset: CGFloat = 1.2
      let rect = CGRect(
        x: inset,
        y: inset + size.height * 0.22,
        width: size.width - inset * 2,
        height: size.height * 0.48
      )
      let capsule = Path(roundedRect: rect, cornerRadius: rect.height / 2)
      context.stroke(capsule, with: .foreground, lineWidth: 1.0)

      let cy = rect.midY
      let r: CGFloat = 0.85
      for dx in [-4.0, 0.0, 4.0] as [CGFloat] {
        let dot = Path(ellipseIn: CGRect(x: rect.midX + dx - r, y: cy - r, width: r * 2, height: r * 2))
        context.fill(dot, with: .foreground)
      }
    }
    .accessibilityHidden(true)
  }
}

/// 任务完成未读：蓝色小呼吸灯
private struct IslandUnreadPulse: View {
  @State private var on = false

  var body: some View {
    Circle()
      .fill(Color(red: 0.28, green: 0.58, blue: 1.0))
      .frame(width: 6, height: 6)
      .opacity(on ? 1 : 0.28)
      .scaleEffect(on ? 1.05 : 0.85)
      .shadow(color: Color(red: 0.28, green: 0.58, blue: 1.0).opacity(on ? 0.55 : 0.15), radius: on ? 3 : 1)
      .onAppear {
        withAnimation(.easeInOut(duration: 1.05).repeatForever(autoreverses: true)) {
          on = true
        }
      }
      .accessibilityLabel("未读")
  }
}
