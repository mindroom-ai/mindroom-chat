import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../../capacitor.config';

describe('Capacitor status bar config', () => {
  it('keeps the shared native inset default for Android', () => {
    expect(capacitorConfig.plugins?.StatusBar?.overlaysWebView).toBe(false);
  });

  it('matches the native status bar background to the default app background', () => {
    expect(capacitorConfig.plugins?.StatusBar?.backgroundColor).toBe('#1A1A1A');
  });

  it('hints viewport-fit=cover for Android SystemBars to prevent initial inset shift', () => {
    expect(capacitorConfig.plugins?.SystemBars?.initialViewportFitValueHint).toBe('cover');
  });
});
