import UIKit

#if targetEnvironment(macCatalyst)
import Darwin

/// AppKit and Carbon for the Quick Capture window, reached through the Objective-C runtime and
/// `dlsym`: a Mac Catalyst app links neither. Main thread only.
enum MacWindowing {
    /// The widget's window in points.
    static let widgetSize = CGSize(width: 360, height: 460)
    /// The key of the window's place in the user defaults.
    private static let frameName = "MindRoomQuickCapture"

    private static var hotKeyAction: (() -> Void)?
    private static var hotKeyInstalled = false
    private static var styledWindows = Set<ObjectIdentifier>()

    /// The process id of the app that was in front before the widget showed, for the window
    /// screenshot and to give the keyboard back when the widget hides.
    private(set) static var lastFrontProcess: pid_t?

    // MARK: The runtime

    private static func appKitClass(_ name: String) -> AnyClass? { NSClassFromString(name) }

    private static var application: NSObject? {
        appKitClass("NSApplication")?.value(forKey: "sharedApplication") as? NSObject
    }

    /// `[target name:argument]` for a method that takes one integer and returns an object.
    private static func object(_ target: NSObject, _ name: String, _ argument: Int) -> NSObject? {
        let selector = NSSelectorFromString(name)
        guard target.responds(to: selector) else { return nil }
        typealias Method = @convention(c) (NSObject, Selector, Int) -> Unmanaged<NSObject>?
        let method = unsafeBitCast(target.method(for: selector), to: Method.self)
        return method(target, selector, argument)?.takeUnretainedValue()
    }

    /// `[target name:argument]` for a method that takes one integer or `BOOL`.
    private static func send(_ target: NSObject, _ name: String, _ argument: Int) {
        let selector = NSSelectorFromString(name)
        guard target.responds(to: selector) else { return }
        typealias Method = @convention(c) (NSObject, Selector, Int) -> Void
        unsafeBitCast(target.method(for: selector), to: Method.self)(target, selector, argument)
    }

    /// `[target name:nil]`, the form of AppKit's actions.
    private static func act(_ target: NSObject, _ name: String) {
        let selector = NSSelectorFromString(name)
        guard target.responds(to: selector) else { return }
        _ = target.perform(selector, with: nil)
    }

    private static func flag(_ target: NSObject?, _ key: String) -> Bool {
        (target?.value(forKey: key) as? NSNumber)?.boolValue ?? false
    }

    // MARK: Windows

    /// The AppKit window that shows `window`.
    static func hostWindow(of window: UIWindow) -> NSObject? {
        guard let windows = application?.value(forKey: "windows") as? [NSObject] else { return nil }
        let uiWindows = NSSelectorFromString("uiWindows")
        return windows.first { candidate in
            guard candidate.responds(to: uiWindows) else { return false }
            return (candidate.value(forKey: "uiWindows") as? [UIWindow])?.contains(window) ?? false
        }
    }

    /// The Mac's points per UIKit point in `window`, which shows `uiWindow`: 0.77 in an app
    /// scaled to match iPad.
    static func pointScale(of window: NSObject, showing uiWindow: UIWindow) -> CGFloat {
        let content = window.value(forKey: "contentView") as? NSObject
        let width = (content?.value(forKey: "frame") as? NSValue)?.cgRectValue.width ?? 0
        guard width > 0, uiWindow.bounds.width > 0 else { return 1 }
        return width / uiWindow.bounds.width
    }

    /// Makes `window` a panel: no title bar or buttons, floating above other apps' windows,
    /// movable by its background, its place remembered, with a window's corners and shadow and
    /// the system's material behind a page that paints no background. The title bar and the
    /// level go on again on every call, since UIKit sets its own as the scene changes.
    static func styleWidgetWindow(_ window: NSObject) {
        applyChrome(window)
        guard styledWindows.insert(ObjectIdentifier(window)).inserted else { return }
        window.setValue(true, forKey: "movableByWindowBackground")
        addMaterial(to: window)
        _ = window.perform(NSSelectorFromString("setFrameAutosaveName:"), with: frameName)
    }

    private static func applyChrome(_ window: NSObject) {
        let titled = 1 << 0
        let fullSizeContentView = 1 << 15
        // Titled keeps the corners, the shadow and the keyboard; the title bar shows nothing.
        window.setValue(titled | fullSizeContentView, forKey: "styleMask")
        window.setValue(true, forKey: "titlebarAppearsTransparent")
        window.setValue(1, forKey: "titleVisibility") // NSWindowTitleHidden
        for button in 0...2 { // close, miniaturize, zoom
            object(window, "standardWindowButton:", button)?.setValue(true, forKey: "hidden")
        }
        window.setValue(3, forKey: "level") // NSFloatingWindowLevel
        // On the Space in front as it shows. Over another app's full-screen Space the app's
        // activation moves to a desktop Space, which canJoinAllSpaces would leave the window off
        // while it takes the keyboard.
        let moveToActiveSpace = 1 << 1
        let transient = 1 << 3
        let ignoresCycle = 1 << 6
        let fullScreenAuxiliary = 1 << 8
        window.setValue(
            moveToActiveSpace | transient | ignoresCycle | fullScreenAuxiliary,
            forKey: "collectionBehavior"
        )
        window.setValue(2, forKey: "tabbingMode") // NSWindowTabbingModeDisallowed
    }

    /// The popover material behind the window's content, blended with what is under the window.
    private static func addMaterial(to window: NSObject) {
        guard let effectClass = appKitClass("NSVisualEffectView") as? NSObject.Type,
              let content = window.value(forKey: "contentView") as? NSObject,
              let frame = content.value(forKey: "superview") as? NSObject,
              let clear = appKitClass("NSColor")?.value(forKey: "clearColor") else { return }
        window.setValue(false, forKey: "opaque")
        window.setValue(clear, forKey: "backgroundColor")
        let effect = effectClass.init()
        effect.setValue(frame.value(forKey: "bounds"), forKey: "frame")
        effect.setValue(2 | 16, forKey: "autoresizingMask") // width and height sizable
        effect.setValue(6, forKey: "material") // NSVisualEffectMaterialPopover
        effect.setValue(0, forKey: "blendingMode") // behind the window
        effect.setValue(1, forKey: "state") // always active
        let selector = NSSelectorFromString("addSubview:positioned:relativeTo:")
        typealias Method = @convention(c) (NSObject, Selector, NSObject, Int, NSObject?) -> Void
        unsafeBitCast(frame.method(for: selector), to: Method.self)(
            frame, selector, effect, -1, content // NSWindowBelow
        )
    }

    /// The widget in front of every app, with the keyboard. The main window stays where it is.
    static func showWidget(_ window: NSObject) {
        rememberFrontProcess()
        applyChrome(window)
        act(window, "makeKeyAndOrderFront:")
        act(window, "makeMainWindow")
        if let application { send(application, "activateIgnoringOtherApps:", 1) }
    }

    /// Hides the widget and, when it had the keyboard, gives it back to the app that had it.
    static func hideWidget(_ window: NSObject) {
        let hadKeyboard = widgetIsKey(window)
        act(window, "orderOut:")
        guard hadKeyboard, let pid = lastFrontProcess, pid != getpid() else { return }
        activateProcess(pid)
    }

    static func widgetIsKey(_ window: NSObject) -> Bool {
        flag(application, "active") && flag(window, "keyWindow")
    }

    /// `window` in front, with the keyboard.
    static func showMainWindow(_ window: NSObject) {
        act(window, "makeKeyAndOrderFront:")
        if let application { send(application, "activateIgnoringOtherApps:", 1) }
    }

    /// The display `window` is on, as ScreenCaptureKit names it.
    static func displayID(of window: NSObject) -> UInt32? {
        let screen = window.value(forKey: "screen") as? NSObject
        let description = screen?.value(forKey: "deviceDescription") as? [String: Any]
        return (description?["NSScreenNumber"] as? NSNumber)?.uint32Value
    }

    private static func rememberFrontProcess() {
        let workspace = appKitClass("NSWorkspace")?.value(forKey: "sharedWorkspace") as? NSObject
        let front = workspace?.value(forKey: "frontmostApplication") as? NSObject
        if let pid = (front?.value(forKey: "processIdentifier") as? NSNumber)?.int32Value {
            lastFrontProcess = pid
        }
    }

    private static func activateProcess(_ pid: pid_t) {
        guard let runningClass = appKitClass("NSRunningApplication"),
              let metaclass = object_getClass(runningClass) else { return }
        let selector = NSSelectorFromString("runningApplicationWithProcessIdentifier:")
        typealias Lookup = @convention(c) (AnyClass, Selector, pid_t) -> Unmanaged<NSObject>?
        let lookup = unsafeBitCast(class_getMethodImplementation(metaclass, selector), to: Lookup.self)
        guard let running = lookup(runningClass, selector, pid)?.takeUnretainedValue() else { return }
        send(running, "activateWithOptions:", 0)
    }

    // MARK: The hot key

    /// Registers Control+Option+Space once, for every app; `action` runs on the main queue.
    /// Option+Space alone is the default of Raycast and Alfred, which would open with the widget.
    static func installHotKey(_ action: @escaping () -> Void) {
        hotKeyAction = action
        guard !hotKeyInstalled,
              let carbon = dlopen("/System/Library/Frameworks/Carbon.framework/Carbon", RTLD_LAZY),
              let targetSymbol = dlsym(carbon, "GetEventDispatcherTarget"),
              let installSymbol = dlsym(carbon, "InstallEventHandler"),
              let registerSymbol = dlsym(carbon, "RegisterEventHotKey") else {
            NSLog("[QuickCapture] Carbon hot key functions not found")
            return
        }
        typealias Target = @convention(c) () -> OpaquePointer?
        typealias Handler = @convention(c) (OpaquePointer?, OpaquePointer?, UnsafeMutableRawPointer?) -> Int32
        typealias Install = @convention(c) (
            OpaquePointer?, Handler, Int, UnsafePointer<UInt32>, UnsafeMutableRawPointer?,
            UnsafeMutablePointer<OpaquePointer?>?
        ) -> Int32
        // EventHotKeyID, two UInt32 fields, travels in one register as a UInt64.
        typealias Register = @convention(c) (
            UInt32, UInt32, UInt64, OpaquePointer?, UInt32, UnsafeMutablePointer<OpaquePointer?>
        ) -> Int32

        let target = unsafeBitCast(targetSymbol, to: Target.self)()
        let handler: Handler = { _, _, _ in
            DispatchQueue.main.async { MacWindowing.hotKeyAction?() }
            return 0
        }
        // EventTypeSpec { kEventClassKeyboard 'keyb', kEventHotKeyPressed }
        let pressed: [UInt32] = [0x6B65_7962, 5]
        let installed = pressed.withUnsafeBufferPointer { spec in
            unsafeBitCast(installSymbol, to: Install.self)(target, handler, 1, spec.baseAddress!, nil, nil)
        }
        var hotKey: OpaquePointer?
        let hotKeyID = UInt64(1) << 32 | UInt64(0x4D52_5143) // id 1, signature 'MRQC'
        // kVK_Space with controlKey and optionKey.
        let registered = unsafeBitCast(registerSymbol, to: Register.self)(49, 0x1000 | 0x0800, hotKeyID, target, 0, &hotKey)
        hotKeyInstalled = installed == 0 && registered == 0
        if !hotKeyInstalled {
            NSLog("[QuickCapture] the hot key was not registered: %d %d", installed, registered)
        }
    }
}
#endif
