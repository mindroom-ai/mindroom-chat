import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { getStoredSessionByUsername } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// Error reports against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh): a forced error in a room with private data must reach the collector with
// the release, route template, browser and viewport, and none of the data. The collector is made
// up and answered here; set E2E_ERROR_REPORTING_DSN to a real one (GlitchTip) to send the reports
// there instead, then read the stored events by the IDs this spec attaches.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const REAL_DSN = process.env.E2E_ERROR_REPORTING_DSN;
const DSN = REAL_DSN ?? 'https://e2ekey@errors.e2e.invalid/1';
const COLLECTOR = new URL(DSN).host;

type Report = {
  event_id: string;
  release?: string;
  message?: string;
  tags?: Record<string, string>;
  request?: { url?: string; headers?: Record<string, string> };
  exception?: {
    values: {
      type: string;
      value: string;
      stacktrace?: { frames: { filename?: string; function?: string; in_app?: boolean }[] };
    }[];
  };
};

type Sent = { url: string; body: string };

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

/** Records what the page sends to the collector, and answers it unless it is a real one. */
const watchCollector = async (page: Page): Promise<Sent[]> => {
  const sent: Sent[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).host === COLLECTOR) {
      sent.push({ url: request.url(), body: request.postData() ?? '' });
    }
  });
  if (!REAL_DSN) {
    await page.context().route(`https://${COLLECTOR}/**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { id: 'stored' },
      })
    );
  }
  return sent;
};

/** Serves the slot's config.json with `errorReporting` added, or as it is without a DSN. */
const configure = async (page: Page, dsn: string | undefined) => {
  await page.context().route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: { ...config, ...(dsn ? { errorReporting: { dsn } } : {}) },
    });
  });
};

const forceError = (page: Page, message: string) =>
  page.evaluate((text) => {
    window.setTimeout(() => {
      throw new Error(text);
    });
  }, message);

test('reports a forced error without private data, and stops when switched off', async ({
  page,
}, testInfo) => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const username = `reporter_${suffix}`;
  const password = randomUUID();
  const account = await matrixFetch<{ access_token: string; user_id: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    }
  );
  const displayName = `Alice Liddell ${suffix}`;
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(account.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: account.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  const roomName = `Project Falcon ${suffix}`;
  const topic = `Quarterly plans ${suffix}`;
  const roomId = await createPrivateRoom(HOMESERVER, account.access_token, {
    name: roomName,
    topic,
  });
  const body = `Meet me at the station at 5pm ${suffix}`;
  const eventId = await sendRoomMessage(HOMESERVER, account.access_token, roomId, {
    msgtype: 'm.text',
    body,
  });
  const fileName = `holiday-photo-${suffix}.jpg`;

  const sent = await watchCollector(page);
  await configure(page, DSN);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByText(body, { exact: true })).toBeVisible();

  // Failures that carry what reports must never hold, the way engines and code put data in
  // error messages: quoted text, Matrix IDs, a URL with the session's own access token, a file.
  // The helper's type leaves the stored token out; the store has it.
  const session = (await getStoredSessionByUsername(page, username)) as { accessToken?: string };
  const token = session.accessToken;
  expect(token, 'the access token of the session').toBeTruthy();
  const marker = `Forced test error ${suffix}`;
  await forceError(
    page,
    `${marker} in “${roomName}” by '${displayName}' for ${
      account.user_id
    } in ${roomId} at ${eventId}: "${body}" with ${fileName} from ${HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(
      roomId
    )}/messages?access_token=${token ?? ''}`
  );
  await page.evaluate(
    ({ text, secret }) => {
      void Promise.reject(new TypeError(`${text} rejected with Authorization: Bearer ${secret}`));
    },
    { text: marker, secret: token ?? '' }
  );

  // And one from code with a script address of this origin, as the app's own files have.
  await page.evaluate((text) => {
    const source = `window.setTimeout(function forcedFrame() { throw new Error(${JSON.stringify(
      text
    )}); });\n//# sourceURL=${window.location.origin}/assets/forced-error.js`;
    // eslint-disable-next-line no-eval
    (0, eval)(source);
  }, `${marker} from app code`);

  await expect
    .poll(() => sent.filter((request) => request.body.includes(marker)).length, {
      timeout: 15_000,
    })
    .toBe(3);
  const reports = sent.map((request) => JSON.parse(request.body) as Report);
  await testInfo.attach('reports.json', {
    body: JSON.stringify(reports, null, 2),
    contentType: 'application/json',
  });

  const forbidden = [
    roomName,
    'Falcon',
    topic,
    'Quarterly',
    displayName,
    'Liddell',
    body,
    'station',
    fileName,
    'holiday',
    account.user_id,
    username,
    roomId,
    encodeURIComponent(roomId),
    eventId,
    encodeURIComponent(eventId),
    token ?? '',
    account.access_token,
    'access_token',
  ];
  sent.forEach((request) => {
    forbidden.forEach((value) => expect(request.body, value).not.toContain(value));
    expect(request.url).toMatch(
      new RegExp(`^https://${COLLECTOR}/api/\\d+/store/\\?sentry_key=\\w+&sentry_version=7$`)
    );
  });

  const version = (await (await page.request.get('/version.json')).json()) as { version: string };
  const forced = reports.find((report) => report.exception?.values[0]?.value.startsWith(marker));
  expect(forced?.release).toBe(version.version);
  expect(forced?.tags).toMatchObject({
    route: '/home/:roomIdOrAlias/:eventId?/',
    source: 'onerror',
    viewport: '1280x800',
  });
  expect(forced?.request?.headers?.['User-Agent']).toContain('Chrome');
  expect(forced?.exception?.values[0]?.value).toContain('"<text>"');
  expect(forced?.exception?.values[0]?.value).toContain('<room-id>');
  const fromApp = reports.find(
    (report) => report.exception?.values[0]?.value === `${marker} from app code`
  );
  const origin = new URL(page.url()).origin;
  expect(fromApp?.exception?.values[0]?.stacktrace?.frames).toContainEqual(
    expect.objectContaining({
      filename: `${origin}/assets/forced-error.js`,
      function: 'forcedFrame',
      in_app: true,
    })
  );

  // Settings > About turns reports off on this device, at once.
  await chooseFromAccountMenu(page, 'Settings');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Send error reports' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(`Reports go to ${COLLECTOR}.`)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const before = sent.length;
  await forceError(page, `${marker} while switched off`);
  await page.waitForTimeout(1_500);
  expect(sent.length).toBe(before);
});

test('loads no reporter and sends nothing without a DSN', async ({ page }) => {
  const sent = await watchCollector(page);
  const chunks: string[] = [];
  page.on('request', (request) => {
    if (/reporter[-.][\w-]*\.(?:js|ts)/.test(request.url())) chunks.push(request.url());
  });
  await configure(page, undefined);
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER);
  await forceError(page, 'Forced test error without a DSN');
  await page.waitForTimeout(1_500);
  expect(sent).toEqual([]);
  expect(chunks).toEqual([]);
});
