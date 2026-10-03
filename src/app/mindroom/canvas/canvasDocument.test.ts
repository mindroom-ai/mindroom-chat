import { describe, expect, it } from 'vitest';
import {
  buildCanvasDocument,
  CANVAS_CSP,
  CANVAS_PERMISSIONS,
  CANVAS_SANDBOX,
} from './canvasDocument';

describe('buildCanvasDocument', () => {
  it('puts the CSP before any agent markup so agent content cannot loosen it', () => {
    const doc = buildCanvasDocument(
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>hi</p>',
      'dark'
    );
    const cspIndex = doc.indexOf(`content="${CANVAS_CSP}"`);
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf('default-src *'));
    expect(doc.indexOf('<head>')).toBeLessThan(cspIndex);
    expect(doc.indexOf('</head>')).toBeLessThan(doc.indexOf('<p>hi</p>'));
  });

  it('defines the bridge before agent scripts run', () => {
    const doc = buildCanvasDocument('<script>mindroom.submit({a: 1})</script>', 'light');
    expect(doc.indexOf('mindroom.canvas.submit')).toBeLessThan(
      doc.indexOf('mindroom.submit({a: 1})')
    );
  });

  it('blocks network, navigation targets, and nested frames', () => {
    expect(CANVAS_CSP).toContain("default-src 'none'");
    expect(CANVAS_CSP).toContain("connect-src 'none'");
    expect(CANVAS_CSP).toContain("form-action 'none'");
    expect(CANVAS_CSP).toContain("frame-src 'none'");
    expect(CANVAS_CSP).toContain("base-uri 'none'");
    expect(CANVAS_CSP).not.toMatch(/https?:/);
  });

  it('never grants same-origin, popups, or top navigation', () => {
    expect(CANVAS_SANDBOX.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts']);
  });

  it('follows the app color scheme', () => {
    expect(buildCanvasDocument('', 'dark')).toContain('<meta name="color-scheme" content="dark">');
    expect(buildCanvasDocument('', 'light')).toContain(
      '<meta name="color-scheme" content="light">'
    );
  });

  it('removes WebRTC constructors before agent scripts and denies powerful features', () => {
    const doc = buildCanvasDocument('<script>agent()</script>', 'light');
    expect(doc.indexOf('RTCPeerConnection')).toBeLessThan(doc.indexOf('agent()'));
    expect(CANVAS_PERMISSIONS).toContain("camera 'none'");
    expect(CANVAS_PERMISSIONS).toContain("microphone 'none'");
    expect(CANVAS_PERMISSIONS).toContain("clipboard-read 'none'");
  });
});
