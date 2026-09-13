import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createThreadFixture, loginToMatrix } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const iPhone13 = devices['iPhone 13'];

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
});

test.describe('thread send stability', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('sending a reply from thread view keeps the route anchored to the thread root', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-067 ${stamp}`,
      topic: 'Regression fixture for in-thread send route stability',
      rootBody: `CINNY-067 root ${stamp}`,
      replyBody: `CINNY-067 existing reply ${stamp}`,
      txnPrefix: 'cinny-067',
    });
    const uiReplyBody = `CINNY-067 ui reply ${stamp}`;

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );

    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(fixture.rootBody)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(fixture.replyBody)).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      const samples: Array<string | null> = [];
      const timer = window.setInterval(() => {
        samples.push(new URL(window.location.href).searchParams.get('threadId'));
      }, 50);

      (window as typeof window & {
        __cinny067ThreadRouteProbe?: { samples: Array<string | null>; timer: number };
      }).__cinny067ThreadRouteProbe = { samples, timer };
    });

    const composer = page.getByRole('textbox').last();
    await composer.click();
    await composer.fill(uiReplyBody);
    await composer.press('Control+Enter');

    await expect(page.getByText(uiReplyBody)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(fixture.rootBody)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 30_000,
        message: 'Thread route should stay anchored to the root event after sending a reply',
      })
      .toBe(fixture.rootId);

    const routeSamples = await page.evaluate(() => {
      const probe = (window as typeof window & {
        __cinny067ThreadRouteProbe?: { samples: Array<string | null>; timer: number };
      }).__cinny067ThreadRouteProbe;

      if (!probe) return [];

      window.clearInterval(probe.timer);
      return probe.samples;
    });

    expect(routeSamples.length).toBeGreaterThan(0);
    expect(routeSamples.every((threadId) => threadId === fixture.rootId)).toBe(true);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-send-stability');
  });
});
