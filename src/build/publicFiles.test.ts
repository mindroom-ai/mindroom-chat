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
});
