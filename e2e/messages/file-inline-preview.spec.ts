import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createRoom } from '../helpers/createRoom';
import { seedSettings } from '../helpers/designChoices';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

const SHOTS = process.env.FILE_INLINE_PREVIEW_SHOTS;
const ROOM_NAME = 'Queue Lab';
const PASSWORD = 'file-inline-preview-spec-password';
const VIEWPORT = { width: 1280, height: 900 };
const DIFF = {
  name: 'retry-policy.diff',
  mimeType: 'application/octet-stream',
  source: [
    '--- a/retry_policy.py',
    '+++ b/retry_policy.py',
    '@@ -1,3 +1,3 @@',
    '-MAX_ATTEMPTS = 2',
    '+MAX_ATTEMPTS = 4',
    ' BACKOFF_SECONDS = 0.5',
    ' JITTER_SECONDS = 0.2',
    '',
  ].join('\n'),
};
const PYTHON = {
  name: 'worker_pool.py',
  mimeType: 'text/x-python',
  source: [
    'from collections import deque',
    '',
    'def next_job(queue: deque) -> str | None:',
    '    return queue.popleft() if queue else None',
    '',
  ].join('\n'),
};
const LOG_START = 'INFO queue monitor started';
const LOG_END = 'INFO queue monitor stopped';
const LOG = {
  name: 'queue-monitor.log',
  mimeType: 'text/plain',
  source: `${LOG_START}\n${'INFO worker pool idle; no work to retry\n'.repeat(6_000)}${LOG_END}\n`,
};

type FileFixture = { name: string; mimeType: string; source: string };

const sendFile = async (
  writer: MatrixSession,
  roomId: string,
  { name, mimeType, source }: FileFixture
) => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writer.accessToken}`, 'Content-Type': mimeType },
    body: source,
  });
  expect(response.ok, `uploading ${name}`).toBe(true);
  const { content_uri: url } = (await response.json()) as { content_uri: string };
  const eventId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.file',
    body: name,
    url,
    info: { mimetype: mimeType, size: Buffer.byteLength(source) },
  });
  return { eventId, mediaId: url.slice(url.lastIndexOf('/') + 1) };
};

const row = (page: Page, eventId: string) => page.locator(`[data-message-id="${eventId}"]`).first();
const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
const code = (scope: Locator) => scope.locator('pre code');
const actions = (scope: Locator) => scope.locator('[data-code-block-actions]');

const capturePreviews = async (
  page: Page,
  diffRow: Locator,
  pythonRow: Locator,
  logRow: Locator
) => {
  const directory = SHOTS;
  if (!directory) return;
  const rows = diffRow.or(pythonRow).or(logRow);
  const framePreviews = () =>
    rows.evaluateAll((elements) => {
      let timeline = elements[0]?.closest('[data-timeline-rows]')?.parentElement;
      while (timeline && !/auto|scroll|overlay/.test(getComputedStyle(timeline).overflowY)) {
        timeline = timeline.parentElement;
      }
      if (!timeline || elements.length !== 3) return null;
      const style = getComputedStyle(timeline);
      const rect = timeline.getBoundingClientRect();
      const topInset = Number.parseFloat(style.scrollPaddingTop) || 0;
      const bottomInset = Number.parseFloat(style.scrollPaddingBottom) || 0;
      const visibleTop = Math.max(0, Math.ceil(rect.top + topInset));
      const visibleBottom = Math.min(innerHeight, Math.floor(rect.bottom - bottomInset));
      const boxes = elements.map((element) => element.getBoundingClientRect());
      if (boxes.some((box) => box.width === 0 || box.height === 0)) return null;
      const top = Math.min(...boxes.map((box) => box.top));
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      if (top < visibleTop || bottom > visibleBottom) {
        timeline.scrollBy({
          top: top < visibleTop ? Math.floor(top - visibleTop) : Math.ceil(bottom - visibleBottom),
          behavior: 'instant',
        });
        return null;
      }
      const padding = 16;
      const x = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.left))) - padding);
      const y = Math.max(visibleTop, Math.floor(top) - padding);
      const right = Math.min(
        innerWidth,
        Math.ceil(Math.max(...boxes.map((box) => box.right))) + padding
      );
      const end = Math.min(visibleBottom, Math.ceil(bottom) + padding);
      return { x, y, width: right - x, height: end - y };
    });

  await page.mouse.move(0, 0);
  const capture = async (colorScheme: 'dark' | 'light') => {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme-kind', colorScheme);
    await expect(page.locator('[data-message-toolbar]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    let clip: Awaited<ReturnType<typeof framePreviews>> | undefined;
    await expect
      .poll(
        async () => {
          clip = await framePreviews();
          return clip;
        },
        { message: 'all three attachment rows fit between the timeline header and composer' }
      )
      .not.toBeNull();
    if (!clip) throw new Error('Missing attachment row framing for screenshot');
    await page.screenshot({
      path: `${directory}/file-inline-preview-${colorScheme}.png`,
      clip,
      animations: 'disabled',
    });
  };
  await capture('dark');
  await capture('light');
};

test.use({ viewport: VIEWPORT });

test('small file previews open inline and a large log waits for Preview', async ({
  page,
  context,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(120_000);
  const run = randomUUID();
  const reader = await registerDisposableUser(`preview_reader_${run}`, PASSWORD);
  const writer = await registerDisposableUser(`preview_writer_${run}`, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(writer.userId)}/displayname`, {
    method: 'PUT',
    accessToken: writer.accessToken,
    body: JSON.stringify({ displayname: 'Avery Park' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const diff = await sendFile(writer, roomId, DIFF);
  const python = await sendFile(writer, roomId, PYTHON);
  const log = await sendFile(writer, roomId, LOG);

  const diagnostics = attachBrowserDiagnostics(page);
  const downloads: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const { pathname } = new URL(request.url());
    const mediaId = /\/_matrix\/(?:client\/v1\/media|media\/v3)\/download\/[^/]+\/([^/]+)/.exec(
      pathname
    )?.[1];
    if (mediaId) downloads.push(mediaId);
  });
  const countDownloads = ({ mediaId }: { mediaId: string }) =>
    downloads.filter((downloaded) => downloaded === mediaId).length;

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSettings(page, {
    mediaAutoLoad: true,
    useSystemTheme: true,
    lightThemeId: 'light-theme',
    darkThemeId: 'dark-theme',
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'threaded' });
  await page.evaluate(
    (path) => {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    `/home/${encodeURIComponent(roomId)}/`
  );

  const diffRow = row(page, diff.eventId);
  const pythonRow = row(page, python.eventId);
  const logRow = row(page, log.eventId);
  const diffCode = code(diffRow);
  const pythonCode = code(pythonRow);
  await expect(diffCode).toBeVisible({ timeout: 30_000 });
  await expect(pythonCode).toBeVisible();
  expect(await diffCode.textContent()).toBe(DIFF.source);
  expect(await pythonCode.textContent()).toBe(PYTHON.source);
  await expect(pythonCode.locator('.token.keyword').first()).toBeVisible();

  // Additions and removals are separate lines with distinct treatments, not a plain text block.
  const removed = diffCode.getByText('-MAX_ATTEMPTS = 2', { exact: true });
  const added = diffCode.getByText('+MAX_ATTEMPTS = 4', { exact: true });
  await expect(removed).toBeVisible();
  await expect(added).toBeVisible();
  await expect(removed).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(added).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const removalColor = await removed.evaluate((line) => getComputedStyle(line).backgroundColor);
  await expect(added).not.toHaveCSS('background-color', removalColor);

  const logToggle = button(logRow, 'Preview');
  const logSize = `${(Buffer.byteLength(LOG.source) / 1000).toFixed(1)} KB`;
  await expect(logRow.getByText(LOG.name, { exact: true })).toBeVisible();
  await expect(logRow.getByText(logSize)).toBeVisible();
  await expect(logToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(code(logRow)).toHaveCount(0);
  await capturePreviews(page, diffRow, pythonRow, logRow);
  expect([countDownloads(diff), countDownloads(python), countDownloads(log)]).toEqual([1, 1, 0]);

  await expect(button(diffRow, `Open ${DIFF.name}`)).toBeEnabled();
  await expect(button(diffRow, `Download ${DIFF.name}`)).toBeEnabled();
  const toolbar = actions(diffRow);
  const wrap = button(toolbar, 'Wrap lines');
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();

  await button(toolbar, 'Copy code').click();
  await expect(button(toolbar, 'Copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(DIFF.source);

  const lastDiffLine = diffCode.getByText('JITTER_SECONDS = 0.2', { exact: true });
  await expect(lastDiffLine).not.toBeInViewport();
  await button(toolbar, 'Expand').click();
  await expect(lastDiffLine).toBeInViewport();
  await button(toolbar, 'Collapse').click();
  await expect(lastDiffLine).not.toBeInViewport();

  await button(diffRow, 'Hide preview').click();
  await expect(diffCode).toHaveCount(0);
  await expect(button(diffRow, 'Preview')).toHaveAttribute('aria-expanded', 'false');
  await button(diffRow, 'Preview').click();
  await expect(button(diffRow, 'Hide preview')).toHaveAttribute('aria-expanded', 'true');
  await expect(diffCode).toHaveText(DIFF.source);
  await button(diffRow, `Open ${DIFF.name}`).click();
  const viewer = page.getByRole('dialog', { name: DIFF.name, exact: true });
  await expect(viewer).toBeVisible();
  await expect(code(viewer)).toHaveText(DIFF.source);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(diffCode).toBeVisible();

  expect(countDownloads(log)).toBe(0);
  await logToggle.click();
  await expect(code(logRow)).toContainText(LOG_START);
  await expect(code(logRow)).toContainText(LOG_END);
  await button(logRow, 'Hide preview').click();
  await expect(code(logRow)).toHaveCount(0);
  expect([countDownloads(diff), countDownloads(python), countDownloads(log)]).toEqual([1, 1, 1]);
  expect(diagnostics.pageErrors).toEqual([]);
  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'inline file previews');
});
