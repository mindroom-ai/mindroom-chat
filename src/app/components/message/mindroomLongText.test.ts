import { describe, expect, it } from 'vitest';
import { IEncryptedFile } from '../../../types/matrix/common';
import {
  getMindroomLongTextFormattedBody,
  getMindroomLongTextSource,
  getMindroomLongTextMxcUri,
  resolveMindroomLongTextContent,
} from './mindroomLongText';

describe('getMindroomLongTextSource', () => {
  it('returns direct mxc string metadata', () => {
    expect(getMindroomLongTextSource({ 'io.mindroom.long_text': 'mxc://server/id' })?.mxcUri).toBe(
      'mxc://server/id'
    );
  });

  it('returns object-based mxc metadata', () => {
    expect(
      getMindroomLongTextSource({
        'io.mindroom.long_text': {
          mxc_uri: 'mxc://server/id',
        },
      })?.mxcUri
    ).toBe('mxc://server/id');
  });

  it('falls back to content.url when metadata is marker-only', () => {
    expect(
      getMindroomLongTextSource({
        'io.mindroom.long_text': {
          version: 1,
        },
        url: 'mxc://server/from-url',
      })?.mxcUri
    ).toBe('mxc://server/from-url');
  });

  it('falls back to content.file.url and preserves encryption info', () => {
    const encryptedFile = {
      url: 'mxc://server/encrypted-file',
      key: { kty: 'oct', k: 'abc', alg: 'A256CTR', ext: true, key_ops: ['encrypt', 'decrypt'] },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
      mimetype: 'text/plain',
    } as unknown as IEncryptedFile;

    const source = getMindroomLongTextSource({
      'io.mindroom.long_text': {
        version: 1,
      },
      file: encryptedFile,
    });

    expect(source?.mxcUri).toBe('mxc://server/encrypted-file');
    expect(source?.encInfo?.url).toBe('mxc://server/encrypted-file');
  });

  it('prefers content.url over content.file.url when both exist', () => {
    const source = getMindroomLongTextSource({
      'io.mindroom.long_text': {
        version: 1,
      },
      url: 'mxc://server/unencrypted',
      file: {
        url: 'mxc://server/encrypted',
      } as unknown as IEncryptedFile,
    });

    expect(source?.mxcUri).toBe('mxc://server/unencrypted');
  });

  it('returns undefined when marker is absent', () => {
    expect(
      getMindroomLongTextSource({
        url: 'mxc://server/not-long-text',
      })
    ).toBeUndefined();
  });

  it('detects html attachment based on mimetype', () => {
    const source = getMindroomLongTextSource({
      'io.mindroom.long_text': { version: 1 },
      url: 'mxc://server/html',
      info: { mimetype: 'text/html; charset=utf-8' },
      filename: 'message.html',
    });

    expect(source?.isHtml).toBe(true);
    expect(source?.mimeType).toBe('text/html; charset=utf-8');
    expect(source?.filename).toBe('message.html');
  });
});

describe('getMindroomLongTextMxcUri', () => {
  it('returns undefined for non-mxc metadata', () => {
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
    expect(getMindroomLongTextFormattedBody('<tool>search_web(q=test)</tool>')).toBe(
      '<tool>search_web(q=test)</tool>'
    );
  });

  it('returns undefined for plain text', () => {
    expect(getMindroomLongTextFormattedBody('plain text response')).toBeUndefined();
  });
});

describe('resolveMindroomLongTextContent', () => {
  it('replaces body and preserves formatted_body for plain long text', () => {
    const resolved = resolveMindroomLongTextContent(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      'full plain text'
    );
    expect(resolved.body).toBe('full plain text');
    expect(resolved.formatted_body).toBe('<p>preview</p>');
  });

  it('replaces formatted_body when long text contains mindroom tags', () => {
    const resolved = resolveMindroomLongTextContent(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      '<tool>search_web(q=test)</tool>'
    );
    expect(resolved.body).toBe('<tool>search_web(q=test)</tool>');
    expect(resolved.formatted_body).toBe('<tool>search_web(q=test)</tool>');
  });

  it('promotes html long text to formatted_body and keeps preview body fallback', () => {
    const resolved = resolveMindroomLongTextContent(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      '<p>full <strong>html</strong></p>',
      { isHtml: true }
    );
    expect(resolved.body).toBe('preview');
    expect(resolved.format).toBe('org.matrix.custom.html');
    expect(resolved.formatted_body).toBe('<p>full <strong>html</strong></p>');
  });

  it('uses full html text as body fallback when preview body is absent', () => {
    const resolved = resolveMindroomLongTextContent({}, '<p>full html</p>', {
      isHtml: true,
    });

    expect(resolved.body).toBe('<p>full html</p>');
    expect(resolved.format).toBe('org.matrix.custom.html');
    expect(resolved.formatted_body).toBe('<p>full html</p>');
  });
});
