import Capacitor
import WebKit
import XCTest
@testable import RoutingHost

/// Side effects, rather than missing JS replies, prove whether native dispatch occurred.
@objc(BridgeProbePlugin)
final class BridgeProbePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "BridgeProbePlugin"
    let jsName = "BridgeProbe"
    let pluginMethods = [
        CAPPluginMethod(name: "record", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]
    private var calls = 0

    @objc func record(_ call: CAPPluginCall) {
        calls += 1
        call.resolve(["calls": calls])
    }

    @objc func read(_ call: CAPPluginCall) {
        call.resolve(["calls": calls])
    }
}

@MainActor
final class NativeBridgeSecurityTests: XCTestCase {
    private func fixture() async throws -> WKWebView {
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .compactMap { $0.rootViewController as? MindRoomBridgeViewController }.first)
        let webView = try XCTUnwrap(controller.webView)
        webView.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if !webView.isLoading, (try? await webView.evaluateJavaScript("!!window.routingBootId")) as? Bool == true {
                controller.bridge?.registerPluginInstance(BridgeProbePlugin())
                return webView
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Bundled app must load before probing its bridge")
        return webView
    }

    private func count(_ webView: WKWebView, method: String = "read") async throws -> Int {
        let result = try await webView.callAsyncJavaScript("""
            return (await window.Capacitor.nativePromise('BridgeProbe', method, {})).calls;
            """, arguments: ["method": method], in: nil, contentWorld: .page)
        return try XCTUnwrap(result as? Int)
    }

    func testEveryBridgeScriptIsMainFrameOnly() async throws {
        let webView = try await fixture()
        let scripts = webView.configuration.userContentController.userScripts
        XCTAssertFalse(scripts.isEmpty)
        XCTAssertTrue(scripts.allSatisfy(\.isForMainFrameOnly))
    }

    func testSubframesCannotDispatchPluginsOrUseNativeCookiePrompts() async throws {
        let webView = try await fixture()
        let initial = try await count(webView, method: "record")
        XCTAssertEqual(initial, 1, "Control: the main frame can invoke a native plugin")
        let cookieURL = URL(string: "https://native-bridge-test.invalid")!
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: cookieURL.host!, .path: "/", .name: "bridge_probe", .value: "top-level-only"
        ]))
        HTTPCookieStorage.shared.setCookie(cookie)
        defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
        let results = try await webView.callAsyncJavaScript("""
            const attack = `<script>
              const messages = [];
              try {
                webkit.messageHandlers.bridge.postMessage({type:'message',pluginId:'BridgeProbe',methodName:'record',callbackId:'hostile',options:{}});
                messages.push('posted');
              } catch (error) { messages.push('unavailable'); }
              const prompts = ['CapacitorCookies.get', 'CapacitorCookies.isEnabled', 'CapacitorHttp'].map(type => {
                try { return prompt(JSON.stringify({type})); } catch { return null; }
              });
              try { prompts.push(prompt(JSON.stringify({type:'CapacitorCookies.set',domain:'https://native-bridge-test.invalid',action:'bridge_probe=hostile; path=/'}))); }
              catch { prompts.push(null); }
              parent.postMessage({probe:true, bridge:typeof window.Capacitor, messages, prompts}, '*');
            <\\/script>`;
            return await new Promise(resolve => {
              const results = [];
              const frames = [];
              const timeout = setTimeout(() => finish(), 8000);
              const finish = () => {
                clearTimeout(timeout);
                removeEventListener('message', receive);
                frames.forEach(frame => frame.remove());
                resolve(results);
              };
              const receive = event => {
                if (event.data?.probe && frames.some(frame => frame.contentWindow === event.source)) {
                  results.push(event.data);
                  if (results.length === 2) finish();
                }
              };
              addEventListener('message', receive);
              for (const sandbox of [null, 'allow-scripts allow-forms']) {
                const frame = document.createElement('iframe');
                if (sandbox) frame.setAttribute('sandbox', sandbox);
                frame.srcdoc = attack;
                frames.push(frame);
                document.body.append(frame);
              }
            });
            """, arguments: [:], in: nil, contentWorld: .page) as? [[String: Any]]
        XCTAssertEqual(results?.count, 2, "Both an ordinary subframe and an opaque sandbox must execute the attack")
        XCTAssertTrue((results ?? []).contains { ($0["messages"] as? [String]) == ["posted"] },
                      "Control: at least the ordinary frame must exercise WebKit's raw message handler")
        for result in results ?? [] {
            XCTAssertEqual(result["bridge"] as? String, "undefined", "Bridge scripts must not be injected in a subframe")
            let prompts = try XCTUnwrap(result["prompts"] as? [Any])
            XCTAssertEqual(prompts.count, 4)
            XCTAssertTrue(prompts.allSatisfy { $0 is NSNull }, "Subframe prompt calls cannot reach native cookies/HTTP")
        }
        // The plugin queue is serial: this round trip also drains earlier hostile dispatches.
        let after = try await count(webView)
        XCTAssertEqual(after, 1, "Raw subframe messages must never run the plugin")
        XCTAssertEqual(HTTPCookieStorage.shared.cookies(for: cookieURL)?.first { $0.name == "bridge_probe" }?.value,
                       "top-level-only", "Subframes cannot mutate native cookies")
        let enabled = try await webView.evaluateJavaScript("prompt(JSON.stringify({type:'CapacitorCookies.isEnabled'}))") as? String
        XCTAssertEqual(enabled, "false", "Control: the main-frame synchronous bridge still works")
    }
}
