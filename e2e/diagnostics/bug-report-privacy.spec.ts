import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  matrixFetch,
  seedRoomOverviewState,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { leaveCompactView } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// "Report a bug" on a message of an end-to-end encrypted room, against the slot's homeserver.
// The report room is unencrypted (bug report agents read it without E2EE), so the menu entry
// first shows what the report contains and uploads nothing until the person sends it. In an
// encrypted room the report leaves out message text unless the person includes it, after a
// warning. Checked by the uploads the browser makes and the files the server keeps: Chromium at
// desktop size, WebKit on a phone.
// Set BUG_REPORT_PRIVACY_SHOTS=<directory> to save the dialog on each engine.
const PASSWORD = 'bug-report-privacy-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.BUG_REPORT_PRIVACY_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

type UploadedReport = {
  messageTextOmitted?: boolean;
  target: { eventId: string };
  events: Array<{ eventId: string | null; event: { content: Record<string, unknown> } }>;
};

const register = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`brp_${name}_${RUN}`, PASSWORD);

const isUpload = (request: Request) =>
  request.method() === 'POST' &&
  /\/_matrix\/(?:media\/v3|client\/v1\/media)\/upload/.test(request.url());

const openRoom = async (page: Page, roomId: string, userId: string) => {
  await seedRoomOverviewState({
    page,
    roomId,
    userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await leaveCompactView(page);
};

/** The report the app opened after sending: its thread's attached file, as the server keeps it. */
const uploadedReport = async (page: Page, reporter: MatrixSession): Promise<UploadedReport> => {
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), { timeout: 30_000 })
    .not.toBeNull();
  const threadId = new URL(page.url()).searchParams.get('threadId')!;
  const { room_id: reportRoomId } = await matrixFetch<{ room_id: string }>(
    HOMESERVER,
    `/user/${encodeURIComponent(reporter.userId)}/account_data/io.mindroom.bug_reports`,
    { accessToken: reporter.accessToken }
  );
  const { chunk } = await matrixFetch<{
    chunk: Array<{ content: { msgtype?: string; url?: string } }>;
  }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(reportRoomId)}/relations/${encodeURIComponent(threadId)}/m.thread`,
    { accessToken: reporter.accessToken, apiVersion: 'v1' }
  );
  const file = chunk.find((event) => event.content.msgtype === 'm.file');
  expect(file?.content.url, 'the report thread has its file').toMatch(/^mxc:\/\//);
  return matrixFetch<UploadedReport>(
    HOMESERVER,
    `/media/download/${file!.content.url!.slice('mxc://'.length)}`,
    { accessToken: reporter.accessToken, apiVersion: 'v1' }
  );
};

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  engine: string,
  baseURL?: string
) => {
  const reporter = await register(`reporter_${engine}`);
  const admin = await register(`admin_${engine}`);
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: reporter.accessToken,
    body: JSON.stringify({
      name: 'Harbor Survey',
      preset: 'private_chat',
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    }),
  });

  const context = await browser.newContext({ ...options, baseURL });
  // The client reads the report admins from its server name's well-known, which the stack lacks.
  // WebKit sends requests for `*.localhost` names straight to the loopback interface, past
  // Playwright's routing, so the page's fetch answers that one request itself.
  await context.addInitScript(
    ({ url, body }) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return target === url
          ? Promise.resolve(
              new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
            )
          : original(input, init);
      };
    },
    {
      url: `https://${reporter.userId.split(':')[1]}/.well-known/matrix/client`,
      body: JSON.stringify({
        'm.homeserver': { base_url: HOMESERVER },
        'io.mindroom.bug_reports': { admins: [admin.userId] },
      }),
    }
  );
  const uploads: Request[] = [];
  context.on('request', (request) => {
    if (isUpload(request)) uploads.push(request);
  });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reporter.username,
      password: PASSWORD,
    });
    await openRoom(page, roomId, reporter.userId);

    const secret = `Tide gauge reading ${RUN} stays private`;
    await page.locator('[data-editable-name="RoomInput"]').click();
    await page.keyboard.type(secret);
    await page.keyboard.press('Enter');
    const row = page.locator('[data-message-id^="$"]').filter({ hasText: secret }).last();
    await expect(row).toBeVisible({ timeout: 30_000 });
    const eventId = (await row.getAttribute('data-message-id'))!;

    const dialog = page.getByRole('dialog', { name: 'Send a bug report?' });
    const includeText = dialog.getByRole('checkbox', { name: 'Include message text' });
    const startReport = async () => {
      await row.getByText(secret).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Report a bug', exact: true }).click();
      await expect(dialog, `${engine}: the report asks first`).toBeVisible();
    };

    // The dialog says what the report holds and who reads it; nothing is uploaded yet.
    await startReport();
    await expect(dialog.getByText('This message and up to 50 messages before it')).toBeVisible();
    await expect(dialog.getByText(/not end-to-end encrypted/)).toBeVisible();
    await expect(
      dialog.getByText(/Message text from this encrypted room is left out/)
    ).toBeVisible();
    await expect(includeText).not.toBeChecked();
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({ path: `${SHOTS}/bug-report-dialog-${engine}-${scheme}.png` });
      }
      await page.emulateMedia({ colorScheme: null });
    }
    await page.waitForTimeout(500);
    expect(uploads, `${engine}: nothing uploaded while the dialog is open`).toEqual([]);

    // Cancel closes the dialog and the menu, sends nothing and makes no report room.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Report a bug', exact: true })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(uploads, `${engine}: nothing uploaded after Cancel`).toEqual([]);
    await expect(
      matrixFetch(
        HOMESERVER,
        `/user/${encodeURIComponent(reporter.userId)}/account_data/io.mindroom.bug_reports`,
        { accessToken: reporter.accessToken }
      )
    ).rejects.toThrow(/404/);

    // Sent as it is, the report carries the message without its text.
    await startReport();
    await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
    await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(1);
    const omitted = await uploadedReport(page, reporter);
    expect(JSON.stringify(omitted), `${engine}: the upload leaves the text out`).not.toContain(
      secret
    );
    expect(omitted.messageTextOmitted).toBe(true);
    expect(omitted.target.eventId).toBe(eventId);
    const reported = omitted.events.find((item) => item.eventId === eventId);
    expect(reported?.event.content).toEqual({ msgtype: 'm.text' });

    // Including the text takes a deliberate choice, with a warning.
    await openRoom(page, roomId, reporter.userId);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startReport();
    await includeText.check();
    await expect(dialog.getByRole('alert')).toContainText('stored unencrypted');
    await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
    await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(2);
    const withText = await uploadedReport(page, reporter);
    expect(withText.messageTextOmitted).toBeUndefined();
    expect(withText.events.find((item) => item.eventId === eventId)?.event.content.body).toBe(
      secret
    );
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);
});

test('a bug report from an encrypted room says what it sends and leaves the text out (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await check(browser, DESKTOP, 'chromium', baseURL);
});

test('a bug report from an encrypted room says what it sends and leaves the text out (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const webkit = await launchWebKit();
  try {
    await check(webkit, PHONE, 'webkit', baseURL);
  } finally {
    await webkit.close();
  }
});
