import Foundation

/// Values shared by the Catalyst Store app and its native macOS support bundle.
/// UIKit and AppKit objects stay on their respective sides, except opaque window handles.
@objc(MindRoomMacSupportProtocol)
protocol MindRoomMacSupportProtocol: NSObjectProtocol {
    func window(titled title: String) -> NSObject?
    func pointScale(of window: NSObject, uiWidth: Double) -> Double
    func styleWidgetWindow(_ window: NSObject)
    func showWidget(_ window: NSObject)
    func hideWidget(_ window: NSObject)
    func widgetIsKey(_ window: NSObject) -> Bool
    func showMainWindow(_ window: NSObject)
    func displayID(of window: NSObject) -> NSNumber?
    func rememberFrontProcess()
    func followFrontProcess()
    func monitorMouseButtons(_ handler: @escaping (NSObject?, Int, Bool) -> Bool)
    var lastFrontProcess: Int32 { get }
    func installHotKey(_ action: @escaping () -> Void) -> Bool
    func windowOrder() -> [NSNumber]
}
