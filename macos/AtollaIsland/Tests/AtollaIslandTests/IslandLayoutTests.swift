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

  func testUnlockedResizeAllowsHeightBelowCollapsedNotchHeight() {
    var layout = IslandLayout.default
    layout.isAspectRatioLocked = false
    let collapsedContent = CGSize(width: 240, height: 32)

    let resized = layout.resized(
      edge: .bottom,
      translation: CGSize(width: 0, height: 20),
      contentSize: collapsedContent,
      screenFrame: screenFrame
    )

    XCTAssertEqual(
      resized.frame(contentSize: collapsedContent, screenFrame: screenFrame).height,
      18,
      accuracy: 0.001
    )
  }

  func testApplyingSettingsFrameSupportsTopOffsetAndIndependentHeight() {
    let current = IslandLayout.default
    let content = CGSize(width: 240, height: 32)
    var desired = current.frame(contentSize: content, screenFrame: screenFrame)
    desired.origin.x = 120
    desired.origin.y = 700
    desired.size = CGSize(width: 300, height: 56)

    let updated = current.applying(frame: desired, contentSize: content, screenFrame: screenFrame)
    let actual = updated.frame(contentSize: content, screenFrame: screenFrame)

    XCTAssertEqual(actual, desired)
  }

  func testLockedSettingsSizeKeepsCurrentAspectRatio() {
    let content = CGSize(width: 240, height: 40)
    let current = IslandLayout.default.frame(contentSize: content, screenFrame: screenFrame)

    let locked = IslandLayout.default.sizedFrame(current, width: 300, height: nil, screenFrame: screenFrame)
    var unlockedLayout = IslandLayout.default
    unlockedLayout.isAspectRatioLocked = false
    let unlocked = unlockedLayout.sizedFrame(current, width: 300, height: nil, screenFrame: screenFrame)

    XCTAssertEqual(locked.width, 300, accuracy: 0.001)
    XCTAssertEqual(locked.height, 50, accuracy: 0.001)
    XCTAssertEqual(unlocked.width, 300, accuracy: 0.001)
    XCTAssertEqual(unlocked.height, 40, accuracy: 0.001)
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

  func testSettingsDraftDoesNotApplyUntilExplicitCommit() {
    let snapshot = IslandLayoutSettingsSnapshot(
      width: 240,
      height: 40,
      x: 600,
      y: 0,
      top: 0,
      right: 600,
      bottom: 860,
      left: 600,
      widthRange: 160...640,
      heightRange: 18...320,
      horizontalPositionRange: 0...1_200,
      verticalPositionRange: 0...860,
      isAspectRatioLocked: true
    )
    var updateCount = 0
    let model = IslandLayoutSettingsModel(
      snapshot: snapshot,
      onUpdate: { field, value in
        updateCount += 1
        return snapshot.setting(field, to: value)
      },
      onToggleAspectRatio: { snapshot }
    )

    model.draftBinding(for: .width).wrappedValue = 320

    XCTAssertEqual(updateCount, 0)
    XCTAssertEqual(model.snapshot.width, 320)

    model.commit(.width)

    XCTAssertEqual(updateCount, 1)
    XCTAssertEqual(model.snapshot.width, 320)
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

  @MainActor
  func testLayoutEditorKeepsControlsHiddenUntilExplicitlyUnlocked() {
    let editor = IslandLayoutEditor(
      layout: .default,
      onMove: { _, _ in },
      onResize: { _, _, _ in },
      onToggleAspectRatio: {},
      onReset: {}
    )

    XCTAssertFalse(editor.isEditingEnabled)

    editor.setEditingEnabled(true)

    XCTAssertTrue(editor.isEditingEnabled)
  }
}
