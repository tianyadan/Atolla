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

  /// 面板宽：收起/合并时为对称留白；展开跟 morph
  private var panelWidth: CGFloat {
    if showSecondary || morph.phase == .merging {
      return max(morph.width + morph.mainRightStretch, collapsedW + 2 * IslandMetrics.badgeSideExtra)
    }
    return max(morph.width, collapsedW)
  }

  private var panelHeight: CGFloat {
    max(morph.height, showSecondary || morph.phase == .merging ? IslandMetrics.badgeSize : morph.height)
  }

  /// 主岛左缘（面板坐标）：合并时固定，只向右 stretch
  private var mainLeadingX: CGFloat {
    if morph.phase == .expanding || morph.phase == .expanded || morph.contentProgress > 0.2 {
      return (panelWidth - morph.width) / 2
    }
    // collapsed / merging：对齐对称布局中的刘海位
    return IslandMetrics.badgeSideExtra
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
      // —— 同一坐标系：主岛（左缘固定 + 右缘 stretch）——
      RoundedRectangle(cornerRadius: morph.cornerRadius, style: .continuous)
        .fill(Color.black)
        .overlay(
          RoundedRectangle(cornerRadius: morph.cornerRadius, style: .continuous)
            .stroke(Color.white.opacity(0.06 * morph.contentProgress), lineWidth: 0.5)
        )
        .frame(
          width: morph.width + (morph.phase == .merging || morph.phase == .collapsed ? morph.mainRightStretch : 0),
          height: morph.height,
          alignment: .topLeading
        )
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

      ScrollView(.vertical, showsIndicators: true) {
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
            Text(model.hasConfig ? "暂无忙碌数字人" : "请先登录管理台同步凭证")
              .font(.system(size: 12))
              .foregroundStyle(.white.opacity(0.45))
              .padding(.horizontal, 12)
              .padding(.vertical, 12)
              .frame(maxWidth: .infinity, alignment: .leading)
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
                    Text(a.name)
                      .font(.system(size: 12, weight: .medium))
                      .foregroundStyle(.white)
                      .lineLimit(1)
                    Text("\(a.engine) · \(a.displayStatus)")
                      .font(.system(size: 10))
                      .foregroundStyle(.white.opacity(0.45))
                      .lineLimit(1)
                  }
                  Spacer(minLength: 0)
                  Image(systemName: "arrow.up.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.35))
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
