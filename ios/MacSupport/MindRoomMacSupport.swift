import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Native macOS operations used by the Catalyst Store application's Quick Capture scene.
/// Every window is identified through public NSWindow properties, never UIKit internals.
@objc(MindRoomMacSupport)
final class MindRoomMacSupport: NSObject, MindRoomMacSupportProtocol {
    private let frameName = "MindRoomQuickCapture"
    private var frontObserver: NSObjectProtocol?
    private var mouseMonitor: Any?
    private var hotKey: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var hotKeyAction: (() -> Void)?
    private(set) var lastFrontProcess: Int32 = 0

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
        if let frontObserver { NSWorkspace.shared.notificationCenter.removeObserver(frontObserver) }
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
    }

    func window(titled title: String) -> NSObject? {
        guard !title.isEmpty else { return nil }
        let matches = NSApplication.shared.windows.filter { $0.title == title }
        return matches.count == 1 ? matches[0] : nil
    }

    func pointScale(of window: NSObject, uiWidth: Double) -> Double {
        guard let window = window as? NSWindow,
              let width = window.contentView?.frame.width, width > 0, uiWidth > 0 else { return 1 }
        return width / uiWidth
    }

    func styleWidgetWindow(_ handle: NSObject) {
        guard let window = handle as? NSWindow else { return }
        applyChrome(window)
        window.isMovableByWindowBackground = true
        addMaterial(to: window)
        if window.frameAutosaveName != frameName {
            window.setFrameAutosaveName(frameName)
        }
    }

    private func applyChrome(_ window: NSWindow) {
        window.styleMask = [.titled, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        for button: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(button)?.isHidden = true
        }
        window.level = .floating
        window.collectionBehavior = [.moveToActiveSpace, .transient, .ignoresCycle, .fullScreenAuxiliary]
        window.tabbingMode = .disallowed
    }

    private func addMaterial(to window: NSWindow) {
        guard let content = window.contentView, let frame = content.superview,
              !frame.subviews.contains(where: { $0 is NSVisualEffectView }) else { return }
        window.isOpaque = false
        window.backgroundColor = .clear
        let effect = NSVisualEffectView(frame: frame.bounds)
        effect.autoresizingMask = [.width, .height]
        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        frame.addSubview(effect, positioned: .below, relativeTo: content)
    }

    func showWidget(_ handle: NSObject) {
        guard let window = handle as? NSWindow else { return }
        applyChrome(window)
        window.makeKeyAndOrderFront(nil)
        window.makeMain()
        activate()
    }

    func hideWidget(_ handle: NSObject) {
        guard let window = handle as? NSWindow else { return }
        let hadKeyboard = widgetIsKey(window)
        window.orderOut(nil)
        guard hadKeyboard, lastFrontProcess > 0, lastFrontProcess != getpid(),
              let previous = NSRunningApplication(processIdentifier: lastFrontProcess) else { return }
        if #available(macOS 14.0, *) {
            previous.activate(from: .current, options: [])
        } else {
            previous.activate(options: [])
        }
    }

    func widgetIsKey(_ handle: NSObject) -> Bool {
        guard let window = handle as? NSWindow else { return false }
        return NSApplication.shared.isActive && window.isKeyWindow
    }

    func showMainWindow(_ handle: NSObject) {
        guard let window = handle as? NSWindow else { return }
        window.makeKeyAndOrderFront(nil)
        activate()
    }

    private func activate() {
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func displayID(of handle: NSObject) -> NSNumber? {
        guard let window = handle as? NSWindow else { return nil }
        return window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    }

    func rememberFrontProcess() {
        if let app = NSWorkspace.shared.frontmostApplication {
            lastFrontProcess = app.processIdentifier
        }
    }

    func followFrontProcess() {
        guard frontObserver == nil else { return }
        frontObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  application.processIdentifier != getpid() else { return }
            self?.lastFrontProcess = application.processIdentifier
        }
    }

    func monitorMouseButtons(_ handler: @escaping (NSObject?, Int, Bool) -> Bool) {
        guard mouseMonitor == nil else { return }
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.otherMouseDown, .otherMouseUp]) { event in
            handler(event.window, event.buttonNumber, event.type == .otherMouseUp) ? nil : event
        }
    }

    func installHotKey(_ action: @escaping () -> Void) -> Bool {
        if hotKey != nil {
            hotKeyAction = action
            return true
        }
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let installed = InstallEventHandler(
            GetEventDispatcherTarget(),
            { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var identifier = EventHotKeyID()
                let status = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier
                )
                guard status == noErr, identifier.signature == 0x4D52_5143, identifier.id == 1 else {
                    return OSStatus(eventNotHandledErr)
                }
                let support = Unmanaged<MindRoomMacSupport>.fromOpaque(context).takeUnretainedValue()
                DispatchQueue.main.async { support.hotKeyAction?() }
                return noErr
            },
            1, &type, Unmanaged.passUnretained(self).toOpaque(), &eventHandler
        )
        guard installed == noErr else { return false }
        let identifier = EventHotKeyID(signature: 0x4D52_5143, id: 1)
        let registered = RegisterEventHotKey(
            UInt32(kVK_Space), UInt32(controlKey | optionKey), identifier,
            GetEventDispatcherTarget(), 0, &hotKey
        )
        guard registered == noErr else {
            if let eventHandler { RemoveEventHandler(eventHandler) }
            eventHandler = nil
            return false
        }
        hotKeyAction = action
        return true
    }

    func windowOrder() -> [NSNumber] {
        guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        return windows.compactMap { $0[kCGWindowNumber as String] as? NSNumber }
    }
}
