import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page, type Request } from '@playwright/test';
import { getStoredSessionByUsername } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Error reports against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh): a forced error in a room with private data must reach the collector with
// the release, route template, browser and viewport, and none of the data. Reports go as envelopes
// through the tunnel on the app's own origin (`errorReporting.tunnel`), whose server forwards them
// to the collector; this spec plays that server and forwards to a stand-in collector of its own.
// Set E2E_ERROR_REPORTING_DSN to a real collector (GlitchTip) to forward there instead, then read
// the stored events by the IDs this spec attaches.
const REAL_DSN = process.env.E2E_ERROR_REPORTING_DSN;
const MADE_UP_DSN = 'https://e2ekey@errors.e2e.invalid/1';
const DSN = REAL_DSN ?? MADE_UP_DSN;
const COLLECTOR = new URL(DSN).host;
const TUNNEL = '/errors/envelope';
const ENVIRONMENT = 'e2e';

type Report = {
  event_id: string;
  release?: string;
  environment?: string;
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
  breadcrumbs?: { values: { category: string; data?: Record<string, unknown> }[] };
};

type Sent = { url: string; auth: string; body: string };

/** A DSN's public key, project ID, and the collector's address its endpoints start with. */
const dsnParts = (dsn: string) => {
  const url = new URL(dsn);
  const path = url.pathname.replace(/\/+$/, '');
  return {
    key: url.username,
    project: path.slice(path.lastIndexOf('/') + 1),
    base: `${url.protocol}//${url.host}${path.slice(0, path.lastIndexOf('/'))}`,
  };
};

/** An envelope's header, item header and event, one per line. */
const parseEnvelope = (body: string) => {
  const [header = '', item = '', event = '', end] = body.split('\n');
  expect(end, 'the envelope ends with a newline').toBe('');
  return {
    header: JSON.parse(header) as { event_id?: string; dsn?: string },
    item: JSON.parse(item) as { type?: string },
    event: JSON.parse(event) as Report,
  };
};

/** Records the reports the page posts: to the tunnel, or to a collector's host. */
const watchReports = (page: Page, collector: string): (Sent & { request: Request })[] => {
  const sent: (Sent & { request: Request })[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'POST' || (url.pathname !== TUNNEL && url.host !== collector)) return;
    sent.push({
      url: request.url(),
      auth: request.headers()['x-sentry-auth'] ?? '',
      body: request.postData() ?? '',
      request,
    });
  });
  return sent;
};

/**
 * A stand-in collector: it takes envelopes for the DSN's project with the DSN's key in the
 * `X-Sentry-Auth` header, as GlitchTip does, and keeps what it got.
 */
const startCollector = async (dsn: string) => {
  const { key, project } = dsnParts(dsn);
  const received: Sent[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const auth = request.headers['x-sentry-auth'];
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ url: request.url ?? '', auth: String(auth ?? ''), body });
      const accepted =
        request.method === 'POST' &&
        request.url === `/api/${project}/envelope/` &&
        typeof auth === 'string' &&
        auth.split(/,\s*/).includes(`sentry_key=${key}`);
      response.writeHead(accepted ? 200 : 403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(accepted ? { id: 'stored' } : { detail: 'Denied' }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

/**
 * Plays the deployment's tunnel server: POST only, at most 64 KiB, and only the body, its type and
 * the auth header go on, to the envelope endpoint of the one project the DSN names at `upstream`.
 */
const serveTunnel = async (page: Page, upstream: string, dsn: string) => {
  const { project } = dsnParts(dsn);
  await page.context().route(`**${TUNNEL}`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fulfill({ status: 405 });
    if ((request.postDataBuffer()?.length ?? 0) > 64 * 1024) return route.fulfill({ status: 413 });
    const headers: Record<string, string> = {};
    ['content-type', 'x-sentry-auth'].forEach((name) => {
      const value = request.headers()[name];
      if (value) headers[name] = value;
    });
    const response = await route.fetch({ url: `${upstream}/api/${project}/envelope/`, headers });
    return route.fulfill({ response });
  });
};

/** Serves the slot's config.json with `errorReporting` added, or as it is without one. */
const configure = async (page: Page, errorReporting: Record<string, string> | undefined) => {
  await page.context().route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: { ...config, ...(errorReporting ? { errorReporting } : {}) },
    });
  });
};

const forceError = (page: Page, message: string) =>
  page.evaluate((text) => {
    window.setTimeout(() => {
      throw new Error(text);
    });
  }, message);

test('reports a forced error through the tunnel without private data, and stops when switched off', async ({
  page,
}, testInfo) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
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

  const { key, project, base } = dsnParts(DSN);
  const collector = REAL_DSN ? undefined : await startCollector(DSN);
  const sent = watchReports(page, COLLECTOR);
  await serveTunnel(page, collector?.origin ?? base, DSN);
  await configure(page, { dsn: DSN, tunnel: TUNNEL, environment: ENVIRONMENT });
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
  const reports = sent.map((request) => parseEnvelope(request.body).event);
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
  const origin = new URL(page.url()).origin;
  sent.forEach((request) => {
    forbidden.forEach((value) => expect(request.body, value).not.toContain(value));
    // The app's own origin and no query: nothing a privacy list matches, the key in a header.
    expect(request.url).toBe(`${origin}${TUNNEL}`);
    expect(request.auth).toBe(
      `Sentry sentry_version=7, sentry_key=${key}, sentry_client=mindroom-client.reporter/1`
    );
    const { header, item, event } = parseEnvelope(request.body);
    expect(header).toMatchObject({ event_id: event.event_id, dsn: DSN });
    expect(item).toEqual({ type: 'event' });
    expect(event.environment).toBe(ENVIRONMENT);
  });
  // The collector took every envelope the tunnel passed on, unchanged, at the project's endpoint.
  const statuses = await Promise.all(
    sent.map(async (request) => (await request.request.response())?.status())
  );
  expect(statuses.every((status) => status === 200)).toBe(true);
  if (collector) {
    await expect.poll(() => collector.received.length).toBe(sent.length);
    collector.received.forEach((request) => {
      expect(request.url).toBe(`/api/${project}/envelope/`);
      expect(request.auth).toContain(`sentry_key=${key}`);
    });
    expect(collector.received.map((request) => request.body).sort()).toEqual(
      sent.map((request) => request.body).sort()
    );
    await collector.close();
  }

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

test('posts to the collector with the key in a header only, and counts reports that do not arrive', async ({
  page,
}) => {
  const collector = new URL(MADE_UP_DSN).host;
  const { key, project } = dsnParts(MADE_UP_DSN);
  const sent = watchReports(page, collector);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('[error-reports]')) {
      warnings.push(message.text());
    }
  });
  let posts = 0;
  await page.context().route(`https://${collector}/**`, (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, x-sentry-auth',
      'Access-Control-Allow-Methods': 'POST',
    };
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors });
    posts += 1;
    // The first report meets a privacy extension; the next one gets through.
    if (posts === 1) return route.abort('blockedbyclient');
    return route.fulfill({ status: 200, headers: cors, json: { id: 'stored' } });
  });
  await configure(page, { dsn: MADE_UP_DSN });
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER);
  await forceError(page, 'Forced test error that an extension blocks');
  await expect.poll(() => warnings.length).toBe(1);
  await forceError(page, 'Forced test error that arrives');
  await expect
    .poll(() => sent.filter((request) => request.body.includes('Forced test error')).length)
    .toBe(2);

  sent.forEach((request) => {
    expect(request.url).toBe(`https://${collector}/api/${project}/envelope/`);
    expect(request.auth).toContain(`sentry_key=${key}`);
  });
  const arrived = sent.find((request) => request.body.includes('Forced test error that arrives'));
  const { event } = parseEnvelope(arrived?.body ?? '');
  expect(event.environment).toBe(new URL(page.url()).hostname);
  expect(event.breadcrumbs?.values).toContainEqual(
    expect.objectContaining({ category: 'report', data: { state: 'failed', count: 1 } })
  );
  expect(warnings).toHaveLength(1);
});

test('loads no reporter and sends nothing without a DSN', async ({ page }) => {
  const sent = watchReports(page, COLLECTOR);
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
