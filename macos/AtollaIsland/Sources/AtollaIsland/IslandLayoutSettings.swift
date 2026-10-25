import AppKit
import SwiftUI

enum IslandLayoutSettingField {
  case width
  case height
  case x
  case y
  case top
  case right
  case bottom
  case left
}

struct IslandLayoutSettingsSnapshot {
  var width: Double
  var height: Double
  var x: Double
  var y: Double
  var top: Double
  var right: Double
  var bottom: Double
  var left: Double
  let widthRange: ClosedRange<Double>
  let heightRange: ClosedRange<Double>
  let horizontalPositionRange: ClosedRange<Double>
  let verticalPositionRange: ClosedRange<Double>
  let isAspectRatioLocked: Bool

  func value(for field: IslandLayoutSettingField) -> Double {
    switch field {
    case .width: return width
    case .height: return height
    case .x: return x
    case .y: return y
    case .top: return top
    case .right: return right
    case .bottom: return bottom
    case .left: return left
    }
  }

  func setting(_ field: IslandLayoutSettingField, to value: Double) -> IslandLayoutSettingsSnapshot {
    var updated = self
    switch field {
    case .width: updated.width = value
    case .height: updated.height = value
    case .x: updated.x = value
    case .y: updated.y = value
    case .top: updated.top = value
    case .right: updated.right = value
    case .bottom: updated.bottom = value
    case .left: updated.left = value
    }
    return updated
  }
}

final class IslandLayoutSettingsModel: ObservableObject {
  @Published private(set) var snapshot: IslandLayoutSettingsSnapshot
  private let onUpdate: (IslandLayoutSettingField, Double) -> IslandLayoutSettingsSnapshot
  private let onToggleAspectRatio: () -> IslandLayoutSettingsSnapshot

  init(
    snapshot: IslandLayoutSettingsSnapshot,
    onUpdate: @escaping (IslandLayoutSettingField, Double) -> IslandLayoutSettingsSnapshot,
    onToggleAspectRatio: @escaping () -> IslandLayoutSettingsSnapshot
  ) {
    self.snapshot = snapshot
    self.onUpdate = onUpdate
    self.onToggleAspectRatio = onToggleAspectRatio
  }

  func draftBinding(for field: IslandLayoutSettingField) -> Binding<Double> {
    Binding(
      get: { self.snapshot.value(for: field) },
      set: { self.snapshot = self.snapshot.setting(field, to: $0) }
    )
  }

  func commit(_ field: IslandLayoutSettingField) {
    snapshot = onUpdate(field, snapshot.value(for: field))
  }

  func replace(snapshot: IslandLayoutSettingsSnapshot) {
    self.snapshot = snapshot
  }

  func aspectRatioBinding() -> Binding<Bool> {
    Binding(
      get: { self.snapshot.isAspectRatioLocked },
      set: { requestedValue in
        guard requestedValue != self.snapshot.isAspectRatioLocked else { return }
        self.snapshot = self.onToggleAspectRatio()
      }
    )
  }
}

struct IslandLayoutSettingsView: View {
  @ObservedObject var model: IslandLayoutSettingsModel
  let onReset: () -> IslandLayoutSettingsSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("灵动岛布局设置")
        .font(.headline)

      GroupBox("尺寸") {
        VStack(spacing: 10) {
          Toggle("锁定横纵比", isOn: model.aspectRatioBinding())
            .toggleStyle(.checkbox)
          sliderRow("宽度", field: .width, range: model.snapshot.widthRange)
          sliderRow("高度", field: .height, range: model.snapshot.heightRange)
        }
        .padding(.top, 4)
      }

      GroupBox("屏幕位置") {
        VStack(spacing: 10) {
          sliderRow("X（距左侧）", field: .x, range: model.snapshot.horizontalPositionRange)
          sliderRow("Y（距顶部）", field: .y, range: model.snapshot.verticalPositionRange)
        }
        .padding(.top, 4)
      }

      GroupBox("四周边距") {
        VStack(spacing: 10) {
          sliderRow("上", field: .top, range: model.snapshot.verticalPositionRange)
          sliderRow("右", field: .right, range: model.snapshot.horizontalPositionRange)
          sliderRow("下", field: .bottom, range: model.snapshot.verticalPositionRange)
          sliderRow("左", field: .left, range: model.snapshot.horizontalPositionRange)
        }
        .padding(.top, 4)
      }

      HStack {
        Text("单位：pt；松开滑块或按回车后应用，其他数值会自动同步。")
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        Button("恢复默认") {
          model.replace(snapshot: onReset())
        }
      }
    }
    .padding(18)
    .frame(width: 430)
  }

  private func sliderRow(
    _ title: String,
    field: IslandLayoutSettingField,
    range: ClosedRange<Double>
  ) -> some View {
    HStack(spacing: 10) {
      Text(title).frame(width: 42, alignment: .leading)
      Slider(
        value: model.draftBinding(for: field),
        in: range,
        step: 1,
        onEditingChanged: { isEditing in
          if !isEditing {
            model.commit(field)
          }
        }
      )
      numericField(field)
    }
  }

  private func numericField(_ field: IslandLayoutSettingField) -> some View {
    TextField("", value: model.draftBinding(for: field), format: .number.precision(.fractionLength(0)))
      .multilineTextAlignment(.trailing)
      .frame(width: 78)
      .onSubmit {
        model.commit(field)
      }
  }
}

extension NSPanel {
  static func islandLayoutSettingsPanel(contentView: NSView) -> NSPanel {
    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 430, height: 500),
      styleMask: [.titled, .closable, .utilityWindow],
      backing: .buffered,
      defer: false
    )
    panel.title = "灵动岛布局设置"
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.contentView = contentView
    return panel
  }
}
