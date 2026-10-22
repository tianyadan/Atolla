import SwiftUI
import UIKit

/// 像素水母（Live Activity）
/// 动感对齐 PC：`jelly-jump` = translateY 上下弹（0.6s ease-in-out），
/// 不是精灵图左右切帧（那会像横向幻灯片）。
enum JellyAnimState {
  case idle
  case working
  case waiting
  case error

  static func from(statusLabel: String) -> JellyAnimState {
    let s = statusLabel.lowercased()
    if s.contains("错误") || s == "error" { return .error }
    if s.contains("等待") || s == "waiting" { return .waiting }
    return .working
  }
}

struct JellyAvatarView: View {
  let color: String
  var size: CGFloat = 22
  var state: JellyAnimState = .working
  /// 跳动相位：working 用 0=落地 / 1=腾空；由 App Timer 约 0.3s 翻转一次
  var animPhase: Int = 0

  private let frames = 8
  /// v2：8 列 × 7 行
  private let actionRows = 7
  /// 逻辑格（与 PC --jelly-cell = size/16 一致）
  private var cell: CGFloat { size / 16 }

  private var safeColor: String {
    switch color.lowercased() {
    case "blue", "green", "orange", "purple", "red", "yellow":
      return color.lowercased()
    default:
      return "blue"
    }
  }

  /// 上下跳用相位驱动；帧只取落地/腾空两姿态，避免横滑切帧
  private var frameIndex: Int {
    switch state {
    case .waiting, .error, .idle:
      return 0
    case .working:
      return (animPhase % 2 == 0) ? 0 : 3
    }
  }

  /// idle=0 typing=1 alert=4 error=5（animations.json）
  private var animRow: Int {
    switch state {
    case .working: return 1
    case .waiting: return 4
    case .error: return 5
    case .idle: return 0
    }
  }

  /**
   PC keyframes jelly-jump:
   0%/100% → Y(0)；40% → Y(-3cell)；70% → Y(-1cell)
   岛上只有 2 个关键帧：落地 ↔ 顶点，中间靠 SwiftUI 插值。
   */
  private var bobY: CGFloat {
    switch state {
    case .error:
      return cell * 1.5
    case .waiting:
      return 0
    case .idle:
      // 缓漂：±1 格
      return (animPhase % 2 == 0) ? cell : -cell
    case .working:
      return (animPhase % 2 == 0) ? 0 : -cell * 3
    }
  }

  /// 落地略压扁，腾空略拉长 —— 增强弹跳感，不是横向滑动
  private var jellyScale: CGSize {
    switch state {
    case .working:
      if animPhase % 2 == 0 {
        return CGSize(width: 1.08, height: 0.88) // 落地压扁
      }
      return CGSize(width: 0.94, height: 1.08) // 腾空拉长
    default:
      return CGSize(width: 1, height: 1)
    }
  }

  var body: some View {
    spriteOrFallback
      .scaleEffect(x: jellyScale.width, y: jellyScale.height, anchor: .bottom)
      .offset(y: bobY)
      .opacity(state == .waiting ? 0.55 : 1)
      .frame(width: size, height: size)
      // 与 Timer 间隔对齐，ease-in-out 做出「跳起/落下」弧线
      .animation(.easeInOut(duration: 0.3), value: animPhase)
  }

  @ViewBuilder
  private var spriteOrFallback: some View {
    if let sheet = JellySpriteStore.image(color: safeColor) {
      Image(uiImage: sheet)
        .interpolation(.none)
        .resizable()
        .frame(width: size * CGFloat(frames), height: size * CGFloat(actionRows))
        .offset(x: -CGFloat(frameIndex) * size, y: -CGFloat(animRow) * size)
        .frame(width: size, height: size, alignment: .topLeading)
        .clipped()
        // 切帧不要带动画，否则会「横滑」；只让 offset/scale 做纵向动画
        .animation(nil, value: frameIndex)
    } else {
      Canvas { ctx, sz in
        let c = fallbackColor(safeColor)
        let body = Path(ellipseIn: CGRect(
          x: sz.width * 0.15,
          y: sz.height * 0.08,
          width: sz.width * 0.7,
          height: sz.height * 0.55
        ))
        ctx.fill(body, with: .color(c))
        for i in 0..<3 {
          let x = sz.width * (0.3 + CGFloat(i) * 0.2)
          var tentacle = Path()
          tentacle.move(to: CGPoint(x: x, y: sz.height * 0.58))
          tentacle.addQuadCurve(
            to: CGPoint(x: x + CGFloat(i - 1) * 2, y: sz.height * 0.95),
            control: CGPoint(x: x + 4, y: sz.height * 0.75)
          )
          ctx.stroke(tentacle, with: .color(c.opacity(0.9)), lineWidth: max(1.2, sz.width * 0.08))
        }
      }
      .frame(width: size, height: size)
    }
  }

  private func fallbackColor(_ name: String) -> Color {
    switch name {
    case "red": return Color(red: 0.9, green: 0.32, blue: 0.32)
    case "green": return Color(red: 0.3, green: 0.78, blue: 0.42)
    case "purple": return Color(red: 0.62, green: 0.4, blue: 0.88)
    case "orange": return Color(red: 0.95, green: 0.55, blue: 0.2)
    case "yellow": return Color(red: 0.92, green: 0.78, blue: 0.22)
    default: return Color(red: 0.32, green: 0.52, blue: 0.95)
    }
  }
}

enum JellySpriteStore {
  private static var cache: [String: UIImage] = [:]

  static func image(color: String) -> UIImage? {
    if let hit = cache[color] { return hit }
    let name = "jelly-\(color)-32"
    if let img = UIImage(named: name) {
      cache[color] = img
      return img
    }
    let candidates: [URL?] = [
      Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "jelly-sprites"),
      Bundle.main.url(forResource: name, withExtension: "png"),
      Bundle.main.resourceURL?
        .appendingPathComponent("jelly-sprites")
        .appendingPathComponent("\(name).png"),
    ]
    for url in candidates {
      guard let url, let raw = UIImage(contentsOfFile: url.path), let cg = raw.cgImage else { continue }
      let sharp = UIImage(cgImage: cg, scale: 1, orientation: .up)
      cache[color] = sharp
      return sharp
    }
    return nil
  }
}
