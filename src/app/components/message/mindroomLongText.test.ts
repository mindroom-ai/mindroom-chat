import { describe, expect, it } from 'vitest';
import {
  getMindroomLongTextFormattedBody,
  getMindroomLongTextMxcUri,
  resolveMindroomLongTextContent,
} from './mindroomLongText';

describe('getMindroomLongTextMxcUri', () => {
  it('returns direct mxc string metadata', () => {
    expect(getMindroomLongTextMxcUri({ 'io.mindroom.long_text': 'mxc://server/id' })).toBe(
      'mxc://server/id'
    );
  });

  it('returns object-based mxc metadata', () => {
    expect(
      getMindroomLongTextMxcUri({
        'io.mindroom.long_text': {
          mxc_uri: 'mxc://server/id',
        },
      })
    ).toBe('mxc://server/id');
  });

  it('ignores non-mxc metadata', () => {
    expect(
      getMindroomLongTextMxcUri({
        'io.mindroom.long_text': {
          url: 'https://example.com/file.txt',
        },
      })
    ).toBeUndefined();
  });
});

describe('getMindroomLongTextFormattedBody', () => {
  it('returns formatted body when mindroom tags are present', () => {
    expect(getMindroomLongTextFormattedBody('<think>searching...</think>')).toBe(
      '<think>searching...</think>'
    );
  });

  it('returns undefined for plain text', () => {
    expect(getMindroomLongTextFormattedBody('plain text response')).toBeUndefined();
  });
});

describe('resolveMindroomLongTextContent', () => {
  it('replaces body and clears preview formatted_body for plain long text', () => {
    const resolved = resolveMindroomLongTextContent(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      'full plain text'
    );
    expect(resolved.body).toBe('full plain text');
    expect(resolved.formatted_body).toBeUndefined();
  });

  it('replaces formatted_body when long text contains mindroom tags', () => {
    const resolved = resolveMindroomLongTextContent(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      '<analysis>search_web(q=test)</analysis>'
    );
    expect(resolved.body).toBe('<analysis>search_web(q=test)</analysis>');
    expect(resolved.formatted_body).toBe('<analysis>search_web(q=test)</analysis>');
  });
});
