import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../../../capacitor.config';

describe('Capacitor status bar config', () => {
  it('keeps native iOS content below the status bar cutout', () => {
    expect(capacitorConfig.plugins?.StatusBar?.overlaysWebView).toBe(false);
  });
});
