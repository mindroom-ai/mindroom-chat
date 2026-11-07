import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { addRoomToSpace, createPrivateSpace, loginToMatrix } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'drawer-probe-password';

const register = async (name: string) => {
  const username = `drawerprobe_${name}_${Date.now().toString(36)}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' }, inhibit_login: true }),
  });
  expect(response.ok).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const go = (page: Page, route: string, keyed: boolean) =>
  page.evaluate(
    ([path, withKey]) => {
      const state = withKey ? { usr: null, key: Math.random().toString(36).slice(2, 10), idx: (window.history.state?.idx ?? 0) + 1 } : null;
      window.history.pushState(state, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state }));
    },
    [route, keyed] as const
  );

const sample = (page: Page) =>
  page.evaluate(async () => {
    const seen: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const open = document.getElementById('phone-nav-drawer')?.hasAttribute('data-open');
      const value = `${open ? 'open' : 'closed'}`;
      if (seen[seen.length - 1] !== value) seen.push(value);
      await new Promise((r) => setTimeout(r, 50));
    }
    return { seen, state: JSON.stringify(window.history.state) };
  });

for (const engine of ['chromium', 'webkit'] as const) {
  for (const keyed of [false, true]) {
    test(`drawer after go (${engine}, keyed=${keyed})`, async ({ browser, baseURL }) => {
      test.setTimeout(240_000);
      const reader = await register(`r${engine}${keyed ? 'k' : 'n'}`);
      const spaceId = await createPrivateSpace(HOMESERVER, reader.accessToken, { name: 'Probe space', topic: 'x' });
      const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Probe room' });
      await addRoomToSpace(HOMESERVER, reader.accessToken, spaceId, roomId);
      const b = engine === 'webkit' ? await launchWebKit() : browser;
      const context = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL });
      const page = await context.newPage();
      await loginWithPassword(page, { homeserver: HOMESERVER, username: reader.username, password: PASSWORD });
      const results: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        await go(page, `/home/${encodeURIComponent(roomId)}/`, keyed);
        await page.waitForTimeout(500);
        await go(page, `/home/search/?term=probe&rooms=${encodeURIComponent(roomId)}`, keyed);
        await page.waitForTimeout(500);
        await go(page, '/home/', keyed);
        const home = await sample(page);
        await page.locator('button[aria-keyshortcuts]').first().click();
        const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
        await palette.getByRole('combobox').fill('Probe');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
        const afterPalette = await sample(page);
        await go(page, `/${encodeURIComponent(spaceId)}/lobby/`, keyed);
        const lobby = await sample(page);
        results.push(`round ${round}: home ${home.seen.join('>')} afterPalette ${afterPalette.seen.join('>')} lobby ${lobby.seen.join('>')} state ${lobby.state}`);
      }
      console.log(`PROBE ${engine} keyed=${keyed}\n${results.join('\n')}`);
      await context.close();
      if (engine === 'webkit') await b.close();
    });
  }
}
