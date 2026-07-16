import Capacitor

@objc(MindRoomBridgeViewController)
class MindRoomBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MindRoomAuthPlugin())
        bridge?.registerPluginInstance(MindRoomFileSavePlugin())
    }
}
