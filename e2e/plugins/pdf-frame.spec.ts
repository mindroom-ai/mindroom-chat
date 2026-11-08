import { expect, test, type Page } from '@playwright/test';

// The app's PDF frame page (public/pdf-frame.html), at the URL the client SDK's `pdfFrameUrl` gives
// a plugin for an object URL, shows the object URL's bytes as a PDF in the browser's viewer,
// whatever type its blob carries: an HTML document typed `text/html` runs none of its script. A
// frame moved to another object URL, which changes only the part after `#`, shows the new one. The
// spec loads the function, which the SDK exports as the app's own (src/client-sdk/ui.test.tsx),
// from the dev server into the app's page (scripts/e2e-suite.sh runs specs that import /src/ on the
// dev server). The example plugin's card shows a PDF through the same frame page
// (e2e/plugins/ui.spec.ts).
const PDF_FRAME_MODULE = '/src/app/messages/viewers/pdfFrame.ts';
const MARK = 'pdf-frame-spec-ran';

/**
 * Points the frame `#pdf-frame-spec`, made at first, at `pdfFrameUrl` of an object URL of `content`
 * typed `type`.
 */
const frameBlob = (page: Page, content: string, type: string) =>
  page.evaluate(
    async ({ path, text, blobType }) => {
      const { pdfFrameUrl } = (await import(
        path
      )) as typeof import('../../src/app/messages/viewers/pdfFrame');
      const objectUrl = URL.createObjectURL(new Blob([text], { type: blobType }));
      let frame = document.querySelector<HTMLIFrameElement>('#pdf-frame-spec');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'pdf-frame-spec';
        document.body.append(frame);
      }
      frame.src = pdfFrameUrl(objectUrl) ?? 'about:blank';
    },
    { path: PDF_FRAME_MODULE, text: content, blobType: type }
  );

test('the PDF frame page shows an object URL as a PDF, whatever type its blob carries', async ({
  page,
}) => {
  await page.goto('/');
  await frameBlob(page, `<script>localStorage.setItem('${MARK}', 'yes')</script>`, 'text/html');

  // The browser's PDF viewer takes the bytes, in a frame of its own.
  await expect
    .poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-extension://')))
    .toBe(true);
  expect(await page.evaluate((mark) => localStorage.getItem(mark), MARK)).toBeNull();
});

/** The bytes the frame page hands the browser's viewer, once it does. */
const viewerBytes = (page: Page) =>
  page.evaluate(async () => {
    const frame = document.querySelector<HTMLIFrameElement>('#pdf-frame-spec');
    const embed = frame?.contentDocument?.querySelector('embed');
    if (!embed) return undefined;
    // A page on its way out takes its object URLs with it.
    return fetch(embed.src).then(
      (response) => response.text(),
      () => undefined
    );
  });

test("the PDF frame page shows the object URL its frame's URL names now, after the frame's URL changes", async ({
  page,
}) => {
  await page.goto('/');
  // A plugin's `<iframe src={pdfFrameUrl(url)}>` whose `url` changes: only the part after `#` does.
  await frameBlob(page, '%PDF first', 'application/pdf');
  await expect.poll(() => viewerBytes(page)).toBe('%PDF first');
  await frameBlob(page, '%PDF second', 'application/pdf');
  await expect.poll(() => viewerBytes(page)).toBe('%PDF second');
});
