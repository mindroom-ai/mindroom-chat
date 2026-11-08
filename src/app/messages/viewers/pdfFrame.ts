import { appUrl } from '../../lib/basePath';

/**
 * The URL of the app's own frame page that shows the PDF at the object URL `src` in the browser's
 * viewer, or undefined for any URL but a `blob:` one, which the app shows no PDF from.
 */
// The app's frame-src policy (index.html) refuses blob: frames, so the PDF opens in the app's own
// frame page, which hands the object URL named after its # sign to the browser's viewer. That frame
// is not sandboxed (browsers do not run their PDF viewer in one), so only local object URLs reach
// it: never a `javascript:` URL or a server response that could be HTML.
export const pdfFrameUrl = (src: string): string | undefined =>
  src.startsWith('blob:') ? `${appUrl('pdf-frame.html')}#${encodeURIComponent(src)}` : undefined;
