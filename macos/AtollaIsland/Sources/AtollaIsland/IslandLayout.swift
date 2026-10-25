import Foundation

enum IslandResizeEdge: String {
  case left
  case right
  case top
  case bottom
  case topLeft
  case topRight
  case bottomLeft
  case bottomRight

  var adjustsWidth: Bool {
    switch self {
    case .left, .right, .topLeft, .topRight, .bottomLeft, .bottomRight:
      return true
    case .top, .bottom:
      return false
    }
  }

  var adjustsHeight: Bool {
    switch self {
    case .top, .bottom, .topLeft, .topRight, .bottomLeft, .bottomRight:
      return true
    case .left, .right:
      return false
    }
  }

  var movesLeftEdge: Bool {
    self == .left || self == .topLeft || self == .bottomLeft
  }

  var movesTopEdge: Bool {
    self == .top || self == .topLeft || self == .topRight
  }
}

/// 保存相对于显示器的锚点与缩放倍率，避免显示器重排后保留失效的全局坐标。
struct IslandLayout: Codable, Equatable {
  static let `default` = IslandLayout()

  private static let minimumSize = CGSize(width: 160, height: 18)
  private static let maximumSize = CGSize(width: 640, height: 480)

  var centerXRatio: CGFloat = 0.5
  var topYRatio: CGFloat = 1
  var widthScale: CGFloat = 1
  var heightScale: CGFloat = 1
  var isAspectRatioLocked = true

  func frame(contentSize: CGSize, screenFrame: CGRect) -> CGRect {
    let size = scaledContentSize(contentSize, screenFrame: screenFrame)
    let ideal = CGRect(
      x: screenFrame.minX + screenFrame.width * centerXRatio - size.width / 2,
      y: screenFrame.minY + screenFrame.height * topYRatio - size.height,
      width: size.width,
      height: size.height
    )
    return clamped(ideal, in: screenFrame)
  }

  func scaledContentSize(_ contentSize: CGSize, screenFrame: CGRect) -> CGSize {
    resolvedSize(contentSize: contentSize, screenFrame: screenFrame)
  }

  /// 将设置页提交的绝对矩形转换回相对显示器的持久化布局。
  func applying(frame: CGRect, contentSize: CGSize, screenFrame: CGRect) -> IslandLayout {
    let boundedSize = clampedSize(frame.size, screenFrame: screenFrame)
    let boundedFrame = clamped(CGRect(origin: frame.origin, size: boundedSize), in: screenFrame)
    var updated = updatedAnchor(for: boundedFrame, screenFrame: screenFrame)
    updated.widthScale = boundedFrame.width / max(contentSize.width, 1)
    updated.heightScale = boundedFrame.height / max(contentSize.height, 1)
    return updated
  }

  func sizedFrame(
    _ frame: CGRect,
    width: CGFloat?,
    height: CGFloat?,
    screenFrame: CGRect
  ) -> CGRect {
    let center = CGPoint(x: frame.midX, y: frame.midY)
    var targetWidth = width ?? frame.width
    var targetHeight = height ?? frame.height
    if isAspectRatioLocked {
      let aspectRatio = frame.width / max(frame.height, 1)
      if let width {
        targetWidth = width
        targetHeight = width / aspectRatio
      } else if let height {
        targetHeight = height
        targetWidth = height * aspectRatio
      }
    }

    let boundedSize = clampedSize(
      CGSize(width: targetWidth, height: targetHeight),
      screenFrame: screenFrame
    )
    return clamped(
      CGRect(
        x: center.x - boundedSize.width / 2,
        y: center.y - boundedSize.height / 2,
        width: boundedSize.width,
        height: boundedSize.height
      ),
      in: screenFrame
    )
  }

  static func sizeBounds(screenFrame: CGRect) -> IslandLayoutSizeBounds {
    IslandLayoutSizeBounds(
      width: Double(minimumSize.width)...Double(min(maximumSize.width, screenFrame.width)),
      height: Double(minimumSize.height)...Double(min(maximumSize.height, screenFrame.height))
    )
  }

  func moved(by translation: CGSize, contentSize: CGSize, screenFrame: CGRect) -> IslandLayout {
    let currentFrame = frame(contentSize: contentSize, screenFrame: screenFrame)
    let proposed = currentFrame.offsetBy(dx: translation.width, dy: translation.height)
    return updatedAnchor(for: clamped(proposed, in: screenFrame), screenFrame: screenFrame)
  }

  func resized(
    edge: IslandResizeEdge,
    translation: CGSize,
    contentSize: CGSize,
    screenFrame: CGRect
  ) -> IslandLayout {
    let currentFrame = frame(contentSize: contentSize, screenFrame: screenFrame)
    let currentSize = currentFrame.size
    let widthDelta = edge.adjustsWidth
      ? (edge.movesLeftEdge ? -translation.width : translation.width)
      : 0
    let heightDelta = edge.adjustsHeight
      ? (edge.movesTopEdge ? translation.height : -translation.height)
      : 0

    let resizedSize = resolvedResizeSize(
      currentSize: currentSize,
      contentSize: contentSize,
      widthDelta: widthDelta,
      heightDelta: heightDelta,
      screenFrame: screenFrame
    )
    let originX = edge.movesLeftEdge ? currentFrame.maxX - resizedSize.width : currentFrame.minX
    let originY = edge.movesTopEdge ? currentFrame.minY : currentFrame.maxY - resizedSize.height
    let resizedFrame = clamped(CGRect(origin: CGPoint(x: originX, y: originY), size: resizedSize), in: screenFrame)

    var updated = updatedAnchor(for: resizedFrame, screenFrame: screenFrame)
    updated.widthScale = resizedFrame.width / max(contentSize.width, 1)
    updated.heightScale = resizedFrame.height / max(contentSize.height, 1)
    return updated
  }

  private func resolvedResizeSize(
    currentSize: CGSize,
    contentSize: CGSize,
    widthDelta: CGFloat,
    heightDelta: CGFloat,
    screenFrame: CGRect
  ) -> CGSize {
    let width = currentSize.width + widthDelta
    let height = currentSize.height + heightDelta
    if isAspectRatioLocked {
      let widthScale = width / max(currentSize.width, 1)
      let heightScale = height / max(currentSize.height, 1)
      let requestedScale: CGFloat
      if widthDelta == 0 {
        requestedScale = heightScale
      } else if heightDelta == 0 {
        requestedScale = widthScale
      } else {
        requestedScale = abs(widthScale - 1) >= abs(heightScale - 1) ? widthScale : heightScale
      }
      return clampedLockedSize(currentSize: currentSize, scale: requestedScale, screenFrame: screenFrame)
    }
    return clampedSize(CGSize(width: width, height: height), screenFrame: screenFrame)
  }

  private func resolvedSize(contentSize: CGSize, screenFrame: CGRect) -> CGSize {
    clampedSize(
      CGSize(width: contentSize.width * widthScale, height: contentSize.height * heightScale),
      screenFrame: screenFrame
    )
  }

  private func clampedSize(_ size: CGSize, screenFrame: CGRect) -> CGSize {
    let minimumWidth = min(Self.minimumSize.width, screenFrame.width)
    let minimumHeight = min(Self.minimumSize.height, screenFrame.height)
    let maximumWidth = min(Self.maximumSize.width, screenFrame.width)
    let maximumHeight = min(Self.maximumSize.height, screenFrame.height)
    return CGSize(
      width: min(max(size.width, minimumWidth), maximumWidth),
      height: min(max(size.height, minimumHeight), maximumHeight)
    )
  }

  private func clampedLockedSize(currentSize: CGSize, scale: CGFloat, screenFrame: CGRect) -> CGSize {
    let minimumWidth = min(Self.minimumSize.width, screenFrame.width)
    let minimumHeight = min(Self.minimumSize.height, screenFrame.height)
    let maximumWidth = min(Self.maximumSize.width, screenFrame.width)
    let maximumHeight = min(Self.maximumSize.height, screenFrame.height)
    let minimumScale = max(
      minimumWidth / max(currentSize.width, 1),
      minimumHeight / max(currentSize.height, 1)
    )
    let maximumScale = min(
      maximumWidth / max(currentSize.width, 1),
      maximumHeight / max(currentSize.height, 1)
    )
    let boundedScale = min(max(scale, minimumScale), maximumScale)
    return CGSize(width: currentSize.width * boundedScale, height: currentSize.height * boundedScale)
  }

  private func clamped(_ frame: CGRect, in screenFrame: CGRect) -> CGRect {
    CGRect(
      x: min(max(frame.minX, screenFrame.minX), screenFrame.maxX - frame.width),
      y: min(max(frame.minY, screenFrame.minY), screenFrame.maxY - frame.height),
      width: frame.width,
      height: frame.height
    )
  }

  private func updatedAnchor(for frame: CGRect, screenFrame: CGRect) -> IslandLayout {
    var updated = self
    updated.centerXRatio = (frame.midX - screenFrame.minX) / max(screenFrame.width, 1)
    updated.topYRatio = (frame.maxY - screenFrame.minY) / max(screenFrame.height, 1)
    return updated
  }
}

struct IslandLayoutSizeBounds {
  let width: ClosedRange<Double>
  let height: ClosedRange<Double>
}

/// 按显示器隔离偏好，防止外接屏布局覆盖内建屏的刘海布局。
final class IslandLayoutStore {
  private let defaults: UserDefaults
  private let keyPrefix = "atolla.island.layout."

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func load(displayID: String) -> IslandLayout {
    guard let data = defaults.data(forKey: key(for: displayID)),
          let layout = try? JSONDecoder().decode(IslandLayout.self, from: data) else {
      return .default
    }
    return layout
  }

  func save(_ layout: IslandLayout, displayID: String) {
    guard let data = try? JSONEncoder().encode(layout) else { return }
    defaults.set(data, forKey: key(for: displayID))
  }

  private func key(for displayID: String) -> String {
    keyPrefix + displayID
  }
}
