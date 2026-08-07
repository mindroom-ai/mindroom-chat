import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `index.html` is the primary defense against the Google Translate crash
 * (`NotFoundError: Failed to execute 'removeChild' on 'Node'`); the runtime
 * guard in `domMutationGuard.ts` is only the fallback. The file is edited
 * routinely for the theme bootstrap, so pin both markers.
 */
const indexHtml = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('index.html translation markers', () => {
  it('marks the document notranslate for Chrome', () => {
    expect(indexHtml).toContain('<meta name="google" content="notranslate" />');
  });

  it('sets the standard translate attribute on the root element', () => {
    expect(indexHtml).toMatch(/<html\b[^>]*\btranslate="no"/);
  });
});
