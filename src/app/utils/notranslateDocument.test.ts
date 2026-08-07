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
  // Matched with regexes rather than exact serialization so reformatting the
  // shell cannot fail CI while the marker is still present. Both attributes
  // must still land on the same tag for the marker to mean anything.
  it('marks the document notranslate for Chrome', () => {
    expect(indexHtml).toMatch(
      /<meta\b(?=[^>]*\bname="google")(?=[^>]*\bcontent="notranslate")[^>]*>/
    );
  });

  it('sets the standard translate attribute on the root element', () => {
    expect(indexHtml).toMatch(/<html\b[^>]*\btranslate="no"/);
  });
});
