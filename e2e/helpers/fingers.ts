import type { Page } from '@playwright/test';

/** A finger over CDP: its touch point ID and where it is. */
export type Finger = [id: number, x: number, y: number];

/** Raw touch points over CDP, in Chromium only: each call lists every finger down. */
export const fingersOn = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map(([id, x, y]) => ({ id, x, y })),
    });
};
