import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMindroomLongTextHydrationCache,
  getMindroomLongTextSource,
  hasMindroomLongTextMetadata,
  hydrateMindroomLongTextSource,
  parseMindroomLongTextJsonSidecar,
} from './longText';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './mindroomMessageExtras';

beforeEach(() => {
  clearMindroomLongTextHydrationCache();
});

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('getMindroomLongTextSource', () => {
  it('ignores regular file events without long_text metadata', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      url: 'mxc://server/not-long-text',
      body: 'attachment.pdf',
    });

    expect(source).toBeUndefined();
  });

  it('detects v2 unencrypted sidecar source from content.url', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      url: 'mxc://server/id',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/id');
    expect(source?.isV2ContentJson).toBe(true);
    expect(source?.encryptedFile).toBeUndefined();
  });

  it('detects v2 encrypted sidecar source from content.file.url', () => {
    const source = getMindroomLongTextSource({
      msgtype: 'm.file',
      file: {
        url: 'mxc://server/encrypted',
        key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
        iv: 'iv',
        hashes: { sha256: 'hash' },
        v: 'v2',
      },
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/encrypted');
    expect(source?.isV2ContentJson).toBe(true);
    expect(source?.encryptedFile?.url).toBe('mxc://server/encrypted');
  });

  it('uses m.new_content when raw edit wrapper is provided', () => {
    const source = getMindroomLongTextSource({
      'm.new_content': {
        msgtype: 'm.file',
        url: 'mxc://server/new-content',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(source?.mxcUri).toBe('mxc://server/new-content');
    expect(source?.previewContent.body).toBeUndefined();
    expect(source?.previewContent.msgtype).toBe('m.file');
  });
});

describe('hasMindroomLongTextMetadata', () => {
  it('detects long-text metadata without requiring a resolvable sidecar source', () => {
    expect(
      hasMindroomLongTextMetadata({
        msgtype: 'm.text',
        body: 'placeholder',
        'io.mindroom.long_text': {
          version: 2,
        },
      })
    ).toBe(true);
  });

  it('detects metadata in raw edit wrappers', () => {
    expect(
      hasMindroomLongTextMetadata({
        'm.new_content': {
          msgtype: 'm.text',
          body: 'placeholder',
          'io.mindroom.long_text': {
            version: 2,
          },
        },
      })
    ).toBe(true);
  });

  it('ignores regular message content', () => {
    expect(
      hasMindroomLongTextMetadata({
        msgtype: 'm.text',
        body: 'normal',
      })
    ).toBe(false);
  });
});

describe('parseMindroomLongTextJsonSidecar', () => {
  it('parses sidecar json into content object', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        msgtype: 'm.text',
        body: 'hello',
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'hello',
    });
  });

  it('extracts message content from event envelope payloads', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        type: 'm.room.message',
        sender: '@bot:example.com',
        content: {
          msgtype: 'm.text',
          body: 'hello from event envelope',
        },
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'hello from event envelope',
    });
  });

  it('extracts the latest replacement content from debug snapshot payloads', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        '<== MAIN_EVENT ==>': {
          content: {
            msgtype: 'm.text',
            body: 'thinking...',
          },
        },
        '<== REPLACEMENT_EVENT_1 ==>': {
          content: {
            msgtype: 'm.text',
            body: 'partial',
          },
        },
        '<== REPLACEMENT_EVENT_2 ==>': {
          content: {
            msgtype: 'm.text',
            body: 'final',
            formatted_body: '<p>final</p>',
          },
        },
      })
    );

    expect(parsed).toEqual({
      msgtype: 'm.text',
      body: 'final',
      formatted_body: '<p>final</p>',
    });
  });

  it('returns undefined for sidecar json without message content', () => {
    const parsed = parseMindroomLongTextJsonSidecar(
      JSON.stringify({
        random: { payload: true },
      })
    );

    expect(parsed).toBeUndefined();
  });

  it('returns undefined for invalid sidecar json', () => {
    expect(parseMindroomLongTextJsonSidecar('{not-json')).toBeUndefined();
  });
});

describe('hydrateMindroomLongTextSource', () => {
  it('hydrates v2 sidecar json and keeps tool-trace metadata', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        formatted_body: '<p>preview</p>',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: 'Full response',
        formatted_body: '<p>🔧 <code>tool_name</code> [1]</p>',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'completed',
          usage: { total_tokens: 125 },
        },
        'io.mindroom.tool_trace': {
          version: 2,
          events: [{ type: 'tool_call_completed', tool_name: 'tool_name' }],
        },
      })
    );

    expect(resolved.body).toBe('Full response');
    expect(resolved.formatted_body).toBe('<p>🔧 <code>tool_name</code> [1]</p>');
    expect(resolved['io.mindroom.tool_trace']).toEqual({
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'tool_name' }],
    });
    expect(resolved['io.mindroom.ai_run']).toEqual({
      version: 1,
      status: 'completed',
      usage: { total_tokens: 125 },
    });
  });

  it('hydrates v2 edit wrapper payloads by rendering from m.new_content', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: '* fallback edit body',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'cached',
          usage: { total_tokens: 42 },
        },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'final edited body',
          formatted_body: '<p>🔧 <code>search_web</code> [1]</p>',
        },
        'io.mindroom.tool_trace': {
          version: 2,
          events: [{ type: 'tool_call_completed', tool_name: 'search_web' }],
        },
      })
    );

    expect(resolved.body).toBe('final edited body');
    expect(resolved.formatted_body).toBe('<p>🔧 <code>search_web</code> [1]</p>');
    expect(resolved.msgtype).toBe('m.text');
    expect(resolved['io.mindroom.tool_trace']).toEqual({
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'search_web' }],
    });
    expect(resolved['io.mindroom.ai_run']).toEqual({
      version: 1,
      status: 'cached',
      usage: { total_tokens: 42 },
    });
  });

  it('preserves wrapper MindRoom extras when hydrated m.new_content omits them', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper-extras',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const extras = {
      version: 1,
      sections: [
        {
          title: 'Hydrated evidence',
          content_type: 'text/plain',
          content: 'wrapper sidecar extra',
        },
      ],
    };

    const resolved = await hydrateMindroomLongTextSource(source, async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: '* fallback edit body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: extras,
        'm.new_content': {
          msgtype: 'm.text',
          body: 'final edited body',
          formatted_body: '<p>final edited body</p>',
        },
      })
    );

    expect(resolved.body).toBe('final edited body');
    expect(resolved.formatted_body).toBe('<p>final edited body</p>');
    expect(resolved[MINDROOM_MESSAGE_EXTRAS_KEY]).toEqual(extras);
  });

  it('falls back to wrapper body when m.new_content body is missing', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper-fallback',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: '* wrapper body',
        'm.new_content': {
          msgtype: 'm.text',
          formatted_body: '<p>formatted only</p>',
        },
      })
    );

    expect(resolved.body).toBe('* wrapper body');
    expect(resolved.formatted_body).toBe('<p>formatted only</p>');
  });

  it('falls back to preview content when sidecar fetch fails', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () => {
      throw new Error('download failed');
    });

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('falls back to preview content when v2 sidecar json parsing fails', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateMindroomLongTextSource(source, async () => '{bad-json');

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('uses cache for repeated hydration of the same mxc uri', async () => {
    const source = expectDefined(
      getMindroomLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/cached',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const loadSidecarText = vi.fn(async () =>
      JSON.stringify({
        msgtype: 'm.text',
        body: 'cached full body',
      })
    );

    const first = await hydrateMindroomLongTextSource(source, loadSidecarText);
    const second = await hydrateMindroomLongTextSource(source, loadSidecarText);

    expect(loadSidecarText).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});
