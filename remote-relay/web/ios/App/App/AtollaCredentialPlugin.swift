import Capacitor
import Foundation
import Network
import AVFoundation
import UIKit

/// Capacitor 凭据桥：将 Web 登录态同步到原生 Keychain，供后续 Siri Intent 使用。
@objc(AtollaCredentialPlugin)
public class AtollaCredentialPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureMetadataOutputObjectsDelegate {
    public let identifier = "AtollaCredentialPlugin"
    public let jsName = "AtollaCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveRelayAPIBase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSiteToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveUnlockToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveRecentInstance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSiteSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearUnlockToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllUnlockTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveLanConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadLanConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLanConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discoverLanRelays", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanLanPairingQRCode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelLanPairingQRCode", returnType: CAPPluginReturnPromise),
    ]

    private let store = AtollaCredentialStore.shared
    private var scannerSession: AVCaptureSession?
    private var scannerCall: CAPPluginCall?
    private var scannerController: UIViewController?

    @objc func saveRelayAPIBase(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("缺少 Relay API Base")
            return
        }
        perform(call) {
            try store.setRelayAPIBase(value)
            mirrorUsageConnection()
        }
    }

    @objc func saveSiteToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("缺少 Site Token")
            return
        }
        perform(call) {
            try store.setSiteToken(token)
            mirrorUsageConnection()
        }
    }

    @objc func saveUnlockToken(_ call: CAPPluginCall) {
        guard
            let instanceID = call.getString("instanceId"),
            let token = call.getString("token"),
            !token.isEmpty
        else {
            call.reject("缺少实例 ID 或 Unlock Token")
            return
        }
        perform(call) {
            try store.setUnlockToken(token, for: instanceID)
            try store.setRecentInstanceID(instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func saveRecentInstance(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else {
            call.reject("缺少实例 ID")
            return
        }
        perform(call) {
            try store.setRecentInstanceID(instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func clearSiteSession(_ call: CAPPluginCall) {
        perform(call) {
            try store.setSiteToken(nil)
            try store.setRecentInstanceID(nil)
            try store.removeAllUnlockTokens()
            AtollaUsageSnapshotStore.clearConnection()
        }
    }

    @objc func clearUnlockToken(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else {
            call.reject("缺少实例 ID")
            return
        }
        perform(call) {
            try store.removeUnlockToken(for: instanceID)
            mirrorUsageConnection()
        }
    }

    @objc func clearAllUnlockTokens(_ call: CAPPluginCall) {
        perform(call) {
            try store.removeAllUnlockTokens()
            mirrorUsageConnection()
        }
    }

    @objc func saveLanConnection(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId"), let baseURL = call.getString("baseUrl"), let deviceID = call.getString("deviceId"), let deviceSecret = call.getString("deviceSecret") else {
            call.reject("缺少局域网配对信息")
            return
        }
        let strategy = call.getString("strategy") ?? "auto"
        perform(call) {
            try store.setLanConnection(AtollaLanConnection(instanceID: instanceID, baseURL: baseURL, deviceID: deviceID, deviceSecret: deviceSecret, strategy: strategy), for: instanceID)
        }
    }

    @objc func loadLanConnection(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else { call.reject("缺少实例 ID"); return }
        do {
            guard let value = try store.lanConnection(for: instanceID) else { call.resolve(["found": false]); return }
            call.resolve(["found": true, "instanceId": value.instanceID, "baseUrl": value.baseURL, "deviceId": value.deviceID, "deviceSecret": value.deviceSecret, "strategy": value.strategy])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func clearLanConnection(_ call: CAPPluginCall) {
        guard let instanceID = call.getString("instanceId") else { call.reject("缺少实例 ID"); return }
        perform(call) { try store.removeLanConnection(for: instanceID) }
    }

    @objc func discoverLanRelays(_ call: CAPPluginCall) {
        // Bonjour is discovery only; every subsequent request is still HMAC
        // authenticated. This avoids trusting a service merely because it
        // announced the same name on a shared Wi-Fi network.
        let browser = NWBrowser(for: .bonjour(type: "_atolla._tcp", domain: nil), using: .tcp)
        var services = Set<String>()
        browser.browseResultsChangedHandler = { results, _ in
            for result in results { services.insert(result.endpoint.debugDescription) }
        }
        browser.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            browser.cancel()
            call.resolve(["services": services.sorted().map { ["endpoint": $0] }])
        }
    }

    @objc func scanLanPairingQRCode(_ call: CAPPluginCall) {
        // Capacitor invokes plugin methods on its `bridge` queue, not UIKit's
        // main thread. All permission/UI/session construction must cross this
        // boundary before touching AVCapture or UIViewController.
        DispatchQueue.main.async { [weak self] in
            self?.startQRScanOnMain(call)
        }
    }

    /// Allows the Web layer to abandon a pending scan during navigation. The
    /// native overlay uses the same cleanup path, so a cancelled scan never
    /// leaves `scannerCall` occupied and blocking the next attempt.
    @objc func cancelLanPairingQRCode(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.finishQRScanner(cancelled: true)
            call.resolve(["ok": true])
        }
    }

    private func startQRScanOnMain(_ call: CAPPluginCall) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard scannerCall == nil else { call.reject("二维码扫描已在进行中"); return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            beginQRScanner(call)
        case .notDetermined:
            // The old path created an AVCapture input before resolving camera
            // permission. On physical devices this could leave the WebView in
            // an inconsistent presentation state and terminate the App.
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard granted else { call.reject("需要相机权限才能扫描配对二维码"); return }
                    self?.beginQRScanner(call)
                }
            }
        case .denied, .restricted:
            call.reject("相机权限未开启，请在 iPhone 设置中允许 Atolla 使用相机")
        @unknown default:
            call.reject("无法确定相机权限状态")
        }
    }

    private func beginQRScanner(_ call: CAPPluginCall) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let camera = AVCaptureDevice.default(for: .video), let presenter = bridge?.viewController else { call.reject("无法初始化二维码扫描界面"); return }
        do {
            let session = AVCaptureSession()
            let input = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(input) else { call.reject("无法初始化二维码扫描"); return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { call.reject("无法初始化二维码扫描"); return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let controller = UIViewController()
            controller.modalPresentationStyle = .fullScreen
            controller.view.backgroundColor = .black
            let preview = AVCaptureVideoPreviewLayer(session: session)
            // The scanner is full screen; UIKit owns its view sizing. CALayer's
            // autoresizingMask is unavailable on iOS, so use the screen bounds
            // established before presentation instead of a macOS-only API.
            preview.frame = UIScreen.main.bounds
            preview.videoGravity = .resizeAspectFill
            controller.view.layer.addSublayer(preview)
            let overlay = QRScannerOverlayView()
            overlay.frame = controller.view.bounds
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.onClose = { [weak self] in
                self?.finishQRScanner(cancelled: true)
            }
            controller.view.addSubview(overlay)
            scannerSession = session
            scannerCall = call
            scannerController = controller
            presenter.present(controller, animated: true) {
                // startRunning is blocking work. Keep it off the main queue so
                // iOS does not kill the App for a frozen presentation frame.
                DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
            }
        } catch { call.reject("无法访问摄像头：\(error.localizedDescription)") }
    }

    public func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        finishQRScanner(payload: value)
    }

    /// Clears state before dismissing. This order is deliberate: presentation
    /// animations and AVFoundation shutdown are asynchronous, while the user
    /// must be able to immediately tap Scan again after cancelling.
    private func finishQRScanner(payload: String? = nil, cancelled: Bool = false) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let call = scannerCall else { return }
        let session = scannerSession
        let controller = scannerController
        scannerSession = nil
        scannerCall = nil
        scannerController = nil
        DispatchQueue.global(qos: .userInitiated).async {
            session?.stopRunning()
        }
        let complete = {
            if let payload {
                call.resolve(["payload": payload])
            } else if cancelled {
                call.resolve(["cancelled": true])
            } else {
                call.reject("二维码扫描已结束")
            }
        }
        if let controller {
            controller.dismiss(animated: true, completion: complete)
        } else {
            complete()
        }
    }

    private func perform(_ call: CAPPluginCall, operation: () throws -> Void) {
        do {
            try operation()
            call.resolve(["ok": true])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    /// 同步连接信息到 App Group，供桌面用量小组件后台刷新。
    private func mirrorUsageConnection() {
        let id = try? store.recentInstanceID()
        let unlock = id.flatMap { try? store.unlockToken(for: $0) }
        AtollaUsageSnapshotStore.saveConnection(
            AtollaUsageConnection(
                relayAPIBase: try? store.relayAPIBase(),
                siteToken: try? store.siteToken(),
                instanceID: id,
                unlockToken: unlock
            )
        )
    }
}

/// Native scanner chrome. Keeping it outside the WebView makes the close
/// affordance reliable even while the camera owns the full screen.
private final class QRScannerOverlayView: UIView {
    var onClose: (() -> Void)?

    private let guideLayer = CAShapeLayer()
    private let promptLabel = UILabel()
    private let closeButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        guideLayer.fillColor = UIColor.clear.cgColor
        guideLayer.strokeColor = UIColor.white.cgColor
        guideLayer.lineWidth = 2
        guideLayer.lineDashPattern = [8, 6]
        guideLayer.shadowColor = UIColor.black.cgColor
        guideLayer.shadowOpacity = 0.55
        guideLayer.shadowRadius = 5
        layer.addSublayer(guideLayer)

        promptLabel.text = "将配对二维码放入方框内"
        promptLabel.textColor = .white
        promptLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        promptLabel.textAlignment = .center
        promptLabel.numberOfLines = 2
        addSubview(promptLabel)

        closeButton.setTitle("×", for: .normal)
        closeButton.setTitleColor(.white, for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 30, weight: .regular)
        closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.46)
        closeButton.layer.cornerRadius = 22
        closeButton.accessibilityLabel = "关闭扫码"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        addSubview(closeButton)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = min(bounds.width - 64, 280)
        let guide = CGRect(x: (bounds.width - side) / 2, y: max(safeAreaInsets.top + 92, (bounds.height - side) / 2 - 42), width: side, height: side)
        guideLayer.path = UIBezierPath(roundedRect: guide, cornerRadius: 20).cgPath
        guideLayer.frame = bounds
        promptLabel.frame = CGRect(x: 28, y: guide.maxY + 20, width: bounds.width - 56, height: 48)
        closeButton.frame = CGRect(x: 20, y: safeAreaInsets.top + 16, width: 44, height: 44)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 0.46
        pulse.toValue = 1.0
        pulse.duration = 0.9
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        guideLayer.add(pulse, forKey: "atolla.scan.pulse")
        let dash = CABasicAnimation(keyPath: "lineDashPhase")
        dash.fromValue = 0
        dash.toValue = 28
        dash.duration = 0.8
        dash.repeatCount = .infinity
        guideLayer.add(dash, forKey: "atolla.scan.dash")
    }

    @objc private func closeTapped() { onClose?() }
}
