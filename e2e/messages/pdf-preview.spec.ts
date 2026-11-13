import { expect, test, type Browser, type Frame, type Locator, type Page } from '@playwright/test';
import playwrightConfig from '../../playwright.config';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A PDF attachment opens in the browser's own viewer, inside the app's glass modal. Chromium runs
// everything inside an element with a backdrop filter through that filter once the element holds a
// frame drawn by another process, as the PDF viewer is, so the modal's glass must not sit on an
// ancestor of the frame. Checked at 1x and at a real 2x screen, against the homeserver of
// `just hs-up`: no ancestor of the page or the toolbar filters, the viewer's canvases have a pixel
// per device pixel, and the page text and the toolbar title come out with hard edges.
const PASSWORD = 'pdf-preview-password';
const FILE_NAME = 'field-notes.pdf';

const matrix = async <T>(path: string, init: { token?: string; body?: unknown } = {}) => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

/** A PDF of text pages in the standard Helvetica font, with a correct cross-reference table. */
const textPdf = (pages: string[][]): Buffer => {
  const objects = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, page) => `${4 + page * 2} 0 R`).join(' ')}] /Count ${
      pages.length
    } >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((lines, page) => {
    const text = lines
      .map(
        (line, row) => `BT /F1 ${row === 0 ? 20 : 11} Tf 56 ${740 - row * 18} Td (${line}) Tj ET`
      )
      .join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${
        5 + page * 2
      } 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
    );
  });
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, id) => {
    if (id === 0) return 0;
    const offset = pdf.length;
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const fieldNotes = () =>
  textPdf(
    [1, 2, 3].map((page) => [
      `Field notes, page ${page}`,
      ...Array.from(
        { length: 30 },
        (_, line) => `Line ${line + 1}: The quick brown fox jumps over the lazy dog.`
      ),
    ])
  );

/** Signs a new person in, in a room of their own in the Full view, with the PDF sent there. */
const sendPdf = async (
  browser: Browser,
  { deviceScaleFactor = 1 }: { deviceScaleFactor?: number } = {}
): Promise<Page> => {
  const username = `reader_${Date.now().toString(36)}`;
  const { access_token: token } = await matrix<{ access_token: string }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token,
    body: { name: 'Reading Room', preset: 'private_chat' },
  });
  await matrix('/logout', { token, body: {} });

  const context = await browser.newContext({
    baseURL: playwrightConfig.use?.baseURL,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: `@${username}:matrix.localhost`,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (
    await chooser
  ).setFiles([{ name: FILE_NAME, mimeType: 'application/pdf', buffer: fieldNotes() }]);
  await expect(page.getByText(FILE_NAME, { exact: true }).first()).toBeVisible();
  await page.locator('[data-editable-name="RoomInput"]').click();
  await page.keyboard.press('Enter');
  return page;
};

/** Every element from the given one up to its document's root that filters or blurs. */
const filteringAncestors = (element: Element | null) => {
  const found: string[] = [];
  for (let node = element; node; node = node.parentElement) {
    const css = getComputedStyle(node);
    if (css.filter !== 'none' || css.backdropFilter !== 'none') {
      found.push(`${node.tagName}.${node.className}: ${css.filter} / ${css.backdropFilter}`);
    }
  }
  return found;
};

/** Canvases whose backing store has fewer pixels than their box has device pixels. */
const coarseCanvases = (frame: Frame, devicePixelRatio: number) =>
  frame.locator('canvas').evaluateAll(
    (canvases, ratio) =>
      canvases.flatMap((element) => {
        const canvas = element as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        const enough =
          canvas.width >= Math.floor(box.width * ratio) &&
          canvas.height >= Math.floor(box.height * ratio);
        return box.width === 0 || enough
          ? []
          : [`${canvas.width}x${canvas.height} for ${box.width}x${box.height} CSS px`];
      }),
    devicePixelRatio
  );

/**
 * The 99.9th percentile of the luminance step between neighboring device pixels in a screenshot
 * of the area: about 220 for text at either scale, under 50 for text through the modal's blur.
 */
const edgeStrength = async (
  page: Page,
  area: Locator | { x: number; y: number; width: number; height: number }
) => {
  const png =
    'screenshot' in area ? await area.screenshot() : await page.screenshot({ clip: area });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const luminance = (index: number) => {
      const [red = 0, green = 0, blue = 0] = data.subarray(index, index + 3);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const steps: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        const index = (y * width + x) * 4;
        steps.push(Math.abs(luminance(index) - luminance(index - 4)));
      }
    }
    steps.sort((a, b) => b - a);
    return Math.round(steps[Math.floor(steps.length / 1000)] ?? 0);
  }, png.toString('base64'));
};

const expectSharpPreview = async (page: Page, scale: number) => {
  await page
    .getByRole('button', { name: `Open ${FILE_NAME}` })
    .last()
    .click({ timeout: 60_000 });
  const frameElement = page.locator(`iframe[title="${FILE_NAME}"]`);
  await expect(frameElement).toBeVisible();
  const toolbar = page.locator('header').filter({ hasText: FILE_NAME });
  const title = toolbar.getByText(FILE_NAME, { exact: true });
  await expect(title).toBeVisible();
  expect(await page.evaluate(() => devicePixelRatio)).toBe(scale);

  // The browser's viewer runs in a frame of its own inside the app's frame page.
  const holder = (await frameElement.elementHandle())!;
  const framePage = (await holder.contentFrame())!;
  await expect(framePage.locator('embed[type="application/pdf"]')).toBeAttached();
  await expect
    .poll(() => page.frames().find((frame) => frame.url().startsWith('chrome-extension://')))
    .toBeTruthy();
  const viewer = page.frames().find((frame) => frame.url().startsWith('chrome-extension://'))!;
  // The thumbnails are the viewer's canvases; the page itself is drawn by the plugin.
  await expect.poll(() => viewer.locator('canvas').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // The point at the middle of the page hits the frame, and nothing above it filters.
  const hit = await frameElement.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return (
      document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element
    );
  });
  expect(hit).toBe(true);
  expect(await frameElement.evaluate(filteringAncestors)).toEqual([]);
  expect(await title.evaluate(filteringAncestors)).toEqual([]);
  expect(await framePage.locator('embed').evaluate(filteringAncestors)).toEqual([]);

  for (const frame of [page.mainFrame(), framePage, viewer]) {
    expect(await coarseCanvases(frame, scale), frame.url()).toEqual([]);
  }

  // Page text: right of the thumbnails, below the viewer's own toolbar (1150 by 606 CSS px frame).
  const box = (await frameElement.boundingBox())!;
  const pageText = { x: box.x + 400, y: box.y + 140, width: 300, height: 260 };
  await expect.poll(() => edgeStrength(page, pageText), { timeout: 20_000 }).toBeGreaterThan(150);
  await expect.poll(() => edgeStrength(page, title)).toBeGreaterThan(150);
};

test('the PDF preview is sharp at 1x', async ({ browser }, testInfo) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);
  const page = await sendPdf(browser);
  await expectSharpPreview(page, 1);
  await page.screenshot({ path: testInfo.outputPath('pdf-preview-1x.png') });
});

test('the PDF preview is sharp on a 2x screen', async ({ playwright }, testInfo) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);
  // A real 2x screen: emulating the scale reaches the app's frames but not the viewer's own.
  const launchOptions = playwrightConfig.use?.launchOptions ?? {};
  const browser = await playwright.chromium.launch({
    ...launchOptions,
    args: [...(launchOptions.args ?? []), '--force-device-scale-factor=2'],
  });
  try {
    const page = await sendPdf(browser, { deviceScaleFactor: 2 });
    await expectSharpPreview(page, 2);
    await page.screenshot({ path: testInfo.outputPath('pdf-preview-2x.png') });
  } finally {
    await browser.close();
  }
});
