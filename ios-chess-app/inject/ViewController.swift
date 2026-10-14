//
//  ViewController.swift — DROP-IN REPLACEMENT
//
//  Cách dùng: trong project ChessMate (do safari-web-extension-converter tạo ra),
//  mở file ViewController.swift của APP target (không phải Extension target),
//  xóa toàn bộ nội dung cũ và paste file này vào. Giữ nguyên tên class
//  "ViewController" để khớp với storyboard có sẵn.
//
//  Sau đó kéo thư mục `web/` (ở ios-chess-app/ChessMateChess/web) vào project,
//  tick "Copy items if needed" + "Create folder references", add vào APP target.
//
//  Kết quả: mở app ChessMate là chơi cờ ngay (engine, gợi ý, TTS...),
//  extension Safari vẫn hoạt động bình thường trong Safari.
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate {

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x0f / 255, green: 0x14 / 255,
                                         blue: 0x20 / 255, alpha: 1)
        view.addSubview(webView)
        view.sendSubviewToBack(webView)

        if let url = Bundle.main.url(forResource: "index",
                                     withExtension: "html",
                                     subdirectory: "web") {
            webView.loadFileURL(url,
                                allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            print("[ChessMate] web/index.html not found — did you add the web folder to the APP target?")
        }
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        print("[ChessMate] webview failed:", error.localizedDescription)
    }
}
