import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../matrix/types/common';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { trimReplyFromBody } from '../../matrix/room';
import { MINDROOM_MESSAGE_EXTRAS_KEY, parseMessageExtras } from '../../matrix/protocol/messageExtrasData';
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
  const actual = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
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
    renderAfterBody,
    renderBody,
  }: {
    content: Record<string, unknown>;
    renderAfterBody?: React.ReactNode;
    renderBody: (props: { body: string; customBody?: string }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'long-text-body' },
      renderBody({
        body: trimReplyFromBody(typeof content.body === 'string' ? content.body : ''),
        customBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
      }),
      renderAfterBody
    ),
}));
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

vi.mock('../agent-run/Reasoning.css', () => ({}));
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
vi.mock('../MessageExtras', () => ({
  MessageExtras: () => null,
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
vi.mock('../thread-summary/ThreadSummaryCard', () => ({
  ThreadSummaryCard: () => null,
}));
vi.mock('../../approvals/ToolApprovalCard', () => ({
  ToolApprovalCard: () => null,
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

const getDownloadLongTextSidecarText = async () =>
  (await import('./longTextDownload')).downloadLongTextSidecarText;
const getDownloadLongTextSidecarBlob = async () =>
  (await import('./longTextDownload')).downloadLongTextSidecarBlob;
const getLongTextTextModule = async () => import('./LongTextText');
const getShouldResetResolvedContentToPreview = async () =>
  (await import('./LongTextText')).shouldResetResolvedContentToPreview;
const mockMx = hookMocks.mx as MatrixClient;

const createLongTextSource = (
  overrides: Partial<LongTextSource> = {}
): LongTextSource => ({
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

describe('downloadLongTextSidecarText', () => {
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
    const downloadLongTextSidecarText = await getDownloadLongTextSidecarText();
    // A homeserver without authenticated media gets the legacy URL.
    reportVersions([]);
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    const text = await downloadLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"full response"');
  });

  it('authenticates unencrypted sidecar downloads without relying on the service worker', async () => {
    const downloadLongTextSidecarText = await getDownloadLongTextSidecarText();
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

    await downloadLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', true);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('does not send the access token to a media URL outside the homeserver', async () => {
    const downloadLongTextSidecarText = await getDownloadLongTextSidecarText();
    const mediaUrl = 'https://media.example.net/_matrix/client/v1/media/download/server/content';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.networkBody.mockResolvedValue(
      new Blob(['{"msgtype":"m.text","body":"body"}'], { type: 'application/json' })
    );

    await downloadLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl);
  });

  it('downloads sidecar blob for unencrypted content', async () => {
    const downloadLongTextSidecarBlob = await getDownloadLongTextSidecarBlob();
    reportVersions([]);
    const blob = new Blob(['raw-content'], { type: 'application/json' });
    matrixMocks.networkBody.mockResolvedValue(blob);

    const downloadedBlob = await downloadLongTextSidecarBlob(
      mockMx,
      createLongTextSource(),
      true
    );

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(downloadedBlob.type).toBe(blob.type);
    expect(await downloadedBlob.text()).toBe('raw-content');
  });

  it('downloads encrypted sidecar cipher bytes and decrypts only the consumer blob', async () => {
    const downloadLongTextSidecarText = await getDownloadLongTextSidecarText();
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

    const text = await downloadLongTextSidecarText(
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

  it('renders prewarmed sidecar content on the first paint without a preview flash', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const content = createPreviewContent();
    const source = createLongTextSource({ previewContent: content });
    // Warm the REAL cache the way the prewarm pool does.
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    // No act(): this inspects the FIRST render, before any effect runs.
    const renderer = create(
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        content,
        longTextSource: source,
        renderBody: (_content, props) => props.body,
      })
    );
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
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
    await actualLongText.hydrateLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    const render = (hydrate: boolean) =>
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        hydrate,
        content,
        longTextSource: source,
        renderBody: (_content, props) => props.body,
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

    // Viewport entry flips hydrate: the flip's OWN render (no act, effects
    // not yet flushed) must already show the cached full content.
    renderer.update(render(true));
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
            React.createElement(
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
            createNodeMock: (element) => {
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
        ...((content['io.mindroom.long_text'] as Record<string, unknown>) ?? {}),
      },
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps preview extras available when hydrated content omits them', async () => {
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
    const previewContent = {
      ...createPreviewContent(),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('preview extra'),
    };
    const deferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);

    await act(async () => {
      renderer = create(
        React.createElement(LongTextText, {
          kind: LongTextKind.Text,
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
    const { LongTextKind, LongTextText } = await getLongTextTextModule();
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
      React.createElement(LongTextText, {
        kind: LongTextKind.Text,
        content: nextContent,
        longTextSource: createLongTextSource({ previewContent: nextContent }),
        renderBody: (_content, props) => props.body,
        renderAfterBody: (extrasContent, fallbackContent) =>
          React.createElement(
            'span',
            { 'data-testid': 'extras-probe' },
            parseMessageExtras(extrasContent)?.sections[0]?.content ??
              (!(MINDROOM_MESSAGE_EXTRAS_KEY in extrasContent)
                ? parseMessageExtras(fallbackContent)?.sections[0]?.content
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
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      (source: LongTextSource) => {
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

describe('useLongTextResolvedContent', () => {
  beforeEach(async () => {
    clearLongTextHydrationCache();
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );

    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      actualLongText.hydrateLongTextSource
    );
  });

  it('returns cached content synchronously without fetching again', async () => {
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
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
    const actualLongText = await vi.importActual<typeof import('../../matrix/protocol/longText')>('../../matrix/protocol/longText');
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
