import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../matrix/types/common';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { trimReplyFromBody } from '../../matrix/room';
import { clearLongTextHydrationCache, LongTextSource } from '../../matrix/protocol/longText';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import { showToolCalls } from '../../../test/utils/showToolCalls';

// These tests show how tool calls render, so they show them.
beforeEach(showToolCalls);

const matrixMocks = vi.hoisted(() => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  networkBody: vi.fn(),
  mxcUrlToHttp: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  hydrateMindroomLongTextSource: vi.fn(),
}));
const hookMocks = vi.hoisted(() => ({
  mx: {
    getAccessToken: vi.fn(() => undefined),
    getHomeserverUrl: vi.fn(() => 'https://example.org'),
    getSafeUserId: vi.fn(() => '@alice:example.org'),
    getVersions: async () => ({ versions: ['v1.11'], unstable_features: {} }),
  },
}));

vi.mock('../../matrix/matrix', () => ({
  decryptFile: matrixMocks.decryptFile,
  downloadEncryptedMedia: matrixMocks.downloadEncryptedMedia,
  mxcUrlToHttp: matrixMocks.mxcUrlToHttp,
}));
vi.mock('../../matrix/protocol/longText', async () => {
  const actual = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
    '../../matrix/protocol/longText'
  );
  return {
    ...actual,
    hydrateLongTextSource: longTextMocks.hydrateMindroomLongTextSource,
  };
});
vi.mock('./FallbackContent', () => ({
  MessageEmptyContent: () => React.createElement('span', { 'data-testid': 'empty-content' }),
}));
vi.mock('./RenderBody', async () => {
  const { RenderBody } = await vi.importActual<typeof import('./RenderBody')>('./RenderBody');
  return {
    RenderBody,
  };
});
vi.mock('./BrokenContent', async () => {
  return {
    BrokenContent: () => React.createElement('span', { 'data-testid': 'broken-content' }),
  };
});
vi.mock('./MsgTypeRenderers', () => ({
  MEmote: () => null,
  MNotice: () => null,
  MText: ({
    content,
    renderBody,
    renderUrlsPreview,
  }: {
    content: Record<string, unknown>;
    renderBody: (props: { body: string; customBody?: string }) => React.ReactNode;
    renderUrlsPreview?: (urls: string[]) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'long-text-body' },
      renderBody({
        body: trimReplyFromBody(typeof content.body === 'string' ? content.body : ''),
        customBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
      }),
      // As the real text message does, its link previews come from the body it shows.
      renderUrlsPreview?.(
        (typeof content.body === 'string' ? content.body : '').match(/https?:\/\/\S+/g) ?? []
      )
    ),
}));
vi.mock('../canvas/InlineCanvasFrame', () => ({ InlineCanvasFrame: () => null }));
vi.mock('./ImageOverlay', () => ({ ImageOverlay: () => null }));
vi.mock('folds', () => ({
  Box: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('div', props, children as React.ReactNode),
  Icon: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('span', props, children as React.ReactNode),
  Icons: new Proxy(
    {},
    {
      get: (_, prop) => String(prop),
    }
  ),
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ as = 'div', children, ...props }: Record<string, unknown>) =>
    React.createElement(typeof as === 'string' ? as : 'div', props, children as React.ReactNode),
  config: {
    space: {
      S100: '4px',
    },
  },
}));
vi.mock('../../rich-text/CustomHtml.css', () => ({
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));

vi.mock('../../rich-text/Footnote.css', () => ({}));
vi.mock('../../rich-text/TaskList.css', () => ({
  TaskList: 'TaskList',
  TaskListItem: 'TaskListItem',
  TaskItemBody: 'TaskItemBody',
  TaskCheckbox: 'TaskCheckbox',
  TaskCheckboxHighlighted: 'TaskCheckboxHighlighted',
}));
vi.mock('../../rich-text/Callout.css', () => ({
  Callout: ({ tone }: { tone?: string } = {}) => `Callout-${tone ?? ''}`,
  Header: ({ tone }: { tone?: string } = {}) => `CalloutHeader-${tone ?? ''}`,
  Icon: 'CalloutIcon',
  Body: 'CalloutBody',
}));
vi.mock('../../rich-text/ScrollableTable.css', () => ({
  Container: 'TableContainer',
  ScrollArea: 'TableScrollArea',
  Table: 'Table',
  Hint: 'TableHint',
}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
}));

vi.mock('../agent-run/Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Toggle: 'Toggle',
  Label: 'Label',
  Chevron: 'Chevron',
}));
vi.mock('../agent-run/FinishedWorkFold.css', () => ({
  Row: 'Row',
  ClockBox: 'ClockBox',
  Clock: 'Clock',
  Hands: 'Hands',
  Label: 'WorkLabel',
  Chevron: 'WorkChevron',
  Ring: 'Ring',
  Work: 'Work',
  WorkInner: 'WorkInner',
}));
vi.mock('../question/QuestionCard.css', () => ({}));
vi.mock('../agent-run/OutlineComet.css', () => ({}));
vi.mock('../agent-run/CompactionSeam.css', () => ({}));
vi.mock('../agent-run/ToolCallsFold.css', () => ({}));
vi.mock('../html/HtmlBlocks.css', () => ({
  Block: 'MindroomBlock',
  BlockBody: 'MindroomBlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'MindroomBlockHeader',
  BlockHeaderMeta: 'MindroomBlockHeaderMeta',
}));
vi.mock('../../timeline/CollapsibleMessage.css', () => ({
  CollapsibleContent: () => 'collapsible-content',
  CollapsibleContainer: 'collapsible-container',
  CollapsibleFooter: 'collapsible-footer',
  CollapsibleStickyFooter: 'collapsible-sticky-footer',
  CollapsiblePill: 'collapsible-pill',
}));
vi.mock('./PasteAttachmentContent', () => ({
  PasteAttachmentContent: () => null,
}));
vi.mock('../agent-run/ThinkingPlaceholder', () => ({
  ThinkingPlaceholder: () => null,
}));
vi.mock('../agent-run/TranscribingPlaceholder', () => ({
  TranscribingPlaceholder: () => null,
}));
vi.mock('../SkillReviewMarker', () => ({
  SkillReviewMarker: () => null,
}));
vi.mock('../TriggerWakeMarker', () => ({
  TriggerWakeMarker: () => null,
}));
vi.mock('../TodoPokeMarker', () => ({
  TodoPokeMarker: () => null,
}));
vi.mock('../thread-summary/ThreadSummaryCard', () => ({
  ThreadSummaryCard: () => null,
}));
vi.mock('../../approvals/ToolApprovalCard', () => ({
  ToolApprovalCard: () => null,
}));
vi.mock('../../approvals/SecretRequestLine', () => ({ SecretRequestLine: () => null }));
vi.mock('../../approvals/SecretRequestCard', () => ({
  SecretRequestCard: () => null,
}));
vi.mock('../workflow-run/WorkflowRunCard', () => ({
  WorkflowRunCard: () => null,
}));
vi.mock('../workflow-run/WorkflowQuestionCard', () => ({
  WorkflowQuestionCard: () => null,
}));
vi.mock('./CallTranscriptCard', () => ({
  CallTranscriptCard: () => null,
}));
vi.mock('../agent-run/StreamingIndicator', () => ({
  renderStreamingIndicator: () => null,
}));
vi.mock('./messageStateSuffix', () => ({
  getMessageStateSuffixRenderer: () => undefined,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => hookMocks.mx,
}));

const getDownloadLongTextSidecarBlob = async () =>
  (await import('./longTextDownload')).downloadLongTextSidecarBlob;
const getLongTextTextModule = async () => import('./LongTextText');
const getShouldResetResolvedContentToPreview = async () =>
  (await import('./LongTextText')).shouldResetResolvedContentToPreview;
const mockMx = hookMocks.mx as unknown as MatrixClient;

const createLongTextSource = (overrides: Partial<LongTextSource> = {}): LongTextSource => ({
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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const renderLongTextText = async (
  content: Record<string, unknown>
): Promise<{
  renderer: ReactTestRenderer;
  update: (nextContent: Record<string, unknown>) => Promise<void>;
}> => {
  const { LongTextKind, LongTextText } = await getLongTextTextModule();
  let renderer!: ReactTestRenderer;

  const render = (nextContent: Record<string, unknown>) =>
    React.createElement(LongTextText, {
      kind: LongTextKind.Text,
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
  source: LongTextSource | undefined,
  enabled: boolean
): Promise<{
  onResolvedContent: ReturnType<typeof vi.fn>;
  renderer: ReactTestRenderer;
  update: (nextSource: LongTextSource | undefined, nextEnabled: boolean) => Promise<void>;
}> => {
  const { useLongTextResolvedContent } = await getLongTextTextModule();
  const onResolvedContent = vi.fn();
  let renderer!: ReactTestRenderer;

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: LongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useLongTextResolvedContent(nextSource, nextEnabled);

    React.useEffect(() => {
      onResolvedContent(resolvedContent);
    }, [resolvedContent]);

    return null;
  };

  const render = (nextSource: LongTextSource | undefined, nextEnabled: boolean) =>
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
  source: LongTextSource | undefined,
  enabled: boolean
): Promise<{
  getProbeText: () => string;
  renderer: ReactTestRenderer;
  update: (
    nextSource: LongTextSource | undefined,
    nextEnabled: boolean
  ) => Promise<{ renderPhaseValues: (Record<string, unknown> | undefined)[] }>;
}> => {
  const { useLongTextResolvedContent } = await getLongTextTextModule();
  let renderer!: ReactTestRenderer;
  const renderPhaseValues: (Record<string, unknown> | undefined)[] = [];

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: LongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useLongTextResolvedContent(nextSource, nextEnabled);
    renderPhaseValues.push(resolvedContent);

    return React.createElement(
      'div',
      { 'data-testid': 'probe' },
      resolvedContent ? JSON.stringify(resolvedContent) : 'EMPTY'
    );
  };

  const render = (nextSource: LongTextSource | undefined, nextEnabled: boolean) =>
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const blob = init?.headers
        ? await matrixMocks.networkBody(url, { headers: init.headers })
        : await matrixMocks.networkBody(url);
      return new Response(blob);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

// The group title names its state ("Ran 2 tool calls", "Running 1 tool call", or "Used 2 tools"
// while trace details load); grouping tests only care about the count.
const toolCountLabel = (count: number, flags = '') => {
  const s = count === 1 ? '' : 's';
  return new RegExp(
    `(?:Ran|Running|Denied) ${count} tool call${s}|Used ${count} tool${s}|\\b${count} tool call${s} (?:waiting|expired)`,
    flags
  );
};

const reportVersions = (versions: string[]) =>
  Object.assign(hookMocks.mx, { getVersions: async () => ({ versions, unstable_features: {} }) });

// One after the other: modules of an import cycle loaded side by side can read a binding too early.
importBeforeTests(async () => {
  await import('../../timeline/CollapsibleMessage');
  await import('./renderAgentMessageContent');
});

describe('downloadLongTextSidecarBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportVersions(['v1.11']);
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Resolved response',
      msgtype: 'm.text',
    });
  });

  it('downloads unencrypted sidecar content through shared transport', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    // A homeserver without authenticated media gets the legacy URL.
    reportVersions([]);
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    const text = await (await downloadLongTextSidecarBlob(mockMx, createLongTextSource())).text();

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"full response"');
  });

  it('authenticates unencrypted sidecar downloads without relying on the service worker', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    const mediaUrl = 'https://example.org/_matrix/client/v1/media/download/server/content';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    await downloadLongTextSidecarBlob(mockMx, createLongTextSource());

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', true);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('does not send the access token to a media URL outside the homeserver', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    const mediaUrl = 'https://media.example.net/_matrix/client/v1/media/download/server/content';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.networkBody.mockResolvedValue(
      new Blob(['{"msgtype":"m.text","body":"body"}'], { type: 'application/json' })
    );

    await downloadLongTextSidecarBlob(mockMx, createLongTextSource());

    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl);
  });

  it('downloads sidecar blob for unencrypted content', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    reportVersions([]);
    const blob = new Blob(['raw-content'], { type: 'application/json' });
    matrixMocks.networkBody.mockResolvedValue(blob);

    const downloadedBlob = await downloadLongTextSidecarBlob(mockMx, createLongTextSource(), true);

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(downloadedBlob.type).toBe(blob.type);
    expect(await downloadedBlob.text()).toBe('raw-content');
  });

  it('downloads encrypted sidecar cipher bytes and decrypts only the consumer blob', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    const encryptedFile: IEncryptedFile = {
      url: 'mxc://server/encrypted',
      key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
    };

    const mediaUrl = 'https://example.org/_matrix/client/v1/media/download/server/encrypted';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.decryptFile.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'decrypted response' })], {
        type: 'application/json',
      })
    );
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([new Uint8Array(32)], { type: 'application/octet-stream' })
    );

    const blob = await downloadLongTextSidecarBlob(
      mockMx,
      createLongTextSource({
        previewContent: {
          msgtype: 'm.file',
          info: { mimetype: 'application/json' },
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
        mxcUri: 'mxc://server/encrypted',
        encryptedFile,
      })
    );

    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(matrixMocks.decryptFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/json',
      encryptedFile
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(await blob.text()).toContain('"body":"decrypted response"');
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

describe('LongTextText hydration identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A warm real cache now short-circuits the mocked hydrate entirely, so
    // every test starts cold unless it warms the cache itself.
    clearLongTextHydrationCache();
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Resolved response',
      msgtype: 'm.text',
    });
  });

  it('defers sidecar hydration until hydration is enabled', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const content = createPreviewContent();
    let renderer!: ReactTestRenderer;

    const render = (hydrate: boolean) =>
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        hydrate,
        content,
        longTextSource: createLongTextSource({ previewContent: content }),
        renderBody: (_content, props) => props.body,
      });

    longTextMocks.hydrateMindroomLongTextSource.mockClear();
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Hydrated response',
      msgtype: 'm.text',
    });

    await act(async () => {
      renderer = create(render(false));
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Preview response'
    );

    await act(async () => {
      renderer.update(render(true));
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it('shows no link previews and no loading line while the preview text waits for the sidecar', async () => {
    vi.useFakeTimers();
    try {
      const { LongTextKind, LongTextText } = await getLongTextTextModule();
      const content = {
        ...createPreviewContent(),
        body: 'Preview response https://a.example/x https://b.example/y',
      };
      const sidecar = createDeferred<Record<string, unknown>>();
      longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(sidecar.promise);
      let renderer!: ReactTestRenderer;
      const urlCards = () => renderer.root.findAll((node) => node.props['data-url-card'] === true);
      const text = () => JSON.stringify(renderer.toJSON());
      await act(async () => {
        renderer = create(
          React.createElement(LongTextText, {
            kind: LongTextKind.Text,
            content,
            longTextSource: createLongTextSource({ previewContent: content }),
            renderBody: (_content, props) => props.body,
            renderUrlsPreview: (urls: string[]) =>
              urls.map((url) => React.createElement('span', { key: url, 'data-url-card': true })),
          })
        );
      });
      expect(text()).toContain('Preview response');
      expect(urlCards()).toHaveLength(0);

      // Long after the loading line's delay, the preview text still stands alone.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(text()).not.toContain('Loading full response');
      expect(urlCards()).toHaveLength(0);

      await act(async () => {
        sidecar.resolve({ msgtype: 'm.text', body: 'Full response https://a.example/x' });
        await Promise.resolve();
      });
      expect(text()).toContain('Full response');
      expect(urlCards()).toHaveLength(1);
      act(() => renderer.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['only a reply fallback', { body: '> <@alice:example.org> Previous reply\n\n' }],
    [
      'an empty paragraph',
      { body: '', format: 'org.matrix.custom.html', formatted_body: '<p></p>' },
    ],
    ['HTML in an unrendered format', { body: '', format: 'x.y', formatted_body: '<b>x</b>' }],
  ])('shows the loading line while a preview of %s waits for its sidecar', async (_, preview) => {
    vi.useFakeTimers();
    try {
      const { LongTextKind, LongTextText } = await getLongTextTextModule();
      const content = { ...createPreviewContent(), ...preview };
      longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(new Promise(() => undefined));
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          React.createElement(LongTextText, {
            kind: LongTextKind.Text,
            content,
            longTextSource: createLongTextSource({ previewContent: content }),
            renderBody: (_content, props) => props.body,
          })
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(JSON.stringify(renderer.toJSON())).toContain('Loading full response');
      act(() => renderer.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders prewarmed sidecar content on the first paint without a preview flash', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const content = createPreviewContent();
    const source = createLongTextSource({ previewContent: content });
    // Warm the REAL cache the way a thread open does before its first paint.
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    // Capture every render body so the first render (before any effect runs) is checked directly.
    const renderedBodies: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        React.createElement(LongTextText, {
          kind: LongTextKind.Text,
          content,
          longTextSource: source,
          renderBody: (_content, props) => {
            renderedBodies.push(props.body);
            return props.body;
          },
        })
      );
    });
    expect(renderedBodies[0]).toBe('Full prewarmed response');
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    // Effects settle without a re-download: the warm cache short-circuits.
    await act(async () => {});
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it('shows warm content on the render that enables hydration, before effects run', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const content = createPreviewContent();
    const source = createLongTextSource({ previewContent: content });
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    const renderedBodies: string[] = [];
    const render = (hydrate: boolean) =>
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        hydrate,
        content,
        longTextSource: source,
        renderBody: (_content, props) => {
          renderedBodies.push(props.body);
          return props.body;
        },
      });

    // Overscan mount: cold render keeps the cheap preview despite the warm
    // cache (PR #110's guard).
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(render(false));
    });
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Preview response'
    );

    // Viewport entry flips hydrate: the flip's OWN first render (before effects
    // run) must already show the cached full content without a preview flash.
    renderedBodies.length = 0;
    act(() => {
      renderer.update(render(true));
    });
    expect(renderedBodies[0]).toBe('Full prewarmed response');
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    // Effects settle without a re-download.
    await act(async () => {});
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders hydrated Markdown and a tool card while the real message stays collapsed', async () => {
    const { CollapsibleMessage } = await import('../../timeline/CollapsibleMessage');
    // React.createElement's overloads do not type a render function passed as children.
    const createCollapsibleMessageElement = React.createElement as unknown as (
      type: typeof CollapsibleMessage,
      props: Omit<React.ComponentProps<typeof CollapsibleMessage>, 'children'>,
      render: React.ComponentProps<typeof CollapsibleMessage>['children']
    ) => React.ReactElement;
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = createPreviewContent();
    const toolTrace = {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          result_preview: 'Found result',
        },
      ],
    };
    let intersectionCallback: IntersectionObserverCallback | undefined;
    let renderer!: ReactTestRenderer;

    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Hydrated **response**\n\n🔧 `search_web` [1]',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Hydrated <strong>response</strong></p><p>🔧 <code>search_web</code> [1]</p>',
      msgtype: 'm.text',
      'io.mindroom.tool_trace': toolTrace,
    });

    class MockIntersectionObserver {
      public observe = vi.fn();

      public disconnect = vi.fn();

      public constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));

    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigProvider,
            { value: {} },
            createCollapsibleMessageElement(
              CollapsibleMessage,
              { collapseMode: 'default', forceOverflowing: true },
              ({ loadFullContent }) =>
                renderAgentMessageContent({
                  displayName: 'MindRoom',
                  msgType: 'm.text',
                  content,
                  hydrateLongText: loadFullContent,
                  htmlReactParserOptions: {},
                  linkifyOpts: {},
                })
            )
          ),
          {
            createNodeMock: (element: React.ReactElement<Record<string, unknown>>) => {
              if (element.props.className === 'collapsible-content') {
                return { clientHeight: 72, scrollHeight: 160 };
              }
              return null;
            },
          }
        );
      });

      const getCollapsibleContent = () =>
        renderer.root.find(
          (node) =>
            node.type === 'div' &&
            node.props.className === 'collapsible-content' &&
            node.props['data-expanded'] === false
        );

      expect(getCollapsibleContent()).toBeDefined();
      expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();

      await act(async () => {
        intersectionCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
        await Promise.resolve();
      });

      expect(getCollapsibleContent()).toBeDefined();
      expect(renderer.root.findByType('strong').children).toContain('response');
      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toMatch(toolCountLabel(1));
      expect(rendered).not.toContain('🔧');
      expect(rendered).not.toContain('**response**');
    } finally {
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
      }
      vi.unstubAllGlobals();
    }
  });

  it('renders preview Markdown and groups consecutive tool cards before long-text hydration', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        'Preview **now**',
        '',
        '🔧 `run_shell_command` [1]',
        '',
        '',
        '🔧 `run_shell_command` [2]',
        '',
        '',
        '🔧 `run_shell_command` [3]',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByType('strong').children).toContain('now');
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toMatch(toolCountLabel(3));
    expect(rendered).not.toMatch(toolCountLabel(1));
    expect(rendered).not.toContain('🔧');
    expect(rendered).not.toContain('**now**');

    await act(async () => {
      renderer.unmount();
    });
  });

  it.each(['resolved', 'unavailable'])(
    'keeps preview tool calls grouped while details become %s',
    async (outcome) => {
      const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
      const deferred = createDeferred<Record<string, unknown>>();
      longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);
      const content = {
        ...createPreviewContent(),
        body: ['Update `notes.md`.', '', '🔧 `read_file` [1]', '', '🔧 `edit_file` [2]'].join('\n'),
      };
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigProvider,
            { value: {} },
            renderAgentMessageContent({
              fromMindroomAgent: true,
              displayName: 'MindRoom',
              msgType: 'm.text',
              content,
              htmlReactParserOptions: {},
              linkifyOpts: {},
            })
          )
        );
      });
      try {
        expect(renderer.root.findAllByType('button')).toHaveLength(1);
        expect(JSON.stringify(renderer.toJSON())).toMatch(toolCountLabel(2));
        // Collapsed groups name their tools but render no rows until opened.
        expect(
          renderer.root.findAll(
            (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
          )
        ).toHaveLength(0);
        await act(async () => {
          renderer.root.findByType('button').props.onClick();
        });
        expect(JSON.stringify(renderer.toJSON())).toContain('Still loading');
        expect(JSON.stringify(renderer.toJSON())).not.toContain('✓');

        const preview =
          longTextMocks.hydrateMindroomLongTextSource.mock.calls.at(-1)?.[0].previewContent;
        await act(async () => {
          deferred.resolve(
            outcome === 'unavailable'
              ? preview
              : {
                  ...preview,
                  formatted_body:
                    '<p>Update <code>notes.md</code>.</p><p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>edit_file</code> [2]</p>',
                  'io.mindroom.tool_trace': {
                    version: 2,
                    events: [
                      {
                        type: 'tool_call_completed',
                        tool_name: 'read_file',
                        result_preview: 'Read notes',
                      },
                      {
                        type: 'tool_call_completed',
                        tool_name: 'edit_file',
                        result_preview: 'Saved notes',
                      },
                    ],
                  },
                }
          );
        });
        const rendered = JSON.stringify(renderer.toJSON());
        expect(rendered).toMatch(toolCountLabel(2));
        expect(rendered).not.toContain('Still loading');
        expect(rendered).toContain(
          outcome === 'resolved' ? 'Saved notes' : 'Tool details unavailable'
        );
      } finally {
        await act(async () => {
          renderer.unmount();
        });
      }
    }
  );

  it('keeps narrative boundaries and code examples outside preview tool groups', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        'Use `notes.md`.',
        '',
        '🔧 `read_file` [1]',
        '',
        'Now update the file.',
        '',
        '🔧 `edit_file` [2]',
        '',
        '🔧 `read_file` [3]',
        '',
        '```',
        '🔧 `example_tool` [4]',
        '```',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });
    try {
      expect(renderer.root.findAllByType('button')).toHaveLength(2);
      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toMatch(toolCountLabel(1));
      expect(rendered).toMatch(toolCountLabel(2));
      expect(rendered).toContain('Now update the file.');
      expect(renderer.root.findByType('pre').findByType('code').children.join('')).toContain(
        '🔧 `example_tool` [4]'
      );
      expect(rendered).toContain('edit_file, read_file');
      expect(rendered).not.toContain('🔧 `edit_file`');
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('keeps tool details loading on the first render when a cold row becomes visible', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(createDeferred().promise);
    const content = createPreviewContent();
    const statuses: string[] = [];
    const render = (hydrate: boolean) =>
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        content,
        hydrate,
        longTextSource: createLongTextSource({ previewContent: content }),
        renderBody: (_content, _props, status) => {
          statuses.push(status);
          return React.createElement('span', null, status);
        },
      });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(render(false));
    });
    statuses.length = 0;
    try {
      await act(async () => {
        renderer.update(render(true));
      });
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses).not.toContain('unavailable');
      expect(renderer.root.findByType('span').children).toEqual(['loading']);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders a root tool card after escaped multi-character inline syntax', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: ['Use \\~~literal~~.', '', '🔧 `run_shell_command` [1]'].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toMatch(toolCountLabel(1));
    expect(rendered).not.toContain('🔧');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps a list-contained tool marker prefix literal before long-text hydration', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '- 🔧 `foo\\`bar` [1] trailing text',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('foo');
    expect(rendered).toContain('bar');
    expect(rendered).toContain('trailing text');
    expect(rendered).not.toMatch(toolCountLabel(1));

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps span-wrapped list-contained tool markers literal before hydration', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        '- ||🔧|| `tool` [1]',
        '1. $🔧$ `tool` [2]',
        '- ||$🔧$|| `tool` [3]',
        '1. || 🔧 || `tool` [4]',
        '- || $🔧$|| `tool` [5] **tail**',
        '1. || ||🔧 `tool` [6]',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('tool');
    expect(rendered).not.toContain('tool call');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not expose added escapes in a list-contained tool marker', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '- 🔧 \\`tool\\` [1]',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('`tool` [1]');
    expect(rendered).not.toContain('\\\\');
    expect(rendered).not.toContain('tool call');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps a reply-only long-text preview empty before hydration', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '> <@alice:example.org> Previous reply\n\n',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'empty-content' })).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Previous reply');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('trims a reply fallback only once when preview formatting falls back', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const documentBody = [
      'Intro paragraph',
      '',
      '> <@alice:example.org> Quoted detail',
      '',
      String.raw`\*`.repeat(513),
    ].join('\n');
    const content = {
      ...createPreviewContent(),
      body: `> <@bob:example.org> Original question\n\n${documentBody}`,
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Intro paragraph');
    expect(rendered).toContain('Quoted detail');
    expect(rendered).not.toContain('Original question');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not restart hydration for equivalent preview content with a new object reference', async () => {
    const content = createPreviewContent();
    const { renderer, update } = await renderLongTextText(content);

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await update({
      ...content,
      info: { ...(content.info as Record<string, unknown>) },
      'io.mindroom.long_text': {
        ...(content['io.mindroom.long_text'] ?? {}),
      },
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the previous hydrated tool trace while the next rich preview hydrates', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
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
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
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
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation((source: LongTextSource) => {
      if (source.mxcUri === 'mxc://server/stream-a') {
        return Promise.resolve({
          body: 'Hydrated A',
          formatted_body: '<p>Hydrated A</p>',
          msgtype: 'm.text',
          'io.mindroom.tool_trace': toolTrace,
        });
      }
      return secondDeferred.promise;
    });

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

describe('a finished agent reply in a sidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The preview stops partway through the answer; the sidecar holds the whole reply.
  const content = {
    ...createPreviewContent(),
    body: ['Let me look.', '', '🔧 `read_file` [1]', '', 'The answer starts'].join('\n'),
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
  };

  it.each([
    ['resolved', true],
    ['unavailable', false],
  ])('folds its work only once the sidecar is read (%s)', async (outcome, folds) => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const deferred = createDeferred<Record<string, unknown>>();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);
    const eventId = `$sidecar-${outcome}`;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            eventId,
            fromMindroomAgent: true,
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });
    const worked = () => JSON.stringify(renderer.toJSON()).includes('Worked');
    try {
      // The preview never folds, also while the sidecar loads.
      expect(worked()).toBe(false);

      const previewContent =
        longTextMocks.hydrateMindroomLongTextSource.mock.calls.at(-1)?.[0].previewContent;
      await act(async () => {
        // A sidecar that cannot be read leaves the preview.
        deferred.resolve(
          outcome === 'unavailable'
            ? previewContent
            : {
                msgtype: 'm.text',
                body: 'Let me look.\n\n🔧 `read_file` [1]\n\nThe answer starts and ends.',
                format: 'org.matrix.custom.html',
                formatted_body:
                  '<p>Let me look.</p><p>🔧 <code>read_file</code> [1]</p><p>The answer starts and ends.</p>',
                'io.mindroom.ai_run': { version: 1, status: 'completed' },
              }
        );
      });

      expect(worked()).toBe(folds);
      expect(JSON.stringify(renderer.toJSON())).toContain(
        folds ? 'The answer starts and ends.' : 'Let me look.'
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});

describe('v3 tool-trace sidecar hydration', () => {
  beforeEach(() => {
    clearLongTextHydrationCache();
    vi.clearAllMocks();
  });

  const v3WireSidecar = {
    msgtype: 'm.text',
    body: 'Checking notes.\n\nAll set.',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Checking notes.</p>\n<p>All set.</p>\n',
    'io.mindroom.tool_trace': {
      version: 3,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          args_preview: 'path=notes.txt',
          result_preview: 'Read notes successfully',
          body_line: 2,
          at: 1,
        },
      ],
    },
  };

  it('applies transformContent before MText builds props without mutating the shared MXC cache', async () => {
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
    const { sanitizeContent } = await import('../../matrix/protocol/untrustedContent');
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const mxcUri = 'mxc://server/v3-transform-unit';
    const preview = {
      ...createPreviewContent(),
      url: mxcUri,
    };
    const source = createLongTextSource({ previewContent: preview, mxcUri });

    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify(v3WireSidecar),
      mockMx
    );

    const observed: Array<{
      content: Record<string, unknown>;
      props: { body: string; customBody?: string };
    }> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(LongTextText, {
          kind: LongTextKind.Text,
          content: preview,
          longTextSource: source,
          transformContent: (downloaded) => sanitizeContent(downloaded, true),
          renderBody: (resolved, props) => {
            observed.push({ content: resolved, props });
            return React.createElement('span', null, props.customBody ?? props.body);
          },
        })
      );
    });

    try {
      const last = observed.at(-1);
      expect(last?.props.body).toContain('🔧 `read_file` [1]');
      expect(last?.props.customBody).toContain('<p>🔧 <code>read_file</code> [1]</p>');
      expect((last?.content['io.mindroom.tool_trace'] as { version?: number })?.version).toBe(2);

      // Shared MXC cache keeps raw wire v3 JSON untouched.
      const cached = actualLongText.getCachedLongTextContent(source, mockMx);
      expect(cached?.body).toBe('Checking notes.\n\nAll set.');
      expect(cached?.formatted_body).toBe('<p>Checking notes.</p>\n<p>All set.</p>\n');
      expect((cached?.['io.mindroom.tool_trace'] as { version?: number })?.version).toBe(3);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('restores v3 tool rows for a trusted agent and keeps the same cached sidecar clean for a non-agent', async () => {
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const mxcUri = 'mxc://server/v3-shared-cache';
    const preview = {
      ...createPreviewContent(),
      body: 'Checking notes...',
      url: mxcUri,
    };
    const source = createLongTextSource({ previewContent: preview, mxcUri });

    // Pre-populate the shared MXC cache with raw v3 wire JSON (sender-agnostic).
    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify(v3WireSidecar),
      mockMx
    );

    const renderForSender = async (fromMindroomAgent: boolean, eventId: string) => {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigProvider,
            { value: {} },
            renderAgentMessageContent({
              eventId,
              fromMindroomAgent,
              displayName: fromMindroomAgent ? 'MindRoom' : 'Someone',
              msgType: 'm.text',
              content: preview,
              htmlReactParserOptions: {},
              linkifyOpts: {},
            })
          )
        );
      });
      return renderer;
    };

    const agentRenderer = await renderForSender(true, '$v3-agent-1');
    try {
      const collapsed = JSON.stringify(agentRenderer.toJSON());
      expect(collapsed).toContain('Ran 1 tool call');
      expect(collapsed).toContain('read_file');
      expect(collapsed).toContain('All set.');

      await act(async () => {
        agentRenderer.root.findByType('button').props.onClick();
      });
      const expanded = JSON.stringify(agentRenderer.toJSON());
      expect(expanded).toContain('Read notes successfully');
    } finally {
      await act(async () => {
        agentRenderer.unmount();
      });
    }

    // Same cached MXC entry rendered for a non-agent sender drops tool_trace and injects no tool rows.
    const nonAgentRenderer = await renderForSender(false, '$v3-non-agent');
    try {
      const nonAgentJson = JSON.stringify(nonAgentRenderer.toJSON());
      expect(nonAgentJson).toContain('Checking notes.');
      expect(nonAgentJson).toContain('All set.');
      expect(nonAgentJson).not.toContain('Ran 1 tool call');
      expect(nonAgentJson).not.toContain('read_file');
      expect(nonAgentJson).not.toContain('Read notes successfully');
      expect(nonAgentJson).not.toContain('🔧');
    } finally {
      await act(async () => {
        nonAgentRenderer.unmount();
      });
    }

    // Shared MXC cache is still uncorrupted raw v3 wire JSON, and a subsequent agent render still restores rows.
    const cached = actualLongText.getCachedLongTextContent(source, mockMx);
    expect(cached?.formatted_body).toBe('<p>Checking notes.</p>\n<p>All set.</p>\n');
    expect((cached?.['io.mindroom.tool_trace'] as { version?: number })?.version).toBe(3);

    const agentAgainRenderer = await renderForSender(true, '$v3-agent-2');
    try {
      const agentAgainJson = JSON.stringify(agentAgainRenderer.toJSON());
      expect(agentAgainJson).toContain('Ran 1 tool call');
      expect(agentAgainJson).toContain('read_file');
    } finally {
      await act(async () => {
        agentAgainRenderer.unmount();
      });
    }
  });

  it('discards placeholder_body on a hydrated v3 tool-only sidecar for a trusted agent', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const deferred = createDeferred<Record<string, unknown>>();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);
    const preview = {
      ...createPreviewContent(),
      body: '2 tool calls',
      url: 'mxc://server/v3-placeholder-sidecar',
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            eventId: '$v3-placeholder',
            fromMindroomAgent: true,
            displayName: 'MindRoom',
            msgType: 'm.text',
            content: preview,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    try {
      await act(async () => {
        deferred.resolve({
          msgtype: 'm.text',
          body: '2 tool calls',
          format: 'org.matrix.custom.html',
          formatted_body: '<p>2 tool calls</p>\n',
          'io.mindroom.tool_trace': {
            version: 3,
            placeholder_body: true,
            events: [
              {
                type: 'tool_call_completed',
                tool_name: 'shell',
                args_preview: 'cmd=ls',
                result_preview: 'notes.txt',
                body_line: 0,
                at: 0,
              },
              {
                type: 'tool_call_completed',
                tool_name: 'read_file',
                args_preview: 'path=notes.txt',
                result_preview: 'hello world',
                body_line: 0,
                at: 0,
              },
            ],
          },
        });
      });

      expect(renderer.root.findAllByType('p')).toHaveLength(0);
      const collapsed = JSON.stringify(renderer.toJSON());
      expect(collapsed).toContain('Ran 2 tool calls');
      expect(collapsed).toContain('shell, read_file');

      await act(async () => {
        renderer.root.findByType('button').props.onClick();
      });
      const expanded = JSON.stringify(renderer.toJSON());
      expect(expanded).toContain('hello world');
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
  it('hydrates a streaming m.text sidecar whose preview body is Thinking... instead of locking on ThinkingPlaceholder', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const deferred = createDeferred<Record<string, unknown>>();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);
    const preview = {
      ...createPreviewContent(),
      body: 'Thinking...',
      url: 'mxc://server/v3-streaming-thinking-sidecar',
      'io.mindroom.stream_status': 'streaming',
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderAgentMessageContent({
            eventId: '$v3-streaming-thinking',
            fromMindroomAgent: true,
            displayName: 'MindRoom',
            msgType: 'm.text',
            content: preview,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    try {
      expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferred.resolve({
          msgtype: 'm.text',
          body: 'Thinking...',
          format: 'org.matrix.custom.html',
          formatted_body: '<p>Thinking...</p>\n',
          'io.mindroom.stream_status': 'streaming',
          'io.mindroom.tool_trace': {
            version: 3,
            placeholder_body: true,
            events: [
              {
                type: 'tool_call_started',
                tool_name: 'shell',
                args_preview: 'cmd=pwd',
                body_line: 0,
                at: 0,
              },
            ],
          },
        });
      });

      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toContain('shell');
      expect(rendered).not.toContain('Thinking...');
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('does not erase prose on a new revision preview while loading after a v3 placeholder_body sidecar', async () => {
    const { renderAgentMessageContent } = await import('./renderAgentMessageContent');
    const firstDeferred = createDeferred<Record<string, unknown>>();
    const secondDeferred = createDeferred<Record<string, unknown>>();
    longTextMocks.hydrateMindroomLongTextSource
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const firstPreview = {
      ...createPreviewContent(),
      body: 'Thinking...',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Thinking...</p>\n',
      url: 'mxc://server/v3-rev-1',
      'io.mindroom.stream_status': 'streaming',
    };
    const secondPreview = {
      ...createPreviewContent(),
      body: 'Found it.',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Found it.</p>\n',
      url: 'mxc://server/v3-rev-2',
      'io.mindroom.stream_status': 'streaming',
    };

    const renderRevision = (preview: Record<string, unknown>) =>
      React.createElement(
        ClientConfigProvider,
        { value: {} },
        renderAgentMessageContent({
          eventId: '$v3-revision-switch',
          fromMindroomAgent: true,
          displayName: 'MindRoom',
          msgType: 'm.text',
          content: preview,
          htmlReactParserOptions: {},
          linkifyOpts: {},
        })
      );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderRevision(firstPreview));
    });

    try {
      await act(async () => {
        firstDeferred.resolve({
          msgtype: 'm.text',
          body: 'Thinking...',
          format: 'org.matrix.custom.html',
          formatted_body: '<p>Thinking...</p>\n',
          'io.mindroom.stream_status': 'streaming',
          'io.mindroom.tool_trace': {
            version: 3,
            placeholder_body: true,
            events: [
              {
                type: 'tool_call_completed',
                tool_name: 'shell',
                body_line: 0,
                at: 0,
              },
            ],
          },
        });
      });

      expect(JSON.stringify(renderer.toJSON())).toContain('shell');

      // Switch to revision 2 while its sidecar is still in flight: its prose must stay intact.
      await act(async () => {
        renderer.update(renderRevision(secondPreview));
      });

      const whileLoading = JSON.stringify(renderer.toJSON());
      expect(whileLoading).toContain('Found it.');
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});

describe('useLongTextResolvedContent', () => {
  beforeEach(async () => {
    clearLongTextHydrationCache();
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );

    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      actualLongText.hydrateLongTextSource
    );
  });

  it('returns cached content synchronously without fetching again', async () => {
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
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

    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify(resolvedContent),
      mockMx
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    expect(onResolvedContent).toHaveBeenCalledWith(resolvedContent);
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

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
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

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

    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify(resolvedContent)], {
        type: 'application/json',
      })
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
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

    matrixMocks.networkBody.mockImplementation(() => deferred.promise);

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
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>(
      '../../matrix/protocol/longText'
    );
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

    await actualLongText.hydrateLongTextSource(
      sourceA,
      async () => JSON.stringify(resolvedContentA),
      mockMx
    );
    matrixMocks.networkBody.mockImplementation(() => deferred.promise);

    const { getProbeText, renderer, update } = await renderResolvedContentDomProbe(sourceA, true);

    expect(getProbeText()).toBe(JSON.stringify(resolvedContentA));
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

    const { renderPhaseValues } = await update(sourceB, true);

    expect(renderPhaseValues[0]).toBeUndefined();
    expect(getProbeText()).toBe('EMPTY');
    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.networkBody).toHaveBeenCalledTimes(1);

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
