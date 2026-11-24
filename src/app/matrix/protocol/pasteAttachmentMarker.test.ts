import { describe, expect, it, vi } from 'vitest';
import {
  MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY,
  createPasteId,
  createPasteMarker,
  formatPasteMarkerTextAsHtml,
  getPasteAttachmentFile,
  getPasteFileName,
  parsePasteMarker,
  withPasteAttachmentMetadata,
} from './pasteAttachmentMarker';

describe('pasteAttachmentMarker', () => {
  it('creates a parseable marker for a paste file', () => {
    const fileName = getPasteFileName('paste-a3f19c');
    const marker = createPasteMarker({ id: 'paste-a3f19c', chars: 11, fileName });

    expect(fileName).toBe('mindroom-paste-a3f19c.txt');
    expect(marker).toBe(
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]'
    );
    expect(parsePasteMarker(marker)).toEqual({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      raw: marker,
    });
  });

  it('creates short lowercase hex ids', () => {
    expect(createPasteId(() => new Uint8Array([0xa3, 0xf1, 0x9c]))).toBe('paste-a3f19c');
  });

  it('rejects malformed markers', () => {
    expect(parsePasteMarker('[[mindroom-paste id=bad chars=11 file="x.txt"]]')).toBe(
      undefined
    );
    expect(
      parsePasteMarker(
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":"NaN","file":"x.txt"}]]'
      )
    ).toBe(undefined);
    expect(
      parsePasteMarker(
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"../x.txt"}]]'
      )
    ).toBe(undefined);
  });

  it('formats inline markers as safe HTML spans', () => {
    const html = formatPasteMarkerTextAsHtml(
      'Before <unsafe> [[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]] after'
    );

    expect(html).toBe(
      [
        '<p>Before &lt;unsafe&gt; ',
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
        ' after</p>',
      ].join('')
    );
  });

  it('returns undefined when text has no paste marker', () => {
    expect(formatPasteMarkerTextAsHtml('ordinary message')).toBeUndefined();
  });

  it('adds parseable metadata to generated paste file events', () => {
    const content = withPasteAttachmentMetadata(
      {
        msgtype: 'm.file',
        body: 'mindroom-paste-a3f19c.txt',
        filename: 'mindroom-paste-a3f19c.txt',
        url: 'mxc://example.org/pasted-text',
        info: {
          mimetype: 'text/plain',
          size: 11,
        },
      },
      {
        id: 'paste-a3f19c',
        chars: 11,
        fileName: 'mindroom-paste-a3f19c.txt',
      }
    );

    expect(content[MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY]).toEqual({
      version: 1,
      id: 'paste-a3f19c',
      chars: 11,
      file: 'mindroom-paste-a3f19c.txt',
    });
    expect(getPasteAttachmentFile(content)).toEqual({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      mxcUri: 'mxc://example.org/pasted-text',
      mimeType: 'text/plain',
      size: 11,
      encryptedFile: undefined,
    });
  });

  it('uses cryptographic random bytes when available', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0xde, 0xad, 0xbe]);
        return bytes;
      },
    });

    expect(createPasteId()).toBe('paste-deadbe');

    vi.stubGlobal('crypto', originalCrypto);
  });
});
