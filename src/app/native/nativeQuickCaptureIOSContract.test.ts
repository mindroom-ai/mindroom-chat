import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScreenshotErrorCode } from './nativeQuickCapture';

const pluginSource = readFileSync(
  new URL('../../../ios/App/App/MindRoomQuickCapturePlugin.swift', import.meta.url),
  'utf8'
);
const screenshotSource = readFileSync(
  new URL('../../../ios/App/App/MacScreenshot.swift', import.meta.url),
  'utf8'
);
const bridgeSource = readFileSync(
  new URL('../../../ios/App/App/MindRoomBridgeViewController.swift', import.meta.url),
  'utf8'
);

const METHODS = ['hide', 'showMainWindow', 'openScreenRecordingSettings', 'captureScreenshot'];
const CODES: ScreenshotErrorCode[] = [
  'PERMISSION_DENIED',
  'NO_WINDOW',
  'UNSUPPORTED',
  'CAPTURE_FAILED',
];

describe('MindRoomQuickCapturePlugin native contract', () => {
  it('is the plugin the web side registers, with its four methods, on every bridge', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomQuickCapture"');
    METHODS.forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      // A method each on the Mac and elsewhere.
      expect(pluginSource.match(new RegExp(`@objc func ${method}\\(`, 'g'))).toHaveLength(2);
    });
    expect(bridgeSource).toContain('registerPluginInstance(MindRoomQuickCapturePlugin())');
  });

  it('rejects with the codes the web side knows, and UNSUPPORTED off the Mac', () => {
    CODES.forEach((code) => expect(screenshotSource).toContain(`= "${code}"`));
    // Store-specific branches may nest inside the outer Catalyst branch.
    let depth = 0;
    let capturing = false;
    const lines: string[] = [];
    for (const line of pluginSource
      .slice(pluginSource.indexOf('#if targetEnvironment(macCatalyst)'))
      .split('\n')) {
      if (/^#if\b/.test(line)) depth += 1;
      if (/^#else\b/.test(line) && depth === 1) {
        capturing = true;
        continue;
      }
      if (/^#endif\b/.test(line) && --depth === 0) break;
      if (capturing) lines.push(line);
    }
    const offMac = lines.join('\n');
    expect(offMac).toContain('call.reject("Quick Capture is only on the Mac", "UNSUPPORTED")');
  });

  it('resolves a capture as its path and file name', () => {
    expect(pluginSource).toContain('call.resolve(["path": shot.path, "name": shot.name])');
    expect(screenshotSource).toContain(
      'Screenshot \\(safeLabel) \\(formatter.string(from: Date())).png'
    );
  });
});
