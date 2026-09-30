// HavamaniaChat.swift
// Havamania Asistan sohbet ekranını WKWebView içinde açar.
//
// Gereken Info.plist anahtarları (fotoğraf gönderimi için):
//   NSCameraUsageDescription         "Asistana fotoğraf göndermek için"
//   NSPhotoLibraryUsageDescription   "Asistana fotoğraf göndermek için"
//
// Kullanım:
//   let chat = HavamaniaChat(botKey: "hm_pk_BOT_ANAHTARI", userToken: token, mode: .agro)
//   chat.onClose = { ... }
//   present(chat.viewController, animated: true)

import UIKit
import WebKit

public final class HavamaniaChat: NSObject {
    public enum Mode: String { case genel, agro, fly }

    public struct Location {
        public let lat: Double
        public let lon: Double
        public let name: String?
        public init(lat: Double, lon: Double, name: String? = nil) {
            self.lat = lat; self.lon = lon; self.name = name
        }
    }

    /// Sohbet kapandığında çağrılır: kapat düğmesi ya da aşağı kaydırarak kapatma.
    public var onClose: (() -> Void)?

    private let baseURL: URL
    private let botKey: String
    private let userToken: String?
    private let deviceId: String
    private let mode: Mode
    private let lockMode: Bool
    private let location: Location?

    public init(
        baseURL: URL = URL(string: "https://havamania.com")!,
        botKey: String,
        userToken: String? = nil,
        deviceId: String = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString,
        mode: Mode = .genel,
        lockMode: Bool = false,
        location: Location? = nil
    ) {
        self.baseURL = baseURL
        self.botKey = botKey
        self.userToken = userToken
        self.deviceId = deviceId
        self.mode = mode
        self.lockMode = lockMode
        self.location = location
    }

    public lazy var viewController: UIViewController = {
        let vc = UIViewController()
        vc.view.backgroundColor = .systemBackground
        vc.view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: vc.view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: vc.view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
        ])
        // Sayfa aşağı kaydırılarak kapatılırsa da onClose çağrılsın.
        vc.presentationController?.delegate = self
        webView.load(URLRequest(url: chatURL()))
        return vc
    }()

    private lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakHandler(self), name: "havamania")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        return view
    }()

    private func chatURL() -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent("w/\(botKey)"), resolvingAgainstBaseURL: false)!
        var q: [URLQueryItem] = [
            .init(name: "platform", value: "ios"),
            .init(name: "deviceId", value: deviceId),
            .init(name: "mode", value: mode.rawValue),
            .init(name: "locale", value: Locale.current.identifier),
            .init(name: "appVersion", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String),
        ]
        if lockMode { q.append(.init(name: "lockMode", value: "1")) }
        if let l = location {
            q.append(.init(name: "lat", value: String(l.lat)))
            q.append(.init(name: "lon", value: String(l.lon)))
            if let n = l.name { q.append(.init(name: "place", value: n)) }
        }
        c.queryItems = q
        // Token URL'nin # kısmında: sunucuya ve loglara gitmez, sayfa okur.
        if let t = userToken {
            c.fragment = "token=\(t.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? t)"
        }
        return c.url!
    }

    fileprivate func handle(_ body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return }
        if type == "close" {
            viewController.dismiss(animated: true)
            onClose?()
        }
    }
}

extension HavamaniaChat: WKNavigationDelegate {
    // Sohbet dışındaki bağlantılar Safari'de açılır.
    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, action.navigationType == .linkActivated || action.targetFrame == nil, url.host != baseURL.host {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

extension HavamaniaChat: UIAdaptivePresentationControllerDelegate {
    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        onClose?()
    }
}

/// WKUserContentController handler'ı güçlü tutar; döngüyü kırmak için zayıf sarmalayıcı.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var owner: HavamaniaChat?
    init(_ owner: HavamaniaChat) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.handle(message.body)
    }
}
