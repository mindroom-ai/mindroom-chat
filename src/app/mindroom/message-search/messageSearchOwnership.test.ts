import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('message search ownership boundaries', () => {
  it('keeps the generic search result group unaware of the MindRoom body component', () => {
    const searchResultGroupSource = readFileSync(
      new URL('../../features/message-search/SearchResultGroup.tsx', import.meta.url),
      'utf8'
    );
    const messageSearchSource = readFileSync(
      new URL('../../features/message-search/MessageSearch.tsx', import.meta.url),
      'utf8'
    );
    const mindroomMessageSearchSource = readFileSync(
      new URL('./MindroomMessageSearch.tsx', import.meta.url),
      'utf8'
    );
    const rendererSource = readFileSync(
      new URL('./searchResultBodyRenderer.tsx', import.meta.url),
      'utf8'
    );

    expect(searchResultGroupSource).toContain('renderBody');
    expect(searchResultGroupSource).not.toContain('MindroomSearchResultBody');
    expect(searchResultGroupSource).not.toContain('mindroom/message-search');
    expect(messageSearchSource).toContain('renderBody');
    expect(messageSearchSource).not.toContain('MindroomSearchResultBody');
    expect(messageSearchSource).not.toContain('mindroom/message-search');
    expect(mindroomMessageSearchSource).toContain('renderMindroomSearchResultBody');
    expect(rendererSource).toContain('MindroomSearchResultBody');
  });
});
