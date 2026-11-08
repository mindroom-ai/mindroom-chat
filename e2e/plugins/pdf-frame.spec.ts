import { expect, test, type Page } from '@playwright/test';

// The app's PDF frame page (public/pdf-frame.html), at the URL the client SDK's `pdfFrameUrl` gives
// a plugin for an object URL, shows the object URL's bytes as a PDF in the browser's viewer,
// whatever type its blob carries: an HTML document typed `text/html` runs none of its script. The
// spec loads the function, which the SDK exports as the app's own (src/client-sdk/ui.test.tsx),
// from the dev server into the app's page (scripts/e2e-suite.sh runs specs that import /src/ on the
// dev server). The example plugin's card shows a PDF through the same frame page
// (e2e/plugins/ui.spec.ts).
const PDF_FRAME_MODULE = '/src/app/messages/viewers/pdfFrame.ts';
const MARK = 'pdf-frame-spec-ran';

/** Frames an object URL of `html`, typed `text/html`, at the URL `pdfFrameUrl` gives for it. */
const frameHtml = (page: Page, html: string) =>
  page.evaluate(
    async ({ path, markup }) => {
      const { pdfFrameUrl } = (await import(
        path
      )) as typeof import('../../src/app/messages/viewers/pdfFrame');
      const objectUrl = URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
      const frame = document.createElement('iframe');
      frame.src = pdfFrameUrl(objectUrl) ?? 'about:blank';
      document.body.append(frame);
    },
    { path: PDF_FRAME_MODULE, markup: html }
  );

test('the PDF frame page shows an object URL as a PDF, whatever type its blob carries', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate((mark) => localStorage.removeItem(mark), MARK);
  await frameHtml(page, `<script>localStorage.setItem('${MARK}', 'yes')</script>`);

  // The browser's PDF viewer takes the bytes, in a frame of its own.
  await expect
    .poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-extension://')))
    .toBe(true);
  expect(await page.evaluate((mark) => localStorage.getItem(mark), MARK)).toBeNull();
});
