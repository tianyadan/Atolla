import AppKit
import SwiftUI

/// 与 PC `JellyAvatar` 对齐：精灵图帧循环 + 运行时跳动。
enum JellyAnimState {
  case idle
  case working
  case waiting
  case error

  static func from(agentStatus: String, reason: String?) -> JellyAnimState {
    let s = agentStatus.lowercased()
    if s == "error" { return .error }
    if s == "waiting" { return .waiting }
    if reason == "workflow" || s == "running" || s == "busy" || s == "插话中"
      || s == "initializing" || s == "compressing" {
      return .working
    }
    return .idle
  }
}

struct JellyAvatarView: View {
  let color: String
  var size: CGFloat = 22
  var state: JellyAnimState = .working

  private let frames = 8
  /// v2 精灵表：8 列 × 7 行（idle/typing/sleep/eat/alert/error/celebrate）
  private let actionRows = 7
  private let cellLogical: CGFloat = 16

  @State private var flashOn = true

  private var safeColor: String {
    let c = color.lowercased()
    switch c {
    case "blue", "green", "orange", "purple", "red", "yellow": return c
    default: return "blue"
    }
  }

  /// 选 @16 / @32 / @48
  private var spriteScale: Int {
    let need = size * (NSScreen.main?.backingScaleFactor ?? 2)
    if need <= 16 { return 1 }
    if need <= 32 { return 2 }
    return 3
  }

  /// 与 animations.json state_map 对齐
  private var animRow: Int {
    switch state {
    case .working: return 1 // typing
    case .waiting: return 4 // alert
    case .error: return 5
    case .idle: return 0
    }
  }

  private var frameMs: Double {
    switch state {
    case .working: return 0.6 / Double(frames)
    case .waiting: return 0.8 / Double(frames)
    case .error: return 0.889 / Double(frames)
    case .idle: return 3.0 / Double(frames)
    }
  }

  var body: some View {
    let sheet = JellySpriteStore.shared.image(color: safeColor, scale: spriteScale)
    TimelineView(.animation(minimumInterval: frameMs, paused: false)) { timeline in
      let idx = Int(timeline.date.timeIntervalSinceReferenceDate / frameMs) % frames
      spriteFrame(sheet: sheet, frame: idx)
        .offset(y: bobOffset(for: timeline.date))
        .opacity(stateOpacity)
        .saturation(state == .error ? 0.7 : 1)
    }
    .frame(width: size, height: size)
    .onAppear { startFlashIfNeeded() }
    .onChange(of: state) { _ in startFlashIfNeeded() }
  }

  private var stateOpacity: Double {
    if state == .error { return 0.85 }
    if state == .waiting { return flashOn ? 1 : 0.35 }
    return 1
  }

  private func spriteFrame(sheet: NSImage?, frame: Int) -> some View {
    Group {
      if let sheet {
        Image(nsImage: sheet)
          .interpolation(.none)
          .resizable()
          .frame(width: size * CGFloat(frames), height: size * CGFloat(actionRows))
          .offset(x: -CGFloat(frame) * size, y: -CGFloat(animRow) * size)
          .frame(width: size, height: size, alignment: .topLeading)
          .clipped()
      } else {
        Circle().fill(fallbackColor(safeColor)).frame(width: size, height: size)
      }
    }
  }

  /// idle：±1 格缓动；working：-3 格跳动（与 App.css 一致）
  private func bobOffset(for date: Date) -> CGFloat {
    let cell = size / cellLogical
    switch state {
    case .error:
      return cell * 1.5
    case .waiting:
      return 0
    case .idle:
      let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3) / 3
      // ease-in-out 近似：正弦
      return CGFloat(sin(t * .pi * 2)) * cell
    case .working:
      let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.6) / 0.6
      // 0/1 落地，中间抬起
      let lift = sin(t * .pi)
      return -cell * 3 * CGFloat(lift)
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

  private func startFlashIfNeeded() {
    flashOn = true
    guard state == .waiting else { return }
    // TimelineView 外用简单翻转
    Task { @MainActor in
      while state == .waiting {
        try? await Task.sleep(nanoseconds: 700_000_000)
        flashOn.toggle()
      }
    }
  }
}

/// 精灵图缓存：稳定目录 / 可执行旁 →（可选）Bundle.module
enum JellySpriteStore {
  static let shared = JellySpriteStoreBox()
}

final class JellySpriteStoreBox {
  private var cache: [String: NSImage] = [:]

  func image(color: String, scale: Int) -> NSImage? {
    let key = "\(color)@\(scale)"
    if let hit = cache[key] { return hit }
    let px = 16 * scale
    let name = "jelly-\(color)@\(px).png"
    guard let url = resolveURL(fileName: name) else { return nil }
    guard let img = NSImage(contentsOf: url) else { return nil }
    cache[key] = img
    return img
  }

  private func resolveURL(fileName: String) -> URL? {
    // 必须先走文件系统：Bundle.module 在缺少 AtollaIsland_AtollaIsland.bundle 时会直接 fatal
    let fm = FileManager.default
    let home = fm.homeDirectoryForCurrentUser
    let stable = home.appendingPathComponent(".atolla/bin/jelly-sprites/\(fileName)")
    if fm.fileExists(atPath: stable.path) { return stable }

    // 可执行文件旁（预编译包 / 本机安装布局）
    if let exe = Bundle.main.executableURL?.deletingLastPathComponent() {
      let u = exe.appendingPathComponent("jelly-sprites/\(fileName)")
      if fm.fileExists(atPath: u.path) { return u }
      // SPM 资源包旁：AtollaIsland_AtollaIsland.bundle/jelly-sprites/
      let bundled = exe.appendingPathComponent("AtollaIsland_AtollaIsland.bundle/jelly-sprites/\(fileName)")
      if fm.fileExists(atPath: bundled.path) { return bundled }
    }

    // SPM Bundle.module（仅当资源包存在时才安全访问）
    if Self.spmResourceBundleAvailable(),
       let u = Bundle.module.url(
         forResource: fileName.replacingOccurrences(of: ".png", with: ""),
         withExtension: "png",
         subdirectory: "jelly-sprites"
       ) {
      return u
    }
    if Self.spmResourceBundleAvailable(),
       let u = Bundle.module.url(forResource: fileName, withExtension: nil, subdirectory: "jelly-sprites") {
      return u
    }
    if Self.spmResourceBundleAvailable(),
       let dir = Bundle.module.resourceURL?.appendingPathComponent("jelly-sprites") {
      let u = dir.appendingPathComponent(fileName)
      if fm.fileExists(atPath: u.path) { return u }
    }
    return nil
  }

  /// Bundle.module 访问前探测：缺 bundle 时绝不触碰 Bundle.module（会 fatal）
  private static func spmResourceBundleAvailable() -> Bool {
    if let exe = Bundle.main.executableURL?.deletingLastPathComponent() {
      let nextToExe = exe.appendingPathComponent("AtollaIsland_AtollaIsland.bundle")
      if FileManager.default.fileExists(atPath: nextToExe.path) { return true }
    }
    // 开发态：.build 产物旁；安装态：~/.atolla/bin
    let stable = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".atolla/bin/AtollaIsland_AtollaIsland.bundle")
    return FileManager.default.fileExists(atPath: stable.path)
  }
}
