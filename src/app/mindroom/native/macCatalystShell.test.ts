import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const bridgeSource = readSource('../../../../ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = readSource('../../../../ios/App/App/SceneDelegate.swift');
const capacitorConfigSource = readSource('../../../../capacitor.config.ts');

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
    // The page then sees a Mac Safari user agent instead of an iPhone one.
    expect(configuration).toMatch(
      /if ProcessInfo\.processInfo\.isMacCatalystApp \{\s*\w+\.defaultWebpagePreferences\.preferredContentMode = \.desktop/
    );
    // iPhone and iPad keep the configured mobile content mode.
    expect(capacitorConfigSource).toMatch(/preferredContentMode: 'mobile'/);
  });

  it('keeps the Mac window large enough for the app', () => {
    expect(sceneSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)\s*windowScene\.sizeRestrictions\?\.minimumSize = CGSize\(width: 400, height: 500\)\s*#endif/
    );
  });
});
