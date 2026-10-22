import SwiftUI

/// 灵动岛静态尺寸（动画节奏见 IslandMorphDriver）。
enum IslandMetrics {
  static let expandedExtraWidth: CGFloat = 120
  static let rowHeight: CGFloat = 34
  static let maxVisibleRows: CGFloat = 4
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

/// 主岛 + 副岛同一坐标空间；mergeProgress 驱动吸收，再顺势 expand。
struct IslandRootView: View {
  @ObservedObject var model: IslandViewModel
  @ObservedObject var morph: IslandMorphDriver
  var notch: NotchGeometry

  private var collapsedW: CGFloat { notch.width }
  private var collapsedH: CGFloat { notch.height }
  private var expandedW: CGFloat { notch.width + IslandMetrics.expandedExtraWidth }
  private var busyCount: Int { model.agents.count }
  private var showSecondary: Bool {
    busyCount > 0 && morph.secondaryInLayout && morph.contentProgress < 0.35
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
    // morph 已由 DisplayLink 逐帧插值，禁止 SwiftUI 隐式动画再插一层（会掉帧/卡顿）
    .transaction { $0.animation = nil }
    .onAppear {
      morph.syncIdle(width: collapsedW, height: collapsedH, expanded: false)
    }
  }

  /// 副岛：位置/缩放/数字透明度由 mergeProgress 派生量驱动
  private var secondaryIsland: some View {
    let size = IslandMetrics.badgeSize * morph.secondaryScale
    return ZStack {
      Circle()
        .fill(Color.black)
        .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 0.5))
      Text(busyCount > 99 ? "99+" : "\(busyCount)")
        .font(.system(size: busyCount > 9 ? 10 : 12, weight: .bold, design: .rounded))
        .foregroundStyle(IslandMetrics.purpleCount)
        .minimumScaleFactor(0.7)
        .opacity(morph.secondaryTextOpacity)
    }
    .frame(width: size, height: size)
    .position(x: secondaryCenterX, y: secondaryCenterY)
    .opacity(Double(max(0, 1 - morph.mergeProgress * 0.15))) // 末段略融进主岛，不 abrupt 0
    .onTapGesture {
      model.requestMergeThenExpand(travel: mergeTravel)
    }
    .allowsHitTesting(morph.phase == .collapsed && !morph.blocksSecondaryTap)
    .help("\(busyCount) 个数字人运行中")
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

          if model.agents.isEmpty {
            // 空态：紧凑居中，避免撑出滚动条
            VStack(spacing: 5) {
              IslandEmptyBusyIcon()
                .frame(width: 18, height: 18)
                .foregroundStyle(.white.opacity(0.28))
              Text(model.hasConfig ? "暂无忙碌数字人" : "请先登录管理台同步凭证")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.4))
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
          } else {
            ForEach(Array(model.agents.enumerated()), id: \.element.id) { index, a in
              Button { model.open(a) } label: {
                HStack(spacing: 8) {
                  JellyAvatarView(
                    color: a.jelly_color ?? "blue",
                    size: 20,
                    state: .from(agentStatus: a.status, reason: a.reason)
                  )
                  VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                      Text(a.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                      if a.isUnread {
                        IslandUnreadPulse()
                      }
                    }
                    // 每秒刷新运行时长；组名 + 时长
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                      Text(a.subtitle(now: context.date))
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.45))
                        .lineLimit(1)
                    }
                  }
                  Spacer(minLength: 0)
                  if a.isUnread {
                    Text("未读")
                      .font(.system(size: 9, weight: .semibold))
                      .foregroundStyle(Color(red: 0.35, green: 0.62, blue: 1.0).opacity(0.9))
                  } else {
                    Image(systemName: "arrow.up.right")
                      .font(.system(size: 9, weight: .semibold))
                      .foregroundStyle(.white.opacity(0.35))
                  }
                }
                .padding(.horizontal, 10)
                .frame(height: IslandMetrics.rowHeight)
                .contentShape(Rectangle())
              }
              .buttonStyle(IslandPressStyle())
              .opacity(Double(min(1, max(0, morph.contentProgress * 1.35 - CGFloat(index) * 0.08))))
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
