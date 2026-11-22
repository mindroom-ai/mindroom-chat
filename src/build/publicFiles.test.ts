import { describe, expect, it } from 'vitest';
import { withServePy } from './test-utils/servePy';

// The build's files under /public/ (language catalogs, license texts) are only ever files, so a
// server answers a missing one with 404, never with the app shell: a page or frame that asks for
// such a file must not start another copy of the app. scripts/image-smoke-test.sh checks the same
// on the image's nginx (docker/default.conf).

const SHELL = '<!doctype html><title>app</title>';
const CATALOG = '{"nav":{"home":"Startseite"}}';

describe('scripts/serve.py', () => {
  // Starts Python and serve.py (test-utils/servePy.ts), so this test gets 30 s.
  it('answers a missing file under /public/ with 404, and the files there and app routes as before', async () => {
    await withServePy(
      { 'index.html': SHELL, 'public/locales/de.json': CATALOG },
      async (request) => {
        const answer = async (path: string, method = 'GET') => {
          const response = await request(path, { method });
          return { status: response.status, body: await response.text() };
        };
        expect((await answer('/public/missing.html')).status).toBe(404);
        expect(await answer('/public/missing.html', 'HEAD')).toEqual({ status: 404, body: '' });
        expect(await answer('/public/locales/de.json')).toEqual({ status: 200, body: CATALOG });
        expect(await answer('/home/')).toEqual({ status: 200, body: SHELL });
      }
    );
  }, 30_000);

  // index.html loads /viewport.js as a classic script in <head>; under a base path every route,
  // nested ones too, must ask for it below that path, or the viewport tweak never runs.
  it('points the viewport script at the base path on nested routes', async () => {
    const index = '<!doctype html><script src="/viewport.js"></script><title>app</title>';
    await withServePy(
      { 'index.html': index, 'viewport.js': 'void 0;' },
      async (request) => {
        const page = await request('/chat/home/!room:example.org/');
        expect(page.status).toBe(200);
        const body = await page.text();
        expect(body).toContain('<script src="/chat/viewport.js"></script>');
        expect(body).not.toContain('src="/viewport.js"');
        expect((await request('/chat/viewport.js')).status).toBe(200);
      },
      { APP_BASE_PATH: '/chat' }
    );
  }, 30_000);
});
