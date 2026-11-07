import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../../capacitor.config';

describe('Capacitor web view zoom', () => {
  // With zoom on, the iOS web view's own pinch magnifies the page like a picture. Off (the
  // default), Capacitor turns that pinch off and the app's pinch changes the page zoom setting
  // (theme/usePinchToZoom.ts), so the layout reflows at the new size.
  it("keeps the iOS web view's own pinch magnification off", () => {
    expect(capacitorConfig.ios?.zoomEnabled).not.toBe(true);
  });
});
