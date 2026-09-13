import Capacitor

@objc(MindRoomBridgeViewController)
class MindRoomBridgeViewController: CAPBridgeViewController {
#if DEBUG
    private var didStartFileSaveAcceptanceFixture = false
#endif

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MindRoomAuthPlugin())
        bridge?.registerPluginInstance(MindRoomFileSavePlugin())
    }

#if DEBUG
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        guard ProcessInfo.processInfo.environment["MINDROOM_FILE_SAVE_ACCEPTANCE"] == "1",
              !didStartFileSaveAcceptanceFixture else {
            return
        }
        didStartFileSaveAcceptanceFixture = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            let script = """
            void (async () => {
              const pageId = `ios-export-acceptance-${Date.now()}`;
              const session = await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'beginSave',
                { pageId, fileName: 'mindroom-export-acceptance.txt' }
              );
              await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'appendSave',
                { id: session.id, data: 'bWluZHJvb20taW9zLWV4cG9ydC1hY2NlcHRhbmNlLXYxCg==' }
              );
              return window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'presentSave',
                { id: session.id }
              );
            })();
            null;
            """
            self?.webView?.evaluateJavaScript(script) { _, error in
                if let error {
                    NSLog("MindRoom file-save acceptance fixture failed: %@", error.localizedDescription)
                }
            }
        }
    }
#endif
}
