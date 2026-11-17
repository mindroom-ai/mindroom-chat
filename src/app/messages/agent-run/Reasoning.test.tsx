import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { loadLiveMarkdown, renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { renderAgentMessageContent } from '../content/renderAgentMessageContent';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { showToolCalls } from '../../../test/utils/showToolCalls';

// The real renderer, watched for when it is requested.
vi.mock('../live/liveMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live/liveMarkdown')>();
  return {
    ...actual,
    renderLiveMarkdown: vi.fn(actual.renderLiveMarkdown),
    useLiveMarkdownReady: vi.fn(actual.useLiveMarkdownReady),
  };
});

// The real sanitizer, watched for when a body is parsed: RenderBody passes the link schemes too.
vi.mock('../../rich-text/sanitize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../rich-text/sanitize')>();
  return { ...actual, sanitizeCustomHtml: vi.fn(actual.sanitizeCustomHtml) };
});

// The real RenderBody under an MText that renders the body, then what comes after it.
vi.mock('../content/MsgTypeRenderers', async () => {
  return {
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
  };
});
vi.mock('../content/RenderBody', async () => {
  const { RenderBody } = await import('../content/RenderBody');
  return {
    RenderBody,
  };
});
vi.mock('../content/BrokenContent', async () => {
  return {
    BrokenContent: () => null,
  };
});
vi.mock('../content/FallbackContent', () => ({ MessageEmptyContent: () => null }));
vi.mock('../html/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));
vi.mock('./StreamingIndicator', () => ({ renderStreamingIndicator: () => null }));
vi.mock('../thread-summary/ThreadSummaryCard', () => ({ ThreadSummaryCard: () => null }));
vi.mock('../../approvals/ToolApprovalCard', () => ({ ToolApprovalCard: () => null }));
vi.mock('../content/PasteAttachmentContent', () => ({ PasteAttachmentContent: () => null }));
vi.mock('./ThinkingPlaceholder', () => ({
  ThinkingPlaceholder: () => React.createElement('span', null, 'Thinking placeholder'),
}));
// The long-text renderer renders the preview content it gets, as before its sidecar loads.
vi.mock('../content/LongTextText', () => ({
  LongTextKind: { Text: 'text', Emote: 'emote', Notice: 'notice' },
  LongTextText: ({ content, renderBody }: any) =>
    renderBody(content, { body: content.body, customBody: content.formatted_body }, 'ready'),
}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));
vi.mock('../html/HtmlBlocks.css', () => ({
  Block: 'Block',
  BlockBody: 'BlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'BlockHeader',
  BlockHeaderMeta: 'BlockHeaderMeta',
}));
vi.mock('./Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Line: 'ReasoningLine',
  Toggle: 'ReasoningToggle',
  BulbIcon: 'ReasoningBulbIcon',
  Bulb: 'ReasoningBulb',
  CogRow: 'ReasoningCogRow',
  CollapseEnd: 'ReasoningCollapseEnd',
  Label: 'ReasoningLabel',
  Chevron: 'ReasoningChevron',
  Segment: 'ReasoningSegment',
  Rail: 'ReasoningRail',
  Body: 'ReasoningBody',
  ActivityCode: 'Code',
}));
vi.mock('../../ui/PendingSendIndicator.css', () => ({ Container: 'PendingSendIndicator' }));
vi.mock('./TranscribingPlaceholder.css', () => ({}));
vi.mock('../MessageExtras.css.ts', () => ({}));

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
    vi.useRealTimers();
  });

  const element = (content: Record<string, unknown>, msgType = 'm.text') => (
    <ClientConfigProvider value={{}}>
      {renderAgentMessageContent({
        displayName: 'Agent',
        msgType,
        content,
        htmlReactParserOptions,
        linkifyOpts: {},
      })}
    </ClientConfigProvider>
  );

  // Each button records its class when it takes the focus.
  const focused: string[] = [];

  const render = (content: Record<string, unknown>, msgType = 'm.text') => {
    act(() => {
      renderer = create(element(content, msgType), {
        createNodeMock: (node) =>
          node.type === 'button'
            ? { focus: () => focused.push(node.props.className as string) }
            : null,
      });
    });
    if (!renderer) throw new Error('Nothing rendered');
    return renderer.root;
  };

  const LIVE = 'io.mindroom.live_reasoning';

  /**
   * A reply on screen whose live reasoning just grew to what `content` holds, as a frame grows it:
   * the model is writing its last segment.
   */
  const renderThinking = (content: Record<string, unknown>) => {
    const root = render({ ...content, [LIVE]: String(content[LIVE]).slice(0, 1) });
    act(() => renderer?.update(element(content)));
    return root;
  };

  const header = (root: ReturnType<typeof render>) =>
    root.find((node) => node.type === 'button' && node.props.className === 'ReasoningToggle');

  const blockBody = (root: ReturnType<typeof render>) =>
    root.find((node) => typeof node.type === 'string' && node.props.className === 'ReasoningBody');

  it('shows final reasoning collapsed with its duration, and expands it on click', async () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': { text: 'Compared **two** caches', duration_ms: 2600 },
    });

    expect(text(header(root))).toBe('Thought for 3 s');
    expect(header(root).props['aria-expanded']).toBe(false);
    expect(root.findAllByType('strong')).toHaveLength(0);

    await act(() => header(root).props.onClick());

    expect(header(root).props['aria-expanded']).toBe(true);
    expect(text(root.findByType('strong'))).toBe('two');
  });

  it('requests the Markdown renderer for final reasoning only once it is expanded', async () => {
    vi.mocked(renderLiveMarkdown).mockClear();
    vi.mocked(useLiveMarkdownReady).mockClear();
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.reasoning': { text: 'Compared **two** caches', duration_ms: 2600 },
    });

    expect(useLiveMarkdownReady).not.toHaveBeenCalled();
    expect(renderLiveMarkdown).not.toHaveBeenCalled();

    await act(() => header(root).props.onClick());

    expect(useLiveMarkdownReady).toHaveBeenCalled();
    expect(renderLiveMarkdown).toHaveBeenCalledWith('Compared **two** caches');
  });

  it('renders unchanged live reasoning once, until the answer streams on past it', () => {
    vi.mocked(renderLiveMarkdown).mockClear();
    const streaming = (body: string) => ({
      msgtype: 'm.text',
      body,
      'io.mindroom.stream_status': 'streaming',
      [LIVE]: 'Checking the cache',
    });
    const root = renderThinking(streaming('Partial'));

    // The next frame carries the same reasoning and body again.
    act(() => renderer?.update(element(streaming('Partial'))));

    // The header, then the segment being written with its own label.
    expect(text(root)).toBe('ThinkingThinkingChecking the cachePartial');
    expect(renderLiveMarkdown).toHaveBeenCalledTimes(1);

    // A plain body counts as the reply moving on too.
    act(() => renderer?.update(element(streaming('Partial answer'))));

    expect(text(root)).toBe('ThinkingPartial answer');
  });

  const finished = {
    msgtype: 'm.text',
    body: 'Answer',
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': { text: 'Checking the cache', duration_ms: 2000 },
  };

  it('hides the segment being written into the bulb once the reply finishes', () => {
    const root = renderThinking({
      msgtype: 'm.text',
      body: 'Partial',
      'io.mindroom.stream_status': 'streaming',
      [LIVE]: 'Checking the cache',
    });
    expect(header(root).props['aria-expanded']).toBe(false);
    expect(text(root)).toContain('Checking the cache');

    act(() => renderer?.update(element(finished)));

    expect(text(header(root))).toBe('Thought for 2 s');
    expect(header(root).props['aria-expanded']).toBe(false);
    expect(text(root)).toBe('Thought for 2 sAnswer');
  });

  it('keeps a bulb that was opened while the reply streamed open once it finishes', async () => {
    const root = renderThinking({
      msgtype: 'm.text',
      body: 'Partial',
      'io.mindroom.stream_status': 'streaming',
      [LIVE]: 'Checking the cache',
    });
    await act(() => header(root).props.onClick());

    act(() => renderer?.update(element(finished)));

    expect(header(root).props['aria-expanded']).toBe(true);
    // The top-level time is the header's; a reply without segments has none for its one segment.
    expect(text(root)).toBe('Thought for 2 sThoughtChecking the cacheHide thinkingAnswer');
  });

  it('rounds a short reasoning time up to one second', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.reasoning': { text: 'Quick', duration_ms: 120 },
    });

    expect(text(header(root))).toBe('Thought for 1 s');
  });

  it('shows the reasoning being written above the body and live activity below it', () => {
    const root = renderThinking({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Checking the cache',
      'io.mindroom.live_activity': 'Preparing isolated worker... 3s elapsed.',
    });

    expect(text(header(root))).toBe('Thinking');
    // The bulb is closed: only what the model writes now shows, and nothing offers to hide it.
    expect(header(root).props['aria-expanded']).toBe(false);
    expect(text(root)).toBe(
      'ThinkingThinkingChecking the cachePartial answerPreparing isolated worker... 3s elapsed.'
    );
  });

  it('shows no reasoning under a closed bulb when a reply that has some comes into view', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Checking the cache',
    });

    expect(text(root)).toBe('ThinkingPartial answer');
  });

  it('shows the tool names in live activity as inline code', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_activity':
        '⏳ Preparing isolated worker for `shell.run_shell_command`, `python`... 35s elapsed.',
    });

    expect(root.findAllByType('code').map((node) => [node.props.className, text(node)])).toEqual([
      ['Code', 'shell.run_shell_command'],
      ['Code', 'python'],
    ]);
    expect(text(root)).toBe(
      'Partial answer⏳ Preparing isolated worker for shell.run_shell_command, python... 35s elapsed.'
    );
  });

  it('keeps the backticks of a failure line error as sent', () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_activity':
        "⚠️ Worker startup failed for `shell`: can't run `a < b`.\n⏳ Preparing isolated worker for `python`...",
    });

    expect(root.findAllByType('code').map((node) => text(node))).toEqual(['shell', 'python']);
    expect(text(root)).toBe(
      "Partial answer⚠️ Worker startup failed for shell: can't run `a < b`.⏳ Preparing isolated worker for python..."
    );
  });

  it('keeps live reasoning over a covering checkpoint on a long-text reply', () => {
    const root = renderThinking({
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
    expect(text(root)).toBe('ThinkingThinkingChecking the cacheLong partial answer');
  });

  // The element of a segment's text, after its label: it sets how the text keeps newlines.
  const reasoningText = (root: ReturnType<typeof render>) =>
    (blockBody(root).children as ReactTestInstance[])[1]!;

  it('keeps multi-paragraph reasoning in one column', () => {
    const root = renderThinking({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'First thought.\n\nSecond thought.',
    });

    const body = blockBody(root);
    // The label, then one host element that holds the paragraphs.
    expect(body.children).toHaveLength(2);
    expect(reasoningText(root).children).toHaveLength(1);
    expect((reasoningText(root).children[0] as ReactTestInstance).type).toBe('div');
    expect(text(reasoningText(root))).toBe('First thought.Second thought.');
  });

  it('keeps newlines only for reasoning the Markdown renderer has not rendered', async () => {
    // A plain body has no HTML, so the message body around the reasoning keeps newlines.
    const content = {
      msgtype: 'm.text',
      body: 'Answer',
      'io.mindroom.reasoning': { text: 'Line one\nline two' },
    };
    const wrapper = (root: ReturnType<typeof render>) =>
      reasoningText(root).children[0] as ReactTestInstance;

    let root = render(content);
    await act(() => header(root).props.onClick());
    expect(wrapper(root).props.style).toEqual({ whiteSpace: 'normal' });

    act(() => renderer?.unmount());
    root = render(content);
    vi.mocked(useLiveMarkdownReady).mockReturnValueOnce(false);
    await act(() => header(root).props.onClick());
    expect(wrapper(root).props.style).toEqual({ whiteSpace: 'pre-wrap' });
  });

  it('shows direction controls as code points in plain reasoning and in live activity', async () => {
    const root = render({
      msgtype: 'm.text',
      body: 'Partial answer',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.reasoning': { text: 'Run \u202emr- hs\u202c next' },
      'io.mindroom.live_activity': 'Running `sh\u202enur` on \u202eatad\u202c...',
    });
    // Before the Markdown renderer loads, reasoning shows as plain lines.
    vi.mocked(useLiveMarkdownReady).mockReturnValueOnce(false);
    await act(() => header(root).props.onClick());

    expect(text(reasoningText(root))).toBe('Run <U+202E>mr- hs<U+202C> next');
    expect(root.findAllByType('code').map((node) => text(node))).toEqual(['sh<U+202E>nur']);
    expect(text(root)).toContain('Running sh<U+202E>nur on <U+202E>atad<U+202C>...');
  });

  it('shows live reasoning and activity around the thinking placeholder', () => {
    const root = renderThinking({
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Planning',
      'io.mindroom.live_activity': 'Starting worker',
    });

    expect(text(root)).toBe('ThinkingThinkingPlanningThinking placeholderStarting worker');
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

    expect(root.findAll((node) => node.props.className === 'ReasoningToggle')).toHaveLength(0);
    expect(text(root)).toBe('Plain');
  });

  describe('segments where they happened', () => {
    // These tests show the runs of tool calls the segments sit between.
    beforeEach(showToolCalls);

    const marker = (name: string, index: number) => `<p>🔧 <code>${name}</code> [${index}]</p>`;
    const THOUGHTS = ['Plan the search.', 'The cache is stale.', 'So the fix is small.'];
    const REASONING = THOUGHTS.join('\n\n');
    const starts = THOUGHTS.map((thought) => REASONING.indexOf(thought));

    /** A finished reply of four tool calls that thought before the first, after the third and after the last. */
    const reply = (segments: unknown): Record<string, unknown> => ({
      msgtype: 'm.text',
      body: 'Read, searched and ran.',
      format: 'org.matrix.custom.html',
      formatted_body: [
        marker('read_file', 1),
        marker('grep', 2),
        marker('grep', 3),
        '<p>Found it.</p>',
        marker('shell', 4),
        '<p>Done.</p>',
      ].join(''),
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': { text: REASONING, duration_ms: 11_400, segments },
    });
    const SEGMENTS = [
      { start: starts[0], after_tool: 0, duration_ms: 4200 },
      { start: starts[1], after_tool: 3, duration_ms: 3900 },
      { start: starts[2], after_tool: 4 },
    ];

    const segmentTexts = (root: ReturnType<typeof render>) =>
      root
        .findAll((node) => node.type === 'div' && node.props.className === 'ReasoningSegment')
        .map((node) => text(node));
    const rails = (root: ReturnType<typeof render>) =>
      root.findAll((node) => node.type === 'button' && node.props.className === 'ReasoningRail');
    const ends = (root: ReturnType<typeof render>) =>
      root.findAll(
        (node) => node.type === 'button' && node.props.className === 'ReasoningCollapseEnd'
      );

    // How often the body was parsed: RenderBody sanitizes it with the link schemes.
    const bodyParses = () =>
      vi.mocked(sanitizeCustomHtml).mock.calls.filter((call) => call.length > 1).length;

    it('does not parse the body again when the bulb shows segments at the top only', async () => {
      const root = render(reply(undefined));
      const parses = bodyParses();
      expect(parses).toBeGreaterThan(0);

      await act(() => header(root).props.onClick());

      expect(segmentTexts(root)).toHaveLength(1);
      expect(bodyParses()).toBe(parses);
    });

    it('shows no segment under a closed bulb, whose label keeps the whole time', () => {
      const root = render(reply(SEGMENTS));

      expect(text(header(root))).toBe('Thought for 12 s');
      expect(header(root).props['aria-expanded']).toBe(false);
      expect(segmentTexts(root)).toEqual([]);
      THOUGHTS.forEach((thought) => expect(text(root)).not.toContain(thought));
    });

    it('shows every segment where it happened once the bulb opens, and hides them again', async () => {
      const root = render(reply(SEGMENTS));

      await act(() => header(root).props.onClick());

      expect(header(root).props['aria-expanded']).toBe(true);
      // Each segment with its own time, the last one without: the header keeps the whole.
      expect(segmentTexts(root)).toEqual([
        'Thought for 5 sPlan the search.Hide thinking',
        'Thought for 4 sThe cache is stale.Hide thinking',
        'ThoughtSo the fix is small.Hide thinking',
      ]);
      const order = [
        'Plan the search.',
        'read_file, grep ×2',
        'The cache is stale.',
        'Found it.',
        'shell',
        'So the fix is small.',
        'Done.',
      ].map((part) => text(root).indexOf(part));
      expect(order).not.toContain(-1);
      expect(order).toEqual([...order].sort((a, b) => a - b));

      await act(() => header(root).props.onClick());

      expect(header(root).props['aria-expanded']).toBe(false);
      expect(segmentTexts(root)).toEqual([]);
    });

    it.each([
      ['rail', rails],
      ['button at the end', ends],
    ])(
      'hides every segment from the %s of one, and gives the bulb the focus',
      async (_name, of) => {
        const root = render(reply(SEGMENTS));
        await act(() => header(root).props.onClick());
        focused.length = 0;
        const buttons = of(root);
        expect(buttons).toHaveLength(3);
        expect(rails(root).map((rail) => rail.props['aria-label'])).toEqual(
          Array(3).fill('Hide thinking')
        );

        await act(() => buttons[1]!.props.onClick());

        expect(segmentTexts(root)).toEqual([]);
        expect(header(root).props['aria-expanded']).toBe(false);
        expect(focused).toEqual(['ReasoningToggle']);
      }
    );

    it('shows a reply without segments as one segment at the top', async () => {
      const root = render(reply(undefined));

      await act(() => header(root).props.onClick());

      expect(segmentTexts(root)).toEqual([`Thought${THOUGHTS.join('')}Hide thinking`]);
      expect(text(root).indexOf(THOUGHTS[2]!)).toBeLessThan(text(root).indexOf('read_file'));
    });

    it('places a segment after the last marker that renders as a run, not one inside code', async () => {
      const content = {
        ...reply([
          { start: starts[0], after_tool: 0 },
          { start: starts[1], after_tool: 2 },
        ]),
        // The second marker is code the reply quotes: no run of calls renders for it.
        formatted_body: `${marker(
          'read_file',
          1
        )}<pre><code>🔧 \`grep\` [2]</code></pre><p>Done.</p>`,
      };
      const root = render(content);

      await act(() => header(root).props.onClick());

      const order = ['read_file', 'The cache is stale.', '🔧 `grep` [2]', 'Done.'].map((part) =>
        text(root).indexOf(part)
      );
      expect(order).not.toContain(-1);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    describe('while the reply streams', () => {
      const streaming = (reasoning: string, segments: unknown) => ({
        msgtype: 'm.text',
        body: 'Reading.',
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Reading.</p>${marker('read_file', 1)}`,
        'io.mindroom.stream_status': 'streaming',
        [LIVE]: reasoning,
        'io.mindroom.live_reasoning_segments': segments,
      });
      const LIVE_SEGMENTS = [
        { start: starts[0], after_tool: 0 },
        { start: starts[1], after_tool: 1 },
      ];
      const twoThoughts = THOUGHTS.slice(0, 2).join('\n\n');

      it('shows only the segment being written, at the end, under a closed bulb', () => {
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));

        expect(header(root).props['aria-expanded']).toBe(false);
        expect(segmentTexts(root)).toEqual(['ThinkingThe cache is stale.']);
        expect(text(root).indexOf('read_file')).toBeLessThan(
          text(root).indexOf('The cache is stale.')
        );
        // Nothing hides what only shows while it is written.
        expect(rails(root).map((rail) => rail.props.disabled)).toEqual([true]);
        expect(ends(root)).toEqual([]);
      });

      it('shows the earlier segments too once the bulb opens', async () => {
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));

        await act(() => header(root).props.onClick());

        expect(segmentTexts(root)).toEqual([
          'ThoughtPlan the search.Hide thinking',
          'ThinkingThe cache is stale.Hide thinking',
        ]);
      });

      it.each([
        ['bulb', (root: ReturnType<typeof render>) => header(root)],
        ['rail', (root: ReturnType<typeof render>) => rails(root).at(-1)],
        ['button at the end', (root: ReturnType<typeof render>) => ends(root).at(-1)],
      ])('shows no segment once the %s closes the bulb, also while the model writes on', async (_name, closer) => {
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));
        await act(() => header(root).props.onClick());
        await act(() => closer(root)?.props.onClick());

        expect(header(root).props['aria-expanded']).toBe(false);
        expect(segmentTexts(root)).toEqual([]);

        act(() => renderer?.update(element(streaming(`${twoThoughts} Clear it.`, LIVE_SEGMENTS))));

        expect(segmentTexts(root)).toEqual([]);

        // Opened again, the bulb shows the segment being written as such.
        await act(() => header(root).props.onClick());

        expect(segmentTexts(root)).toEqual([
          'ThoughtPlan the search.Hide thinking',
          'ThinkingThe cache is stale. Clear it.Hide thinking',
        ]);
      });

      it('shows no segment while the one the model began has no text yet', () => {
        // The thought before it ended when the tool call came, and stays in the bulb.
        const root = render(streaming(twoThoughts, LIVE_SEGMENTS));
        const begun = [...LIVE_SEGMENTS, { start: twoThoughts.length + 1, after_tool: 1 }];
        act(() => renderer?.update(element(streaming(`${twoThoughts}\n\n`, begun))));

        expect(segmentTexts(root)).toEqual([]);

        act(() => renderer?.update(element(streaming(`${twoThoughts}\n\nSo`, begun))));

        expect(segmentTexts(root)).toEqual(['ThinkingSo']);
      });

      const comet = (root: ReturnType<typeof render>) =>
        root.find((node) => node.props.className === 'ReasoningBulbIcon').props['data-thinking'];

      it('keeps the segment being written open while the model pauses, without parsing the body again', () => {
        vi.useFakeTimers();
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));
        expect(comet(root)).toBe(true);
        const parses = bodyParses();
        expect(parses).toBeGreaterThan(0);

        act(() => {
          vi.advanceTimersByTime(5000);
        });
        // The next frame carries the same reasoning and body again.
        act(() => renderer?.update(element(streaming(twoThoughts, LIVE_SEGMENTS))));

        expect(comet(root)).toBeUndefined();
        expect(segmentTexts(root)).toEqual(['ThinkingThe cache is stale.']);
        expect(bodyParses()).toBe(parses);

        // The model goes on with the same thought.
        act(() => renderer?.update(element(streaming(`${twoThoughts} Clear it.`, LIVE_SEGMENTS))));

        expect(segmentTexts(root)).toEqual(['ThinkingThe cache is stale. Clear it.']);
        expect(bodyParses()).toBe(parses);
      });

      /** The streaming reply, gone on with more text and HTML after its tool call. */
      const goneOn = (reasoning: string, text: string, html: string) => {
        const content = streaming(reasoning, LIVE_SEGMENTS);
        return {
          ...content,
          body: `${content.body}${text}`,
          formatted_body: `${content.formatted_body}${html}`,
        };
      };

      it.each([
        ['its answer', '\n\nThe cache was stale.', '<p>The cache was stale.</p>'],
        ['another tool call', '\n\n🔧 `grep` [2]', marker('grep', 2)],
      ])('hides the segment into the bulb once the reply goes on with %s', (_name, body, html) => {
        vi.useFakeTimers();
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));

        act(() => renderer?.update(element(goneOn(twoThoughts, body, html))));

        expect(segmentTexts(root)).toEqual([]);
        expect(text(header(root))).toBe('Thinking');
        // It does not come back with the frames that follow, or when the comet stops.
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(segmentTexts(root)).toEqual([]);
      });

      it('hides the segment when one frame brings its last piece and the tool call after it', () => {
        const root = renderThinking(streaming(twoThoughts.slice(0, -6), LIVE_SEGMENTS));
        expect(segmentTexts(root)).toEqual(['ThinkingThe cache is']);
        const pending = '<p>🔧 <code>grep</code> [2] ⏳</p>';

        act(() => renderer?.update(element(goneOn(twoThoughts, '\n\n🔧 `grep` [2] ⏳', pending))));

        // The call began after the thought did, so the thought has ended, while the call runs too.
        expect(segmentTexts(root)).toEqual([]);

        act(() =>
          renderer?.update(element(goneOn(twoThoughts, '\n\n🔧 `grep` [2]', marker('grep', 2))))
        );

        expect(segmentTexts(root)).toEqual([]);
      });

      it('hides the segment when one frame brings its last piece and the first answer text', () => {
        vi.useFakeTimers();
        // The reply's first thought, over the thinking placeholder: no answer yet.
        const thought = (reasoning: string | undefined, answer?: string) => ({
          msgtype: 'm.text',
          body: answer ?? 'Thinking...',
          ...(answer === undefined
            ? {}
            : { format: 'org.matrix.custom.html', formatted_body: `<p>${answer}</p>` }),
          'io.mindroom.stream_status': 'streaming',
          [LIVE]: reasoning,
          'io.mindroom.live_reasoning_segments': reasoning && [{ start: 0, after_tool: 0 }],
        });
        const root = render(thought(undefined));
        act(() => renderer?.update(element(thought('Checking'))));
        expect(segmentTexts(root)).toEqual(['ThinkingChecking']);

        act(() => renderer?.update(element(thought('Checking complete.', 'It is stale.'))));

        // The answer came after the thought's last piece, so the thought has ended.
        expect(segmentTexts(root)).toEqual([]);
        expect(text(root)).toBe('ThinkingIt is stale.');

        // The answer pauses: no frame follows.
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(segmentTexts(root)).toEqual([]);
      });

      it.each([
        ['the tool call before it', '\n\n🔧 `grep` [2]', marker('grep', 2), 2],
        ['answer text before it', '\n\nStale so far.', '<p>Stale so far.</p>', 1],
      ])(
        'shows a new segment whose first piece comes in one frame with %s',
        (_name, body, html, afterTool) => {
          const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));
          const third = `${twoThoughts}\n\nSo`;

          act(() =>
            renderer?.update(
              element({
                ...goneOn(third, body, html),
                'io.mindroom.live_reasoning_segments': [
                  ...LIVE_SEGMENTS,
                  { start: twoThoughts.length + 2, after_tool: afterTool },
                ],
              })
            )
          );

          expect(segmentTexts(root)).toEqual(['ThinkingSo']);
        }
      );

      const code = (attributes: string, text = '') =>
        goneOn(twoThoughts, text, `<pre><code${attributes}>x = 1\n</code></pre>`);

      it.each([
        // The durable write names the language of the code, which the live Markdown did not.
        ['the same text as other HTML', code(''), code(' class="language-python"')],
        // A mention that the live Markdown spells out.
        ['the same HTML with other text', code('', ' @helper'), code('', ' Helper')],
      ])('keeps the segment when a checkpoint writes %s', (_name, live, checkpoint) => {
        const root = renderThinking(live);

        act(() => renderer?.update(element(checkpoint)));

        expect(segmentTexts(root)).toEqual(['ThinkingThe cache is stale.']);
      });

      it('shows the live reasoning of a backend that records no segments, whatever calls ran', () => {
        const root = renderThinking(streaming(twoThoughts, undefined));

        expect(segmentTexts(root)).toEqual(['ThinkingPlan the search.The cache is stale.']);
      });

      it('reads the tool markers of an open reply again only when a call comes', async () => {
        const root = renderThinking(streaming(twoThoughts, LIVE_SEGMENTS));
        await act(() => header(root).props.onClick());
        // The body sanitized without the link schemes, as the placement reads its markers.
        const markerReads = () =>
          vi
            .mocked(sanitizeCustomHtml)
            .mock.calls.filter((call) => call.length === 1 && call[0].includes('<p>Reading.</p>'))
            .length;
        const reads = markerReads();
        expect(reads).toBeGreaterThan(0);

        act(() => renderer?.update(element(goneOn(twoThoughts, '\n\nStale.', '<p>Stale.</p>'))));
        act(() =>
          renderer?.update(element(goneOn(twoThoughts, '\n\nStale. Yes.', '<p>Stale. Yes.</p>')))
        );

        expect(markerReads()).toBe(reads);

        act(() =>
          renderer?.update(
            element(
              goneOn(
                twoThoughts,
                '\n\nStale. Yes.\n\n🔧 `grep` [2]',
                `<p>Stale. Yes.</p>${marker('grep', 2)}`
              )
            )
          )
        );

        expect(markerReads()).toBe(reads + 1);
        // The thought after the first call still sits between the two runs.
        const order = ['read_file', 'The cache is stale.', 'Stale. Yes.', 'grep'].map((part) =>
          text(root).indexOf(part)
        );
        expect(order).not.toContain(-1);
        expect(order).toEqual([...order].sort((x, y) => x - y));
      });
    });
  });
});
