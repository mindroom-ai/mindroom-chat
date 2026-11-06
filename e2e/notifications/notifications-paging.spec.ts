import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';

// Inbox > Notifications pages through a long history 30 at a time: Load Older Messages goes away
// once the last page is in, and a page costs about the same at the end of the list as at its
// start, because the rows already shown do not render again. Checked against the slot's Tuwunel.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'notifications-paging-spec-password';
const RUN = Date.now().toString(36);
const MENTIONS = 500;
const PAGE = 30;

test.use({ viewport: { width: 1280, height: 800 } });

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const register = async (name: string) => {
  const username = `ntp_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('Load Older Messages ends with the last page, and late pages cost what early ones do', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const reader = await register('reader');
  const writer = await register('writer');
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Planning Desk',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  const send = async (index: number) =>
    sendRoomMessage(
      HOMESERVER,
      writer.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `${reader.userId} item ${index}: please check the shipping estimate and the review notes before the call`,
        'm.mentions': { user_ids: [reader.userId] },
      },
      `ntp-${index}`
    );
  for (let start = 0; start < MENTIONS; start += 10) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(Array.from({ length: 10 }, (_, offset) => send(start + offset)));
  }

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto('/inbox/notifications/');
  const rows = page.getByRole('button', { name: 'Open', exact: true });
  await expect(rows).toHaveCount(PAGE, { timeout: 20_000 });
  const loadOlder = page.getByRole('button', { name: 'Load Older Messages' });

  const clicks: { rows: number; ms: number }[] = [];
  for (let click = 1; click <= MENTIONS / PAGE + 2; click += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await loadOlder.isVisible())) break;
    // eslint-disable-next-line no-await-in-loop
    const before = await rows.count();
    // eslint-disable-next-line no-await-in-loop
    const ms = await page.evaluate(
      async ({ before: shown }) => {
        const button = [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === 'Load Older Messages'
        )!;
        const count = () =>
          [...document.querySelectorAll('button')].filter(
            (element) => element.textContent?.trim() === 'Open'
          ).length;
        const start = performance.now();
        button.click();
        // Until the next page is drawn, the list ends (the button goes), or 10 s pass.
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise(requestAnimationFrame);
          if (count() > shown) return performance.now() - start;
          if (!button.isConnected) return 0;
          if (performance.now() - start > 10_000) return -1;
        }
      },
      { before }
    );
    // eslint-disable-next-line no-await-in-loop
    clicks.push({ rows: await rows.count(), ms: Math.round(ms) });
  }
  // eslint-disable-next-line no-console
  console.log('PAGING', JSON.stringify(clicks));

  await expect(rows).toHaveCount(MENTIONS);
  await expect(loadOlder).toHaveCount(0);
  // The server may hand out a page token with the last page; the click after it ends the list.
  expect(clicks.every((click) => click.ms >= 0)).toBe(true);
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const early = median(clicks.slice(0, 3).map((click) => click.ms));
  const late = median(clicks.slice(-4, -1).map((click) => click.ms));
  expect(late).toBeLessThan(2 * early + 50);
});
