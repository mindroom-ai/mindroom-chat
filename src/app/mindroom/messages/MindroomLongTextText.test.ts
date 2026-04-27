import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';
import { MINDROOM_MESSAGE_EXTRAS_KEY, parseMindroomMessageExtras } from './messageExtrasData';
import { clearMindroomLongTextHydrationCache, MindroomLongTextSource } from './longText';

const matrixMocks = vi.hoisted(() => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  downloadMedia: vi.fn(),
  mxcUrlToHttp: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  hydrateMindroomLongTextSource: vi.fn(),
}));
const hookMocks = vi.hoisted(() => ({
  mx: {},
}));

vi.mock('../../utils/matrix', () => ({
  decryptFile: matrixMocks.decryptFile,
  downloadEncryptedMedia: matrixMocks.downloadEncryptedMedia,
  downloadMedia: matrixMocks.downloadMedia,
  mxcUrlToHttp: matrixMocks.mxcUrlToHttp,
}));
vi.mock('./longText', async () => {
  const actual = await vi.importActual<typeof import('./longText')>('./longText');
  return {
    ...actual,
    hydrateMindroomLongTextSource: longTextMocks.hydrateMindroomLongTextSource,
  };
});
vi.mock('../../components/message/MsgTypeRenderers', () => ({
  MEmote: () => null,
  MNotice: () => null,
  MText: ({
    content,
    renderAfterBody,
    renderBody,
  }: {
    content: Record<string, unknown>;
    renderAfterBody?: React.ReactNode;
    renderBody: (props: { body: string }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'long-text-body' },
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody
    ),
}));
vi.mock('folds', () => ({
  Box: () => null,
  Spinner: () => null,
  Text: () => null,
  config: {
    space: {
      S100: '4px',
    },
  },
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => hookMocks.mx,
}));
vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

const getDownloadMindroomLongTextSidecarText = async () =>
  (await import('./MindroomLongTextText')).downloadMindroomLongTextSidecarText;
const getDownloadMindroomLongTextSidecarBlob = async () =>
  (await import('./MindroomLongTextText')).downloadMindroomLongTextSidecarBlob;
const getMindroomLongTextTextModule = async () => import('./MindroomLongTextText');
const getShouldResetResolvedContentToPreview = async () =>
  (await import('./MindroomLongTextText')).shouldResetResolvedContentToPreview;
const mockMx = hookMocks.mx as MatrixClient;

const createLongTextSource = (
  overrides: Partial<MindroomLongTextSource> = {}
): MindroomLongTextSource => ({
  previewContent: {
    msgtype: 'm.file',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  },
  mxcUri: 'mxc://server/content',
  isV2ContentJson: true,
  ...overrides,
});

const createPreviewContent = () => ({
  body: 'Preview response',
  info: { mimetype: 'application/json' },
  msgtype: 'm.text',
  url: 'mxc://server/content',
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
});

const createMessageExtras = (content: string) => ({
  version: 1,
  sections: [{ title: 'Evidence', content_type: 'text/plain', content }],
});

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const renderMindroomLongTextText = async (
  content: Record<string, unknown>
): Promise<{
  renderer: ReactTestRenderer;
  update: (nextContent: Record<string, unknown>) => Promise<void>;
}> => {
  const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
  let renderer!: ReactTestRenderer;

  const render = (nextContent: Record<string, unknown>) =>
    React.createElement(MindroomLongTextText, {
      kind: MindroomLongTextKind.Text,
      content: nextContent,
      longTextSource: createLongTextSource({ previewContent: nextContent }),
      renderBody: () => null,
    });

  await act(async () => {
    renderer = create(render(content));
  });

  return {
    renderer,
    update: async (nextContent) => {
      await act(async () => {
        renderer.update(render(nextContent));
      });
    },
  };
};

const renderResolvedContentProbe = async (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Promise<{
  onResolvedContent: ReturnType<typeof vi.fn>;
  renderer: ReactTestRenderer;
  update: (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) => Promise<void>;
}> => {
  const { useMindroomLongTextResolvedContent } = await getMindroomLongTextTextModule();
  const onResolvedContent = vi.fn();
  let renderer!: ReactTestRenderer;

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: MindroomLongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useMindroomLongTextResolvedContent(nextSource, nextEnabled);

    React.useEffect(() => {
      onResolvedContent(resolvedContent);
    }, [resolvedContent]);

    return null;
  };

  const render = (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) =>
    React.createElement(Probe, { nextSource, nextEnabled });

  await act(async () => {
    renderer = create(render(source, enabled));
  });

  return {
    onResolvedContent,
    renderer,
    update: async (nextSource, nextEnabled) => {
      await act(async () => {
        renderer.update(render(nextSource, nextEnabled));
      });
    },
  };
};

const renderResolvedContentDomProbe = async (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Promise<{
  getProbeText: () => string;
  renderer: ReactTestRenderer;
  update: (
    nextSource: MindroomLongTextSource | undefined,
    nextEnabled: boolean
  ) => Promise<{ renderPhaseValues: (Record<string, unknown> | undefined)[] }>;
}> => {
  const { useMindroomLongTextResolvedContent } = await getMindroomLongTextTextModule();
  let renderer!: ReactTestRenderer;
  const renderPhaseValues: (Record<string, unknown> | undefined)[] = [];

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: MindroomLongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useMindroomLongTextResolvedContent(nextSource, nextEnabled);
    renderPhaseValues.push(resolvedContent);

    return React.createElement(
      'div',
      { 'data-testid': 'probe' },
      resolvedContent ? JSON.stringify(resolvedContent) : 'EMPTY'
    );
  };

  const render = (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) =>
    React.createElement(Probe, { nextSource, nextEnabled });

  const getProbeText = () => {
    const probe = renderer.root.findByProps({ 'data-testid': 'probe' });
    return probe.children.join('');
  };

  await act(async () => {
    renderer = create(render(source, enabled));
  });

  return {
    getProbeText,
    renderer,
    update: async (nextSource, nextEnabled) => {
      renderPhaseValues.length = 0;

      await act(async () => {
        renderer.update(render(nextSource, nextEnabled));
      });

      return { renderPhaseValues: [...renderPhaseValues] };
    },
  };
};

describe('downloadMindroomLongTextSidecarText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Resolved response',
      msgtype: 'm.text',
    });
  });

  it('downloads unencrypted sidecar content using downloadMedia', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    matrixMocks.downloadMedia.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    const text = await downloadMindroomLongTextSidecarText(mockMx, createLongTextSource(), false);

    expect(matrixMocks.downloadMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"full response"');
  });

  it('downloads sidecar blob for unencrypted content', async () => {
    const downloadMindroomLongTextSidecarBlob = await getDownloadMindroomLongTextSidecarBlob();
    const blob = new Blob(['raw-content'], { type: 'application/json' });
    matrixMocks.downloadMedia.mockResolvedValue(blob);

    const downloadedBlob = await downloadMindroomLongTextSidecarBlob(
      mockMx,
      createLongTextSource(),
      false
    );

    expect(matrixMocks.downloadMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(downloadedBlob).toBe(blob);
  });

  it('downloads encrypted sidecar content using downloadEncryptedMedia + decryptFile', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    const encryptedFile: IEncryptedFile = {
      url: 'mxc://server/encrypted',
      key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
    };

    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/encrypted'
    );
    matrixMocks.decryptFile.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'decrypted response' })], {
        type: 'application/json',
      })
    );
    matrixMocks.downloadEncryptedMedia.mockImplementation(
      async (_url: string, decryptContent: (buf: ArrayBuffer) => Promise<Blob>) =>
        decryptContent(new ArrayBuffer(32))
    );

    const text = await downloadMindroomLongTextSidecarText(
      mockMx,
      createLongTextSource({
        previewContent: {
          msgtype: 'm.file',
          info: { mimetype: 'application/json' },
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
        mxcUri: 'mxc://server/encrypted',
        encryptedFile,
      }),
      true
    );

    expect(matrixMocks.downloadEncryptedMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/encrypted',
      expect.any(Function)
    );
    expect(matrixMocks.decryptFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/json',
      encryptedFile
    );
    expect(matrixMocks.downloadMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"decrypted response"');
  });
});

describe('shouldResetResolvedContentToPreview', () => {
  it('keeps previously hydrated rich content when preview has no formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.text',
        body: 'resolved body',
        formatted_body: '<p><strong>resolved body</strong></p>',
      }
    );

    expect(shouldReset).toBe(false);
  });

  it('resets when incoming preview includes formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.text',
        body: 'preview',
        formatted_body: '<p>preview</p>',
      },
      {
        msgtype: 'm.text',
        body: 'older body',
        formatted_body: '<p>older</p>',
      }
    );

    expect(shouldReset).toBe(true);
  });

  it('resets when there is no previously hydrated formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.file',
        body: 'still preview',
      }
    );

    expect(shouldReset).toBe(true);
  });
});

describe('MindroomLongTextText hydration identity', () => {
  it('does not restart hydration for equivalent preview content with a new object reference', async () => {
    const content = createPreviewContent();
    const { renderer, update } = await renderMindroomLongTextText(content);

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await update({
      ...content,
      info: { ...(content.info as Record<string, unknown>) },
      'io.mindroom.long_text': {
        ...((content['io.mindroom.long_text'] as Record<string, unknown>) ?? {}),
      },
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps preview extras available when hydrated content omits them', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const previewContent = {
      ...createPreviewContent(),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('preview extra'),
    };
    const deferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);

    await act(async () => {
      renderer = create(
        React.createElement(MindroomLongTextText, {
          kind: MindroomLongTextKind.Text,
          content: previewContent,
          longTextSource: createLongTextSource({ previewContent }),
          renderBody: (_content, props) => props.body,
          renderAfterBody: (extrasContent, fallbackContent) =>
            React.createElement(
              'span',
              { 'data-testid': 'extras-probe' },
              extrasContent[MINDROOM_MESSAGE_EXTRAS_KEY] ||
                fallbackContent[MINDROOM_MESSAGE_EXTRAS_KEY]
                ? 'extras-present'
                : 'extras-missing'
            ),
        })
      );
    });

    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'extras-present',
    ]);

    await act(async () => {
      deferred.resolve({ body: 'Hydrated response', msgtype: 'm.text' });
      await deferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'extras-present',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('prefers live extras over stale hydrated extras when only extras change', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const previewContent = {
      ...createPreviewContent(),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('hydrated extra E1'),
    };
    const liveEditedContent = {
      ...previewContent,
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('live extra E2'),
    };
    const hydratedContent = {
      body: 'Hydrated response',
      msgtype: 'm.text',
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('hydrated extra E1'),
    };
    const deferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    const render = (nextContent: Record<string, unknown>) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content: nextContent,
        longTextSource: createLongTextSource({ previewContent: nextContent }),
        renderBody: (_content, props) => props.body,
        renderAfterBody: (extrasContent, fallbackContent) =>
          React.createElement(
            'span',
            { 'data-testid': 'extras-probe' },
            parseMindroomMessageExtras(extrasContent)?.sections[0]?.content ??
              (!(MINDROOM_MESSAGE_EXTRAS_KEY in extrasContent)
                ? parseMindroomMessageExtras(fallbackContent)?.sections[0]?.content
                : undefined) ??
              'extras-missing'
          ),
      });

    longTextMocks.hydrateMindroomLongTextSource.mockClear();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);

    await act(async () => {
      renderer = create(render(previewContent));
    });

    await act(async () => {
      deferred.resolve(hydratedContent);
      await deferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'hydrated extra E1',
    ]);

    await act(async () => {
      renderer.update(render(liveEditedContent));
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'live extra E2',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the previous hydrated tool trace while the next rich preview hydrates', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const toolTrace = {
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
    };
    const firstPreviewContent = {
      ...createPreviewContent(),
      body: 'Preview A\n\n🔧 `run_shell_command` [1]',
      formatted_body: '<p>Preview A</p><p>🔧 <code>run_shell_command</code> [1]</p>',
      url: 'mxc://server/stream-a',
    };
    const secondPreviewContent = {
      ...createPreviewContent(),
      body: 'Preview B\n\n🔧 `run_shell_command` [1]',
      formatted_body: '<p>Preview B</p><p>🔧 <code>run_shell_command</code> [1]</p>',
      url: 'mxc://server/stream-b',
    };
    const secondDeferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    const render = (nextContent: Record<string, unknown>) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content: nextContent,
        longTextSource: createLongTextSource({
          previewContent: nextContent,
          mxcUri: nextContent.url as string,
        }),
        renderBody: (resolvedContent, props) =>
          React.createElement(
            'span',
            { 'data-testid': 'tool-trace-probe' },
            `${props.body}|${
              resolvedContent['io.mindroom.tool_trace'] ? 'trace-present' : 'trace-missing'
            }`
          ),
      });

    longTextMocks.hydrateMindroomLongTextSource.mockReset();
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      (source: MindroomLongTextSource) => {
        if (source.mxcUri === 'mxc://server/stream-a') {
          return Promise.resolve({
            body: 'Hydrated A',
            formatted_body: '<p>Hydrated A</p>',
            msgtype: 'm.text',
            'io.mindroom.tool_trace': toolTrace,
          });
        }
        return secondDeferred.promise;
      }
    );

    await act(async () => {
      renderer = create(render(firstPreviewContent));
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Hydrated A|trace-present',
    ]);

    await act(async () => {
      renderer.update(render(secondPreviewContent));
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Preview B\n\n🔧 `run_shell_command` [1]|trace-present',
    ]);

    await act(async () => {
      secondDeferred.resolve({
        body: 'Hydrated B',
        formatted_body: '<p>Hydrated B</p>',
        msgtype: 'm.text',
        'io.mindroom.tool_trace': toolTrace,
      });
      await secondDeferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Hydrated B|trace-present',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useMindroomLongTextResolvedContent', () => {
  beforeEach(async () => {
    clearMindroomLongTextHydrationCache();
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );

    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      actualMindroomLongText.hydrateMindroomLongTextSource
    );
  });

  it('returns cached content synchronously without fetching again', async () => {
    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const resolvedContent = {
      msgtype: 'm.text',
      body: 'Warm cache response',
    };

    await actualMindroomLongText.hydrateMindroomLongTextSource(source, async () =>
      JSON.stringify(resolvedContent)
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    expect(onResolvedContent).toHaveBeenCalledWith(resolvedContent);
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(matrixMocks.downloadMedia).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('stays unresolved while disabled when the cache is cold', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, false);

    expect(onResolvedContent).toHaveBeenCalledWith(undefined);
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(matrixMocks.downloadMedia).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('hydrates the sidecar when enabled and the cache is cold', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const resolvedContent = {
      msgtype: 'm.text',
      body: 'Hydrated response',
    };

    matrixMocks.downloadMedia.mockResolvedValue(
      new Blob([JSON.stringify(resolvedContent)], {
        type: 'application/json',
      })
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.downloadMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(onResolvedContent).toHaveBeenLastCalledWith(resolvedContent);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not update state after unmount when in-flight hydration resolves later', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const deferred = createDeferred<Blob>();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    matrixMocks.downloadMedia.mockImplementation(() => deferred.promise);

    try {
      const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

      expect(onResolvedContent).toHaveBeenCalledTimes(1);
      expect(onResolvedContent).toHaveBeenLastCalledWith(undefined);
      expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderer.unmount();
      });

      await act(async () => {
        deferred.resolve(
          new Blob([JSON.stringify({ msgtype: 'm.text', body: 'Resolved after unmount' })], {
            type: 'application/json',
          })
        );
        await deferred.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onResolvedContent).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not return stale resolved content when the source mxcUri changes', async () => {
    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    const sourceA = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        body: 'Preview A',
        msgtype: 'm.file',
        url: 'mxc://server/content-a',
      },
      mxcUri: 'mxc://server/content-a',
    });
    const sourceB = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        body: 'Preview B',
        msgtype: 'm.file',
        url: 'mxc://server/content-b',
      },
      mxcUri: 'mxc://server/content-b',
    });
    const deferred = createDeferred<Blob>();
    const resolvedContentA = {
      msgtype: 'm.text',
      body: 'A body',
    };
    const resolvedContentB = {
      msgtype: 'm.text',
      body: 'B body',
    };

    await actualMindroomLongText.hydrateMindroomLongTextSource(sourceA, async () =>
      JSON.stringify(resolvedContentA)
    );
    matrixMocks.downloadMedia.mockImplementation(() => deferred.promise);

    const { getProbeText, renderer, update } = await renderResolvedContentDomProbe(sourceA, true);

    expect(getProbeText()).toBe(JSON.stringify(resolvedContentA));
    expect(matrixMocks.downloadMedia).not.toHaveBeenCalled();

    const { renderPhaseValues } = await update(sourceB, true);

    expect(renderPhaseValues[0]).toBeUndefined();
    expect(getProbeText()).toBe('EMPTY');
    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.downloadMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(new Blob([JSON.stringify(resolvedContentB)], { type: 'application/json' }));
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getProbeText()).toBe(JSON.stringify(resolvedContentB));

    await act(async () => {
      renderer.unmount();
    });
  });
});
