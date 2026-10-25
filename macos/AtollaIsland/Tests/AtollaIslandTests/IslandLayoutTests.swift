import XCTest
@testable import AtollaIsland

final class IslandLayoutTests: XCTestCase {
  private let screenFrame = CGRect(x: 0, y: 0, width: 1440, height: 900)
  private let contentSize = CGSize(width: 240, height: 40)

  func testDefaultLayoutKeepsIslandCenteredAtScreenTop() {
    let layout = IslandLayout.default

    let frame = layout.frame(contentSize: contentSize, screenFrame: screenFrame)

    XCTAssertEqual(frame.origin.x, 600)
    XCTAssertEqual(frame.maxY, 900)
    XCTAssertEqual(frame.size, contentSize)
  }

  func testMovingLayoutClampsFrameInsideScreen() {
    let moved = IslandLayout.default.moved(
      by: CGSize(width: -2_000, height: -2_000),
      contentSize: contentSize,
      screenFrame: screenFrame
    )

    let frame = moved.frame(contentSize: contentSize, screenFrame: screenFrame)

    XCTAssertEqual(frame.minX, screenFrame.minX)
    XCTAssertEqual(frame.minY, screenFrame.minY)
  }

  func testLockedResizePreservesBaseAspectRatio() {
    let layout = IslandLayout.default

    let resized = layout.resized(
      edge: .right,
      translation: CGSize(width: 120, height: 0),
      contentSize: contentSize,
      screenFrame: screenFrame
    )

    XCTAssertEqual(resized.widthScale, 1.5, accuracy: 0.001)
    XCTAssertEqual(resized.heightScale, 1.5, accuracy: 0.001)
  }

  func testUnlockedResizeChangesOnlyDraggedAxis() {
    var layout = IslandLayout.default
    layout.isAspectRatioLocked = false

    let resized = layout.resized(
      edge: .right,
      translation: CGSize(width: 120, height: 0),
      contentSize: contentSize,
      screenFrame: screenFrame
    )

    XCTAssertEqual(resized.widthScale, 1.5, accuracy: 0.001)
    XCTAssertEqual(resized.heightScale, 1, accuracy: 0.001)
  }

  func testRelockingAspectRatioPreservesCurrentUserRatio() {
    var layout = IslandLayout.default
    layout.widthScale = 1.5
    layout.heightScale = 1

    let resized = layout.resized(
      edge: .right,
      translation: CGSize(width: 120, height: 0),
      contentSize: contentSize,
      screenFrame: screenFrame
    )

    XCTAssertEqual(resized.widthScale, 2, accuracy: 0.001)
    XCTAssertEqual(resized.heightScale, 4.0 / 3.0, accuracy: 0.001)
  }

  func testResizeClampsContentToSafeMinimumAndMaximum() {
    var layout = IslandLayout.default
    layout.isAspectRatioLocked = false

    let minimum = layout.resized(
      edge: .right,
      translation: CGSize(width: -10_000, height: 0),
      contentSize: contentSize,
      screenFrame: screenFrame
    )
    let maximum = layout.resized(
      edge: .right,
      translation: CGSize(width: 10_000, height: 0),
      contentSize: contentSize,
      screenFrame: screenFrame
    )

    XCTAssertEqual(minimum.frame(contentSize: contentSize, screenFrame: screenFrame).width, 160)
    XCTAssertEqual(maximum.frame(contentSize: contentSize, screenFrame: screenFrame).width, 640)
  }

  func testStoreKeepsIndependentLayoutForEachDisplay() {
    let store = IslandLayoutStore(defaults: UserDefaults(suiteName: "AtollaIslandTests.\(UUID().uuidString)")!)
    var primary = IslandLayout.default
    primary.widthScale = 1.25
    var external = IslandLayout.default
    external.centerXRatio = 0.8

    store.save(primary, displayID: "primary")
    store.save(external, displayID: "external")

    XCTAssertEqual(store.load(displayID: "primary"), primary)
    XCTAssertEqual(store.load(displayID: "external"), external)
  }

  func testScaledContentSizeKeepsUserScaleAcrossMorphStates() {
    var layout = IslandLayout.default
    layout.widthScale = 1.4
    layout.heightScale = 1.2

    let collapsed = layout.scaledContentSize(CGSize(width: 240, height: 40), screenFrame: screenFrame)
    let expanded = layout.scaledContentSize(CGSize(width: 360, height: 140), screenFrame: screenFrame)

    XCTAssertEqual(collapsed.width, 336, accuracy: 0.001)
    XCTAssertEqual(collapsed.height, 48, accuracy: 0.001)
    XCTAssertEqual(expanded.width, 504, accuracy: 0.001)
    XCTAssertEqual(expanded.height, 168, accuracy: 0.001)
  }

  @MainActor
  func testLayoutEditorMarksOnlyDragEndAsPersistenceBoundary() {
    var completedStates: [Bool] = []
    let editor = IslandLayoutEditor(
      layout: .default,
      onMove: { _, completed in completedStates.append(completed) },
      onResize: { _, _, _ in },
      onToggleAspectRatio: {},
      onReset: {}
    )

    editor.move(by: CGSize(width: 12, height: 8), completed: false)
    editor.move(by: CGSize(width: 24, height: 10), completed: true)

    XCTAssertEqual(completedStates, [false, true])
  }
}
