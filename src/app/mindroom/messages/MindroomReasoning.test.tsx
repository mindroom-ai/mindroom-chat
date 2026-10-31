import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { loadLiveMarkdown, renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { renderMindroomMessageContent } from './renderMindroomMessageContent';

// The real renderer, watched for when it is requested.
vi.mock('../live/liveMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live/liveMarkdown')>();
  return {
    ...actual,
    renderLiveMarkdown: vi.fn(actual.renderLiveMarkdown),
    useLiveMarkdownReady: vi.fn(actual.useLiveMarkdownReady),
  };
});

// The real RenderBody under an MText that renders the body, then what comes after it.
vi.mock('../../components/message', async () => {
  const { RenderBody } = await import('../../components/message/RenderBody');
  return {
    BrokenContent: () => null,
    MEmote: () => null,
    MNotice: ({ content, renderBody, renderAfterBody }: any) =>
      React.createElement(
        'div',
        { 'data-notice': true },
        renderBody({ body: content.body, customBody: content.formatted_body }),
        renderAfterBody
      ),
    MText: ({ content, renderBody, renderAfterBody }: any) =>
      React.createElement(
        'div',
        null,
        renderBody({ body: content.body, customBody: content.formatted_body }),
        renderAfterBody
      ),
    RenderBody,
  };
});
vi.mock('../../components/message/content', () => ({ MessageEmptyContent: () => null }));
vi.mock('../../plugins/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));
vi.mock('./StreamingIndicator', () => ({ renderMindroomStreamingIndicator: () => null }));
vi.mock('./MindroomThreadSummaryCard', () => ({ MindroomThreadSummaryCard: () => null }));
vi.mock('./MindroomToolApprovalCard', () => ({ MindroomToolApprovalCard: () => null }));
vi.mock('./MindroomPasteAttachmentContent', () => ({ MindroomPasteAttachmentContent: () => null }));
vi.mock('./MindroomThinkingPlaceholder', () => ({
  MindroomThinkingPlaceholder: () => React.createElement('span', null, 'Thinking placeholder'),
}));
// The long-text renderer renders the preview content it gets, as before its sidecar loads.
vi.mock('./MindroomLongTextText', () => ({
  MindroomLongTextKind: { Text: 'text', Emote: 'emote', Notice: 'notice' },
  MindroomLongTextText: ({ content, renderBody }: any) =>
    renderBody(content, { body: content.body, customBody: content.formatted_body }, 'ready'),
}));
vi.mock('./ApprovalArgumentFields.css', () => ({}));
vi.mock('./MindroomHtmlBlocks.css', () => ({
  Block: 'Block',
  BlockBody: 'BlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'BlockHeader',
  BlockHeaderMeta: 'BlockHeaderMeta',
}));
vi.mock('./PendingSendIndicator.css', () => ({ Container: 'PendingSendIndicator' }));
vi.mock('./MindroomTranscribingPlaceholder.css', () => ({}));
vi.mock('./MindroomMessageExtras.css.ts', () => ({}));

const htmlReactParserOptions: HTMLReactParserOptions = {};

// The rendered text in document order; markdown-it ends each block with a line break.
const text = (node: unknown): string => textWithBreaks(node).replace(/\n/g, '');
const textWithBreaks = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textWithBreaks).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return textWithBreaks((node as { children: unknown }).children ?? []);
  }
  return '';
};

describe('MindroomReasoning', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (content: Record<string, unknown>, msgType = 'm.text') => {
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          {renderMindroomMessageContent({
            displayName: 'Agent',
            msgType,
            content,
            htmlReactParserOptions,
            linkifyOpts: {},
          })}
        </ClientConfigProvider>
      );
    });
    if (!renderer) throw new Error('Nothing rendered');
    return renderer.root;
  };

  const header = (root: ReturnType<typeof render>) =>
    root.find((node) => node.type === 'button' && node.props.className === 'BlockHeader');

  it('shows final reasoning collapsed with its duration, and expands it on click', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': { text: 'Compared **two** caches', duration_ms: 2600 },
    });

    expect(text(header(root))).toBe('Thought for 3 s');
    expect(header(root).props['aria-expanded']).toBe(false);
    expect(root.findAllByType('strong')).toHaveLength(0);

    act(() => header(root).props.onClick());

    expect(header(root).props['aria-expanded']).toBe(true);
    expect(text(root.findByType('strong'))).toBe('two');
  });

  it('requests the Markdown renderer for final reasoning only once it is expanded', () => {
    vi.mocked(renderLiveMarkdown).mockClear();
    vi.mocked(useLiveMarkdownReady).mockClear();
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.reasoning': { text: 'Compared **two** caches', duration_ms: 2600 },
    });

    expect(useLiveMarkdownReady).not.toHaveBeenCalled();
    expect(renderLiveMarkdown).not.toHaveBeenCalled();

    act(() => header(root).props.onClick());

    expect(useLiveMarkdownReady).toHaveBeenCalled();
    expect(renderLiveMarkdown).toHaveBeenCalledWith('Compared **two** caches');
  });

  it('rounds a short reasoning time up to one second', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.reasoning': { text: 'Quick', duration_ms: 120 },
    });

    expect(text(header(root))).toBe('Thought for 1 s');
  });

  it('shows live reasoning expanded above the body and live activity below it', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Checking the cache',
      'io.mindroom.live_activity': 'Preparing isolated worker... 3s elapsed.',
    });

    expect(text(header(root))).toBe('Thinking');
    expect(header(root).props['aria-expanded']).toBe(true);
    expect(text(root)).toBe(
      'ThinkingChecking the cachePartial answerPreparing isolated worker... 3s elapsed.'
    );
  });

  it('keeps live reasoning over a covering checkpoint on a long-text reply', () => {
    const root = render({
      msgtype: 'm.text',
      body: '* Long partial answer',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'Long partial answer',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        'io.mindroom.stream_status': 'streaming',
        'io.mindroom.live_checkpoint': { sid: '1761858000123-0a1b2c3d', seq: 4 },
      },
      'io.mindroom.live_reasoning': 'Checking the cache',
    });

    expect(text(header(root))).toBe('Thinking');
    expect(text(root)).toBe('ThinkingChecking the cacheLong partial answer');
  });

  it('keeps multi-paragraph reasoning in one column', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'First thought.\n\nSecond thought.',
    });

    const [blockBody] = root.findAll(
      (node) => typeof node.type === 'string' && String(node.props.className).includes('BlockBody')
    );
    // One host element holds the paragraphs, so the row layout of the block body cannot split them.
    const [reasoningText] = blockBody.children as ReactTestInstance[];
    expect(blockBody.children).toHaveLength(1);
    expect(reasoningText.children).toHaveLength(1);
    expect((reasoningText.children[0] as ReactTestInstance).type).toBe('div');
    expect(text(blockBody)).toBe('First thought.Second thought.');
  });

  it('shows live reasoning and activity around the thinking placeholder', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Planning',
      'io.mindroom.live_activity': 'Starting worker',
    });

    expect(text(root)).toBe('ThinkingPlanningThinking placeholderStarting worker');
  });

  it('shows reasoning on notices too', () => {
    const root = render(
      {
        msgtype: 'm.notice',
        body: 'Notice answer',
        'io.mindroom.reasoning': { text: 'Thought', duration_ms: 4000 },
      },
      'm.notice'
    );

    expect(text(header(root))).toBe('Thought for 4 s');
  });

  it('shows nothing extra without reasoning or activity', () => {
    const root = render({ msgtype: 'm.text', body: 'Plain' });

    expect(root.findAll((node) => node.props.className === 'BlockHeader')).toHaveLength(0);
    expect(text(root)).toBe('Plain');
  });
});
