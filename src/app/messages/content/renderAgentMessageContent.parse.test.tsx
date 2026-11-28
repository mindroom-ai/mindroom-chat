import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { renderAgentMessageContent } from './renderAgentMessageContent';
import { showToolCalls } from '../../../test/utils/showToolCalls';

// These tests show how tool calls render, so they show them.
beforeEach(showToolCalls);

const sanitizeCustomHtmlSpy = vi.hoisted(() => vi.fn((html: string) => html));
const parseHtmlToDomSpy = vi.hoisted(() => vi.fn());
// The tool metadata status the long-text renderer reports, as while a sidecar loads.
const longText = vi.hoisted(() => ({ status: 'loading' }));

vi.mock('../../rich-text/sanitize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../rich-text/sanitize')>()),
  sanitizeCustomHtml: sanitizeCustomHtmlSpy,
}));

vi.mock('../../rich-text/parseHtml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../rich-text/parseHtml')>();
  parseHtmlToDomSpy.mockImplementation(actual.parseHtmlToDom);
  return {
    ...actual,
    parseHtmlToDom: parseHtmlToDomSpy,
  };
});

// The real RenderBody and its memo, under an MText that passes the formatted body.
vi.mock('./MsgTypeRenderers', async () => {
  return {
    MEmote: () => null,
    MNotice: () => null,
    MText: ({ content, renderBody }: any) =>
      React.createElement(
        'div',
        null,
        renderBody({ body: content.body, customBody: content.formatted_body })
      ),
  };
});
vi.mock('./RenderBody', async () => {
  const { RenderBody } = await import('./RenderBody');
  return {
    RenderBody,
  };
});
vi.mock('./BrokenContent', async () => {
  return {
    BrokenContent: () => null,
  };
});

vi.mock('./FallbackContent', () => ({ MessageEmptyContent: () => null }));

vi.mock('../html/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));

vi.mock('../agent-run/StreamingIndicator', () => ({ renderStreamingIndicator: () => null }));
vi.mock('../thread-summary/ThreadSummaryCard', () => ({ ThreadSummaryCard: () => null }));
vi.mock('../../approvals/ToolApprovalCard', () => ({ ToolApprovalCard: () => null }));
vi.mock('./PasteAttachmentContent', () => ({ PasteAttachmentContent: () => null }));
vi.mock('../agent-run/ThinkingPlaceholder', () => ({ ThinkingPlaceholder: () => null }));
vi.mock('./useResolvedMessageContent', () => ({
  useResolvedMessageContent: ({ content, longTextSource }: any) => ({
    content,
    rawHydratedContent: undefined,
    toolMetadataStatus: longTextSource ? longText.status : undefined,
    showLoadingIndicator: false,
    canFold: true,
  }),
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

vi.mock('../html/HtmlBlocks.css', () => ({
  Block: 'Block',
  BlockBody: 'BlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'BlockHeader',
  BlockHeaderMeta: 'BlockHeaderMeta',
  PasteMarkerBadge: 'PasteMarkerBadge',
  PasteMarkerBadgeMeta: 'PasteMarkerBadgeMeta',
}));

vi.mock('../../ui/PendingSendIndicator.css', () => ({ Container: 'PendingSendIndicator' }));

vi.mock('../agent-run/TranscribingPlaceholder.css', () => ({
  Placeholder: 'TranscribingPlaceholder',
  Text: 'TranscribingText',
  Wave: 'TranscribingWave',
  WaveBar: 'TranscribingWaveBar',
}));

const htmlReactParserOptions: HTMLReactParserOptions = {};
const linkifyOpts = {};

const toolTrace = (...toolNames: string[]) => ({
  version: 2,
  events: toolNames.map((name) => ({ type: 'tool_call_completed', tool_name: name })),
});

const agentReply = (text: string, trace: ReturnType<typeof toolTrace>) => ({
  msgtype: 'm.text',
  body: `${text}\n\n🔧 \`${trace.events[0]!.tool_name}\` [1]`,
  format: 'org.matrix.custom.html',
  formatted_body: `<p>${text}</p><p>🔧 <code>${trace.events[0]!.tool_name}</code> [1]</p>`,
  'io.mindroom.tool_trace': trace,
});

type Reply = Record<string, unknown> & { formatted_body: string };

function Timeline({
  replies,
  highlightRegex,
  fromMindroomAgent,
}: {
  replies: Reply[];
  highlightRegex?: RegExp;
  fromMindroomAgent?: boolean;
}) {
  return (
    <ClientConfigProvider value={{}}>
      {replies.map((content, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={index}>
          {renderAgentMessageContent({
            displayName: 'Agent',
            fromMindroomAgent,
            eventId: `$evt-${index}`,
            msgType: 'm.text',
            content,
            highlightRegex,
            htmlReactParserOptions,
            linkifyOpts,
          })}
        </React.Fragment>
      ))}
    </ClientConfigProvider>
  );
}

const sanitizesOf = (content: Reply) =>
  sanitizeCustomHtmlSpy.mock.calls.filter(([html]) => html === content.formatted_body).length;
const domParsesOf = (content: Reply) =>
  parseHtmlToDomSpy.mock.calls.filter(([html]) => html === content.formatted_body).length;

let renderer: ReactTestRenderer | undefined;
const render = (replies: Reply[], highlightRegex?: RegExp, fromMindroomAgent = false) =>
  act(() => {
    const timeline = (
      <Timeline
        replies={replies}
        highlightRegex={highlightRegex}
        fromMindroomAgent={fromMindroomAgent}
      />
    );
    if (renderer) renderer.update(timeline);
    else renderer = create(timeline);
  });
const text = () => JSON.stringify(renderer?.toJSON());
const nodeText = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)
      ? node.children.map(nodeText).join('')
      : '';
// The tool names of the rendered tool call rows; a marker that did not render stays text.
const toolCalls = () =>
  renderer?.root
    .findAll((node) => node.props.className === 'activity-detail')
    .map((node) => node.children.join(''));

describe('renderAgentMessageContent parsing', () => {
  beforeEach(() => {
    sanitizeCustomHtmlSpy.mockClear();
    parseHtmlToDomSpy.mockClear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('sanitizes and parses only the reply that changed when another reply with tool calls streams', () => {
    const done = agentReply('Finished the search.', toolTrace('web_search'));
    let streaming = agentReply('Working on it.', toolTrace('browser_control'));
    render([done, streaming]);
    expect(sanitizesOf(done)).toBe(1);
    expect(domParsesOf(done)).toBe(1);

    for (let edit = 1; edit <= 3; edit += 1) {
      streaming = agentReply(`Working on it, step ${edit}.`, toolTrace('browser_control'));
      // Edits are resolved again on every timeline render, so unchanged replies arrive as new
      // objects with the same values.
      render([{ ...done }, streaming]);
      expect(sanitizesOf(streaming)).toBe(1);
      expect(domParsesOf(streaming)).toBe(1);
    }

    expect(sanitizesOf(done)).toBe(1);
    expect(domParsesOf(done)).toBe(1);
    expect(text()).toContain('Working on it, step 3.');
    expect(text()).not.toContain('step 2');
    expect(toolCalls()).toEqual(['web_search', 'browser_control']);
  });

  it('reuses the sanitized DOM without re-sanitizing or re-parsing when only tool_trace changes', () => {
    const before = agentReply('Searching.', {
      version: 2,
      events: [{ type: 'tool_call_started', tool_name: 'web_search' }],
    });
    render([before]);
    expect(sanitizesOf(before)).toBe(1);
    expect(domParsesOf(before)).toBe(1);

    const after = {
      ...before,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'web_search', result_preview: 'ok' }],
      },
    };
    render([after]);

    expect(sanitizesOf(before)).toBe(1);
    expect(domParsesOf(before)).toBe(1);
    expect(toolCalls()).toEqual(['web_search']);
  });

  it('reuses the sanitized DOM without re-sanitizing or re-parsing when highlightRegex changes', () => {
    const reply = agentReply('Searching.', toolTrace('web_search'));
    render([reply]);
    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);

    render([reply], /Searching/);

    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);
    expect(toolCalls()).toEqual(['web_search']);
    expect(text()).toContain('Searching');
  });

  it('reuses the sanitized DOM without re-sanitizing or re-parsing when toolMetadataStatus changes', () => {
    const reply = {
      ...agentReply('Long answer.', toolTrace('web_search')),
      url: 'mxc://example.org/long-text',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    longText.status = 'loading';
    render([reply]);
    render([{ ...reply }]);
    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);

    // The sidecar settled without the tool metadata.
    longText.status = 'unavailable';
    render([{ ...reply }]);

    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);
    expect(toolCalls()).toEqual(['web_search']);
  });

  it('sanitizes and parses once even when toggling the reasoning bulb on a finished reply', () => {
    const reply = {
      ...agentReply('Checking.', toolTrace('web_search')),
      formatted_body: '<p>Checking.</p><p>🔧 <code>web_search</code> [1]</p><p>Done.</p>',
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
      'io.mindroom.reasoning': {
        text: 'Plan the search.\n\nReview the answer.',
        duration_ms: 4000,
        segments: [
          { start: 0, end: 16, after_tool: 0, duration_ms: 2000 },
          { start: 18, end: 36, after_tool: 1, duration_ms: 2000 },
        ],
      },
    };
    render([reply], undefined, true);
    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);

    // Open finished-work fold, then open reasoning bulb inside it (reuses split toolCallIndexes).
    const foldButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-expanded'] === false
    );
    act(() => {
      foldButton.props.onClick();
    });
    const bulbButton = renderer!.root.find(
      (node) =>
        node.type === 'button' &&
        node.props['aria-expanded'] === false &&
        nodeText(node).includes('Thought')
    );
    act(() => {
      bulbButton.props.onClick();
    });

    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);
    expect(text()).toContain('Plan the search.');
    expect(text()).toContain('Review the answer.');
  });

  it('sanitizes and parses once even when toggling the reasoning bulb on an unfolded streaming reply', () => {
    const reply = {
      ...agentReply('Checking.', toolTrace('web_search')),
      formatted_body: '<p>Checking.</p><p>🔧 <code>web_search</code> [1]</p><p>Still working.</p>',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Plan the search.\n\nInspect result.',
      'io.mindroom.live_reasoning_segments': [
        { start: 0, end: 16, after_tool: 0 },
        { start: 18, end: 33, after_tool: 1 },
      ],
    };
    render([reply], undefined, true);
    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);

    const bulbButton = renderer!.root.find(
      (node) =>
        node.type === 'button' &&
        node.props['aria-expanded'] === false &&
        nodeText(node).includes('Thinking')
    );
    act(() => {
      bulbButton.props.onClick();
    });

    expect(sanitizesOf(reply)).toBe(1);
    expect(domParsesOf(reply)).toBe(1);
    expect(text()).toContain('Plan the search.');
    expect(text()).toContain('Inspect result.');
  });
});
