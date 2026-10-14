import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        ChessWebView()
            .ignoresSafeArea()
            .preferredColorScheme(.dark)
    }
}

struct ChessWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Keep localStorage / speech state stable across launches
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x0f / 255, green: 0x14 / 255, blue: 0x20 / 255, alpha: 1)

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url == nil else { return }
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            print("[ChessMateChess] index.html not found in bundle (expected at web/index.html)")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[ChessMateChess] navigation failed:", error.localizedDescription)
        }
    }
}
