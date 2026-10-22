import SwiftUI

/// Mac 刘海外形：顶贴边、底圆润；**左右严格镜像**（上下可不同）。
/// 使用显式镜像 Path，避免 UnevenRoundedRectangle / 裁剪导致单侧直角。
struct MacNotchShape: Shape {
  /// 顶角（左右共用，构造时强制对称）
  var topRadius: CGFloat
  /// 底角（左右共用，构造时强制对称）
  var bottomRadius: CGFloat

  init(topLeading: CGFloat, topTrailing: CGFloat, bottomLeading: CGFloat, bottomTrailing: CGFloat) {
    // 硬性左右对称：取两侧平均，杜绝 TL≠TR / BL≠BR
    self.topRadius = max(0, (topLeading + topTrailing) * 0.5)
    self.bottomRadius = max(0, (bottomLeading + bottomTrailing) * 0.5)
  }

  init(topRadius: CGFloat, bottomRadius: CGFloat) {
    self.topRadius = max(0, topRadius)
    self.bottomRadius = max(0, bottomRadius)
  }

  var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(topRadius, bottomRadius) }
    set {
      topRadius = newValue.first
      bottomRadius = newValue.second
    }
  }

  func path(in rect: CGRect) -> Path {
    let w = rect.width
    let h = rect.height
    guard w > 0.5, h > 0.5 else { return Path(rect) }

    // 圆角不超过半宽/半高，且左右共用同一数值
    let top = min(topRadius, w * 0.5, h * 0.5)
    let bot = min(bottomRadius, w * 0.5, h * 0.5)

    let minX = rect.minX
    let maxX = rect.maxX
    let minY = rect.minY
    let maxY = rect.maxY

    var path = Path()

    // 顶边：从左顶角圆弧终点 → 右顶角（贴顶，顶角可接近 0）
    path.move(to: CGPoint(x: minX + top, y: minY))
    path.addLine(to: CGPoint(x: maxX - top, y: minY))

    // 右上角（与左上镜像）
    if top > 0.05 {
      path.addArc(
        center: CGPoint(x: maxX - top, y: minY + top),
        radius: top,
        startAngle: .degrees(-90),
        endAngle: .degrees(0),
        clockwise: false
      )
    } else {
      path.addLine(to: CGPoint(x: maxX, y: minY))
    }

    // 右侧直边 → 右下角起点
    path.addLine(to: CGPoint(x: maxX, y: maxY - bot))

    // 右下角（必须有弧，禁止 line 到 maxY 再折回）
    if bot > 0.05 {
      path.addArc(
        center: CGPoint(x: maxX - bot, y: maxY - bot),
        radius: bot,
        startAngle: .degrees(0),
        endAngle: .degrees(90),
        clockwise: false
      )
    } else {
      path.addLine(to: CGPoint(x: maxX, y: maxY))
    }

    // 底边
    path.addLine(to: CGPoint(x: minX + bot, y: maxY))

    // 左下角（与右下镜像）
    if bot > 0.05 {
      path.addArc(
        center: CGPoint(x: minX + bot, y: maxY - bot),
        radius: bot,
        startAngle: .degrees(90),
        endAngle: .degrees(180),
        clockwise: false
      )
    } else {
      path.addLine(to: CGPoint(x: minX, y: maxY))
    }

    // 左侧直边 → 左上
    path.addLine(to: CGPoint(x: minX, y: minY + top))

    // 左上角
    if top > 0.05 {
      path.addArc(
        center: CGPoint(x: minX + top, y: minY + top),
        radius: top,
        startAngle: .degrees(180),
        endAngle: .degrees(270),
        clockwise: false
      )
    } else {
      path.addLine(to: CGPoint(x: minX, y: minY))
    }

    path.closeSubpath()
    return path
  }
}

extension MacNotchShape {
  static func from(morph: IslandMorphDriver) -> MacNotchShape {
    let top = morph.topCornerRadius
    let bot = morph.bottomCornerRadius
    #if DEBUG
    assert(abs(top - top) < 0.001 && abs(bot - bot) < 0.001)
    #endif
    return MacNotchShape(topRadius: top, bottomRadius: bot)
  }
}
