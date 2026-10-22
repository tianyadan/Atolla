import Capacitor
import UIKit

/// 注册 App 内本地插件（cap sync 的 packageClassList 不含本地 Swift）
class AtollaBridgeViewController: CAPBridgeViewController {
  override open func capacitorDidLoad() {
    super.capacitorDidLoad()
    bridge?.registerPluginInstance(AtollaIslandPlugin())
  }
}
