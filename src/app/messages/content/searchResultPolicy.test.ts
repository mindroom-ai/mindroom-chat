import { describe, expect, it } from 'vitest';
import { shouldUseLongTextSearchResultBody } from './searchResultPolicy';

describe('shouldUseLongTextSearchResultBody', () => {
  it('uses the lightweight search renderer for MindRoom long-text metadata', () => {
    expect(
      shouldUseLongTextSearchResultBody({
        body: 'short preview',
        'io.mindroom.long_text': {
          version: 2,
        },
      })
    ).toBe(true);
  });

  it('does not force lightweight rendering for ordinary message content', () => {
    expect(
      shouldUseLongTextSearchResultBody({
        body: 'short preview',
      })
    ).toBe(false);
  });
});
