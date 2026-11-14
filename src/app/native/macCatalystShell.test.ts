import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const bridgeSource = readSource('../../../ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = readSource('../../../ios/App/App/SceneDelegate.swift');
const capacitorConfigSource = readSource('../../../capacitor.config.ts');
const appDelegateSource = readSource('../../../ios/App/App/AppDelegate.swift');
const widgetSceneSource = readSource('../../../ios/App/App/QuickCaptureSceneDelegate.swift');
const windowingSource = readSource('../../../ios/App/App/MacWindowing.swift');

/** The source outside every `#if targetEnvironment(macCatalyst)` block (and its `#else`). */
const outsideMacOnly = (source: string) =>
  source.replace(/#if targetEnvironment\(macCatalyst\)[\s\S]*?#endif/g, '');

describe('Mac Catalyst shell', () => {
  it('loads the app as a desktop page on Mac only', () => {
    const configuration = bridgeSource.match(
      /override func webViewConfiguration\(for [\s\S]*?\n {4}\}/
    )?.[0];
    expect(
      configuration,
      'MindRoomBridgeViewController must override webViewConfiguration'
    ).toBeDefined();
    expect(configuration).toMatch(/super\.webViewConfiguration\(for:/);
    // Compile-time check: `isMacCatalystApp` is also true for the App Store iPad
    // app on Apple silicon Macs, which must keep the mobile content mode.
    expect(configuration).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*\w+\.defaultWebpagePreferences\.preferredContentMode = \.desktop\s*#endif/
    );
    expect(configuration).not.toMatch(/ProcessInfo\.processInfo\.isMacCatalystApp/);
    // iPhone and iPad keep the configured mobile content mode.
    expect(capacitorConfigSource).toMatch(/preferredContentMode: 'mobile'/);
  });

  it('keeps the Mac window large enough for the app', () => {
    expect(sceneSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*windowScene\.sizeRestrictions\?\.minimumSize = CGSize\(width: 400, height: 500\)\s*#endif/
    );
  });
  it('uses browser Apple SSO on Catalyst and keeps native authorization for iOS', () => {
    const authSource = readSource('../../../ios/App/App/MindRoomAuthPlugin.swift');
    const appleMethod = authSource.match(
      /@objc func signInWithApple[\s\S]*?(?= {4}public func presentationAnchor)/
    )?.[0];
    expect(appleMethod).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*authenticate\(call\)\s*#else[\s\S]*ASAuthorizationAppleIDProvider[\s\S]*#endif/
    );
  });

  it('keeps AppKit, Carbon and ScreenCaptureKit inside Mac-only blocks', () => {
    // The iOS routing test host compiles every file of ios/App/App.
    ['MacWindowing.swift', 'MacScreenshot.swift'].forEach((name) => {
      const source = readSource(`../../../ios/App/App/${name}`);
      expect(outsideMacOnly(source).trim(), name).toBe('import UIKit');
    });
    [appDelegateSource, widgetSceneSource, sceneSource].forEach((source) => {
      expect(outsideMacOnly(source)).not.toMatch(
        /MacWindowing|MacScreenshot|NSClassFromString|dlsym|buildMenu/
      );
    });
  });

  it('opens the Quick Capture scene by its activity type and has one main window', () => {
    expect(appDelegateSource).toMatch(
      /options\.userActivities\.contains \{ \$0\.activityType == QuickCapture\.activityType \}/
    );
    expect(widgetSceneSource).toContain('static let activityType = "chat.mindroom.quick-capture"');
    expect(widgetSceneSource).toContain('static let configurationName = "Quick Capture"');
    expect(appDelegateSource).toContain('builder.remove(menu: .newScene)');
    expect(appDelegateSource).toMatch(/input: " ",\s*modifierFlags: \[\.control, \.alternate\]/);
    expect(sceneSource).toMatch(
      /\$0 !== scene && \$0\.delegate is SceneDelegate[\s\S]*?requestSceneSessionDestruction\(session/
    );
  });

  it('leaves notifications and links to the main window', () => {
    // A second Capacitor bridge would take the notification center's delegate over.
    expect(widgetSceneSource).toMatch(
      /override func instanceDescriptor\(\)[\s\S]*?descriptor\.handleApplicationNotifications = false/
    );
    expect(widgetSceneSource).toContain(
      'canActivateForTargetContentIdentifierPredicate = NSPredicate(value: false)'
    );
    expect(sceneSource).toContain(
      'prefersToActivateForTargetContentIdentifierPredicate = NSPredicate(value: true)'
    );
    expect(widgetSceneSource).toMatch(
      /func scene\(_ scene: UIScene, openURLContexts[\s\S]*?SceneDelegateProxy\.shared\.scene\(scene, openURLContexts/
    );
  });

  it('notes the app in front only as the widget shows, so hiding gives the keyboard back to it', () => {
    const toggle = widgetSceneSource.match(/static func toggle\(\) \{[\s\S]*?\n {4}\}/)?.[0] ?? '';
    const hideBranch = toggle.match(/if MacWindowing\.widgetIsKey\(host\) \{([\s\S]*?)\}/)?.[1];
    expect(hideBranch).toContain('MacWindowing.hideWidget(host)');
    expect(hideBranch).not.toContain('rememberFrontProcess');
    expect(toggle.match(/rememberFrontProcess\(\)/g)).toHaveLength(2);
    expect(toggle.split('widgetIsKey')[0]).toMatch(
      /rememberFrontProcess\(\)\s*openWidgetScene\(\)/
    );
  });

  it("stops a closed main window's page on the Mac, which closes the widget with it", () => {
    const disconnect =
      sceneSource.match(/func sceneDidDisconnect\(_ scene: UIScene\) \{[\s\S]*?\n {4}\}/)?.[0] ??
      '';
    const macOnly = disconnect.match(/#if targetEnvironment\(macCatalyst\)([\s\S]*?)#endif/)?.[1];
    expect(macOnly).toMatch(/if let window \{/);
    expect(macOnly).toContain('requestSceneSessionDestruction(widget.session');
    expect(macOnly).toMatch(
      /webView\.navigationDelegate = nil\s*webView\.load\(URLRequest\(url: blank\)\)[\s\S]*self\.window = nil/
    );
    expect(outsideMacOnly(disconnect)).not.toContain('about:blank');
  });

  it('follows every other app that comes forward, for a widget a click brought forward', () => {
    expect(appDelegateSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)[^#]*MacWindowing\.followFrontProcess\(\)[^#]*#endif/
    );
    const follow =
      windowingSource.match(/static func followFrontProcess\(\) \{[\s\S]*?\n {4}\}/)?.[0] ?? '';
    expect(follow).toContain('Notification.Name("NSWorkspaceDidActivateApplicationNotification")');
    expect(follow).toContain('userInfo?["NSWorkspaceApplicationKey"]');
    expect(follow).toMatch(/pid != getpid\(\) \{ lastFrontProcess = pid \}/);
  });

  it('serves the routes whose IDs have dots, and the widget, from the app', () => {
    const roots = bridgeSource.match(/let routeRoots: Set<Substring> = \[([\s\S]*?)\]/)?.[1];
    ['home', 'direct', 'threads', 'activity', 'quick-capture'].forEach((root) =>
      expect(roots).toContain(`"${root}"`)
    );
  });
});
