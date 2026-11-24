import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THREAD_MODEL_KEY, threadModelContent } from './threadModel';
import {
  buildLongTextPreview,
  clearLongTextHydrationCache,
  getCachedLongTextContent,
  getLongTextSource,
  hasLongTextMetadata,
  hydrateLongTextSource,
  parseLongTextJsonSidecar,
  subscribeLongTextHydration,
  withToolTraceFallback,
} from './longText';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';
import { sanitizeContent } from './untrustedContent';

beforeEach(() => {
  clearLongTextHydrationCache();
});

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('buildLongTextPreview', () => {
  it('previews the start of the text and keeps the routing', () => {
    const relation = { rel_type: 'm.thread', event_id: '$thread' };
    const mentions = { user_ids: ['@mindroom_writer:example.org'] };

    const preview = buildLongTextPreview({
      msgtype: 'm.text',
      body: 'x'.repeat(50_000),
      format: 'org.matrix.custom.html',
      formatted_body: '<p>x</p>',
      'm.mentions': mentions,
      'm.relates_to': relation,
    });

    expect(preview).toEqual({
      body: `${'x'.repeat(2000)}\n\n[Message continues in attached file]`,
      'm.mentions': mentions,
      'm.relates_to': relation,
    });
  });

  // MindRoom reads a fork's first message from its event, so the reference routes it too.
  it("keeps a fork's reference", () => {
    const fork = { thread_id: '$parent', event_id: '$point' };

    const preview = buildLongTextPreview({ body: 'x'.repeat(50_000), 'io.mindroom.fork': fork });

    expect(preview).toEqual({
      body: `${'x'.repeat(2000)}\n\n[Message continues in attached file]`,
      'io.mindroom.fork': fork,
    });
  });

  // MindRoom reads the mid-turn mode from the event, not from the file.
  it('keeps the mid-turn mode', () => {
    const preview = buildLongTextPreview({
      body: 'x'.repeat(50_000),
      'io.mindroom.mid_turn': 'queue',
    });

    expect(preview).toEqual({
      body: `${'x'.repeat(2000)}\n\n[Message continues in attached file]`,
      'io.mindroom.mid_turn': 'queue',
    });
  });

  // MindRoom replaces the event's content with the file's, and both carry the marker.
  it('keeps the submission marker', () => {
    const marker = { id: 'submission', more: false };

    const preview = buildLongTextPreview({
      body: 'x'.repeat(50_000),
      'io.mindroom.submission': marker,
    });

    expect(preview).toEqual({
      body: `${'x'.repeat(2000)}\n\n[Message continues in attached file]`,
      'io.mindroom.submission': marker,
    });
  });

  it('cuts the preview between characters', () => {
    // An emoji is two UTF-16 units; the 2000-unit cut would split the last one in half.
    const preview = buildLongTextPreview({ body: `${'x'.repeat(1999)}${'😀'.repeat(10)}` });

    expect(preview.body).toBe(`${'x'.repeat(1999)}\n\n[Message continues in attached file]`);
    expect(Object.keys(preview)).toEqual(['body']);
  });
});

describe('getLongTextSource', () => {
  it('ignores regular file events without long_text metadata', () => {
    const source = getLongTextSource({
      msgtype: 'm.file',
      url: 'mxc://server/not-long-text',
      body: 'attachment.pdf',
    });

    expect(source).toBeUndefined();
  });

  it('detects v2 unencrypted sidecar source from content.url', () => {
    const source = getLongTextSource({
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
    const source = getLongTextSource({
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
    const source = getLongTextSource({
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

  it('copies wrapper tool trace fallback into m.new_content long-text previews', () => {
    const toolTrace = {
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
    };
    const source = getLongTextSource({
      'io.mindroom.tool_trace': toolTrace,
      'm.new_content': {
        body: 'Preview\n\n🔧 `run_shell_command` [1]',
        formatted_body: '<p>Preview</p><p>🔧 <code>run_shell_command</code> [1]</p>',
        msgtype: 'm.text',
        url: 'mxc://server/streaming-sidecar',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(source?.previewContent['io.mindroom.tool_trace']).toBe(toolTrace);
  });
});

describe('hasLongTextMetadata', () => {
  it('detects long-text metadata without requiring a resolvable sidecar source', () => {
    expect(
      hasLongTextMetadata({
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
      hasLongTextMetadata({
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
      hasLongTextMetadata({
        msgtype: 'm.text',
        body: 'normal',
      })
    ).toBe(false);
  });
});

describe('parseLongTextJsonSidecar', () => {
  it('parses sidecar json into content object', () => {
    const parsed = parseLongTextJsonSidecar(
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
    const parsed = parseLongTextJsonSidecar(
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
    const parsed = parseLongTextJsonSidecar(
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
    const parsed = parseLongTextJsonSidecar(
      JSON.stringify({
        random: { payload: true },
      })
    );

    expect(parsed).toBeUndefined();
  });

  it('returns undefined for invalid sidecar json', () => {
    expect(parseLongTextJsonSidecar('{not-json')).toBeUndefined();
  });
});

describe('hydrateLongTextSource', () => {
  it('hydrates a version-3 sidecar as it was sent; only reading it as its sender puts markers back', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/preview-v3',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      })
    );
    const call = { type: 'tool_call_completed', tool_name: 'shell', body_line: 2, at: 1 };
    const sent = {
      msgtype: 'm.text',
      body: 'Checking.\n\nDone.',
      formatted_body: '<p>Checking.</p>\n<p>Done.</p>\n',
      'io.mindroom.tool_trace': { version: 3, events: [call] },
    };
    const owner = {};
    const resolved = await hydrateLongTextSource(source, async () => JSON.stringify(sent), owner);

    // The cache holds the sidecar for every event that names it, whoever sent the event.
    expect(resolved).toEqual(sent);
    expect(getCachedLongTextContent(source, owner)).toEqual(sent);
    const byOther = sanitizeContent(resolved, false);
    expect(byOther.body).toBe('Checking.\n\nDone.');
    expect(byOther['io.mindroom.tool_trace']).toBeUndefined();
    expect(sanitizeContent(resolved, true).body).toBe('Checking.\n\n🔧 `shell` [1]\n\nDone.');
    expect(sanitizeContent(getCachedLongTextContent(source, owner), false).body).toBe(
      'Checking.\n\nDone.'
    );
    expect(resolved).toEqual(sent);
  });

  it('hydrates v2 sidecar json and keeps tool-trace metadata', async () => {
    const source = expectDefined(
      getLongTextSource({
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

    const resolved = await hydrateLongTextSource(
      source,
      async () =>
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
        }),
      {}
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
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateLongTextSource(
      source,
      async () =>
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
        }),
      {}
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

  // The backend wraps a reply's row as an edit only when it sends it, after its sidecar went up,
  // and sends the row as the reply itself when no earlier row created it. The file holds the
  // replacement as the content it is and as an edit's `m.new_content`; an earlier backend
  // uploaded the replacement alone.
  describe.each([
    ['as its own m.new_content too', true],
    ['alone', false],
  ])('a sidecar that holds a replacement %s', (_name, namesItself) => {
    const preview = {
      msgtype: 'm.file',
      body: 'Found',
      url: 'mxc://server/replacement',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    const replacement = {
      msgtype: 'm.text',
      body: '🔧 `shell` [1]\n\nFound it.',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>🔧 <code>shell</code> [1]</p>\n<p>Found it.</p>\n',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'shell' }],
      },
    };
    const sidecar = JSON.stringify(
      namesItself ? { ...replacement, 'm.new_content': replacement } : replacement
    );

    it.each([
      [
        'an edit',
        {
          ...preview,
          body: '* Found',
          'm.new_content': preview,
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        },
      ],
      ['the reply itself', preview],
    ])('hydrates %s', async (_event, content) => {
      const source = expectDefined(getLongTextSource(content));
      expect(source.previewContent).toBe(preview);

      expect(await hydrateLongTextSource(source, async () => sidecar, {})).toEqual(replacement);
    });
  });

  // The trace of the fallback alone places calls in the fallback's text, not in the replacement's.
  it.each([
    ['a placeholder', { placeholder_body: true }, { body_line: 0, at: 0 }],
    ['positions', {}, { body_line: 1, at: 1 }],
  ])(
    'keeps the text of a replacement without a trace when its fallback has a version-3 trace of %s',
    async (_name, flags, place) => {
      const source = expectDefined(
        getLongTextSource({
          msgtype: 'm.file',
          body: 'preview',
          url: 'mxc://server/edit-wrapper-positions',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        })
      );
      const replacement = {
        msgtype: 'm.text',
        body: 'New answer',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>New answer</p>\n',
      };

      const resolved = await hydrateLongTextSource(
        source,
        async () =>
          JSON.stringify({
            msgtype: 'm.text',
            body: '* Thinking...',
            format: 'org.matrix.custom.html',
            formatted_body: '<p>Thinking...</p>\n',
            'io.mindroom.stream_status': 'streaming',
            'io.mindroom.tool_trace': {
              version: 3,
              ...flags,
              events: [{ type: 'tool_call_started', tool_name: 'shell', ...place }],
            },
            'm.new_content': replacement,
          }),
        {}
      );

      expect(resolved).toEqual({ ...replacement, 'io.mindroom.stream_status': 'streaming' });
      expect(sanitizeContent(resolved, true)).toEqual(resolved);
    }
  );

  it('preserves wrapper MindRoom extras when hydrated m.new_content omits them', async () => {
    const source = expectDefined(
      getLongTextSource({
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

    const resolved = await hydrateLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: '* fallback edit body',
          [MINDROOM_MESSAGE_EXTRAS_KEY]: extras,
          'm.new_content': {
            msgtype: 'm.text',
            body: 'final edited body',
            formatted_body: '<p>final edited body</p>',
          },
        }),
      {}
    );

    expect(resolved.body).toBe('final edited body');
    expect(resolved.formatted_body).toBe('<p>final edited body</p>');
    expect(resolved[MINDROOM_MESSAGE_EXTRAS_KEY]).toEqual(extras);
  });

  it('falls back to wrapper body when m.new_content body is missing', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/edit-wrapper-fallback',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: '* wrapper body',
          'm.new_content': {
            msgtype: 'm.text',
            formatted_body: '<p>formatted only</p>',
          },
        }),
      {}
    );

    expect(resolved.body).toBe('* wrapper body');
    expect(resolved.formatted_body).toBe('<p>formatted only</p>');
  });

  it('falls back to preview content when sidecar fetch fails', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateLongTextSource(
      source,
      async () => {
        throw new Error('download failed');
      },
      {}
    );

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('falls back to preview content when v2 sidecar json parsing fails', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/preview',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );

    const resolved = await hydrateLongTextSource(source, async () => '{bad-json', {});

    expect(resolved).toBe(source.previewContent);
    expect(resolved.body).toBe('preview body');
  });

  it('uses cache for repeated hydration of the same mxc uri', async () => {
    const source = expectDefined(
      getLongTextSource({
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

    const cacheOwner = {};
    const first = await hydrateLongTextSource(source, loadSidecarText, cacheOwner);
    const second = await hydrateLongTextSource(source, loadSidecarText, cacheOwner);

    expect(loadSidecarText).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('does not share hydrated plaintext between account clients', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview body',
        url: 'mxc://server/shared-id',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const accountA = {};
    const accountB = {};
    const loadForAccountA = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'account A plaintext' })
    );
    const loadForAccountB = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'account B plaintext' })
    );

    const first = await hydrateLongTextSource(source, loadForAccountA, accountA);
    const second = await hydrateLongTextSource(source, loadForAccountB, accountB);

    expect(first.body).toBe('account A plaintext');
    expect(second.body).toBe('account B plaintext');
    expect(loadForAccountA).toHaveBeenCalledTimes(1);
    expect(loadForAccountB).toHaveBeenCalledTimes(1);
  });

  it('does not share plaintext across different encryption descriptors for one MXC URI', async () => {
    const makeEncryptedSource = (key: string) =>
      expectDefined(
        getLongTextSource({
          msgtype: 'm.file',
          body: 'preview body',
          file: {
            url: 'mxc://server/shared-encrypted-id',
            key: { kty: 'oct', k: key, alg: 'A256CTR', key_ops: ['decrypt'] },
            iv: 'iv',
            hashes: { sha256: `hash-${key}` },
            v: 'v2',
          },
          'io.mindroom.long_text': {
            version: 2,
            encoding: 'matrix_event_content_json',
          },
        })
      );
    const cacheOwner = {};
    const firstLoader = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'first descriptor plaintext' })
    );
    const secondLoader = vi.fn(async () =>
      JSON.stringify({ msgtype: 'm.text', body: 'second descriptor plaintext' })
    );

    const first = await hydrateLongTextSource(
      makeEncryptedSource('key-a'),
      firstLoader,
      cacheOwner
    );
    const second = await hydrateLongTextSource(
      makeEncryptedSource('key-b'),
      secondLoader,
      cacheOwner
    );

    expect(first.body).toBe('first descriptor plaintext');
    expect(second.body).toBe('second descriptor plaintext');
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(secondLoader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent downloads of the same sidecar into one fetch', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/coalesce',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    let releaseLoader!: (value: string) => void;
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseLoader = resolve;
        })
    );

    // The prewarm pool and a mounting row race the same source: one fetch.
    const first = hydrateLongTextSource(source, loader, cacheOwner);
    const second = hydrateLongTextSource(source, loader, cacheOwner);
    // The loader is deferred one microtask past in-flight registration.
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    releaseLoader(JSON.stringify({ msgtype: 'm.text', body: 'Full response' }));
    const [firstResolved, secondResolved] = await Promise.all([first, second]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(firstResolved.body).toBe('Full response');
    expect(secondResolved).toBe(firstResolved);
  });

  it('retries after a failed download instead of pinning the failure in flight', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/retry',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(JSON.stringify({ msgtype: 'm.text', body: 'Recovered' }));

    const failed = await hydrateLongTextSource(source, loader, cacheOwner);
    expect(failed).toBe(source.previewContent);

    const recovered = await hydrateLongTextSource(source, loader, cacheOwner);
    expect(recovered.body).toBe('Recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('retries after a SYNCHRONOUS loader throw instead of pinning the entry in flight', async () => {
    const source = expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://server/sync-throw',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      })
    );
    const cacheOwner = {};
    // A sync throw settles the async body before its first await; the
    // in-flight entry must be registered before the loader can run, or the
    // finally-cleanup fires before registration and a resolved preview
    // promise stays in the map forever.
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => {
        throw new Error('sync failure');
      })
      .mockResolvedValueOnce(JSON.stringify({ msgtype: 'm.text', body: 'Recovered' }));

    const failed = await hydrateLongTextSource(source, loader, cacheOwner);
    expect(failed).toBe(source.previewContent);

    const recovered = await hydrateLongTextSource(source, loader, cacheOwner);
    expect(recovered.body).toBe('Recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('buildLongTextPreview thread_model routing', () => {
  it('preserves io.mindroom.thread_model on the preview event', () => {
    const pick = threadModelContent('@router:test', 'DEV1', 'sonnet@high');
    const preview = buildLongTextPreview({
      msgtype: 'm.text',
      body: 'Long message',
      ...pick,
    });
    expect(preview[THREAD_MODEL_KEY]).toEqual(pick[THREAD_MODEL_KEY]);
  });
});

describe('withToolTraceFallback', () => {
  it('does not copy a v3 tool trace from a previous revision onto a new preview', () => {
    const nextPreview = {
      msgtype: 'm.text',
      body: 'Found it.',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Found it.</p>\n',
    };
    const previousV3 = {
      msgtype: 'm.text',
      body: 'Thinking...',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Thinking...</p>\n',
      'io.mindroom.tool_trace': {
        version: 3,
        placeholder_body: true,
        events: [{ type: 'tool_call_started', tool_name: 'shell', body_line: 0, at: 0 }],
      },
    };
    const result = withToolTraceFallback(nextPreview, previousV3);
    expect(result).toBe(nextPreview);
    expect(result['io.mindroom.tool_trace']).toBeUndefined();
  });

  it('still copies a v2 tool trace fallback when the preview has none', () => {
    const nextPreview = { msgtype: 'm.text', body: 'Preview' };
    const previousV2 = {
      msgtype: 'm.text',
      body: 'Old',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'shell' }],
      },
    };
    const result = withToolTraceFallback(nextPreview, previousV2);
    expect(result['io.mindroom.tool_trace']).toEqual(previousV2['io.mindroom.tool_trace']);
  });
});

describe('subscribeLongTextHydration', () => {
  const makeSource = (mxcUri: string) =>
    expectDefined(
      getLongTextSource({
        msgtype: 'm.file',
        body: 'preview',
        url: mxcUri,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      })
    );

  it('notifies subscribers when content is cached, respects unsubscribe, and survives cache clear', async () => {
    const owner = {};
    const otherOwner = {};
    const onHydrated = vi.fn();
    const keepListener = vi.fn();
    const otherListener = vi.fn();
    let stopSelf: () => void = () => undefined;
    stopSelf = subscribeLongTextHydration(owner, () => {
      onHydrated();
      stopSelf();
    });
    const stopKeep = subscribeLongTextHydration(owner, keepListener);
    const stopOther = subscribeLongTextHydration(otherOwner, otherListener);

    const source = makeSource('mxc://server/sub-1');
    await hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'full' }),
      owner
    );
    expect(onHydrated).toHaveBeenCalledTimes(1);
    expect(keepListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();

    // Already cached: no duplicate notification.
    await hydrateLongTextSource(source, async () => '', owner);
    expect(keepListener).toHaveBeenCalledTimes(1);

    // Clearing the cache keeps active subscriptions alive; unsubscribed listeners stay silent.
    clearLongTextHydrationCache();
    await hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'reloaded' }),
      owner
    );
    expect(onHydrated).toHaveBeenCalledTimes(1);
    expect(keepListener).toHaveBeenCalledTimes(2);
    stopKeep();
    stopOther();
  });

  it('does not notify on failed, invalid, or stale sidecars', async () => {
    const owner = {};
    const listener = vi.fn();
    const stop = subscribeLongTextHydration(owner, listener);

    await hydrateLongTextSource(
      makeSource('mxc://server/fail'),
      async () => {
        throw new Error('network');
      },
      owner
    );
    await hydrateLongTextSource(makeSource('mxc://server/invalid'), async () => 'not-json', owner);
    await hydrateLongTextSource(
      makeSource('mxc://server/stale'),
      async () => JSON.stringify({ msgtype: 'm.text', body: 'stale' }),
      owner,
      () => false
    );
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
