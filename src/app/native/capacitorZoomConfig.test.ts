import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../../capacitor.config';

describe('Capacitor web view zoom', () => {
  // Capacitor turns the iOS web view's pinch recognizer off unless the config asks for zoom.
  it('lets a pinch zoom the iOS app', () => {
    expect(capacitorConfig.ios?.zoomEnabled).toBe(true);
  });
});
