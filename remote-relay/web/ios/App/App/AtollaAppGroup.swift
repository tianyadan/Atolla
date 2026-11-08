import Foundation

/// App 与 Widget 共用的 App Group 标识。
enum AtollaAppGroup {
    static let suiteName = "group.com.atolla.mobile"

    /// App Group UserDefaults；不可用时回退标准套件（仅便于本地编译）。
    static var defaults: UserDefaults {
        UserDefaults(suiteName: suiteName) ?? .standard
    }
}
