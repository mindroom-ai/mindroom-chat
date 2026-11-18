// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { MatrixEvent } from 'matrix-js-sdk';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { renderAgentMessageContent } from './renderAgentMessageContent';
import { showToolCalls } from '../../../test/utils/showToolCalls';
import { splitFinishedWork } from '../agent-run/finishedWorkSplit';
import { LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import {
  InlineSecretRequestsContext,
  NO_INLINE_SECRET_REQUESTS,
  type InlineSecretRequestPlan,
} from '../inlineSecretRequests';
import { ToolCallMessageContext } from '../agent-run/toolCallStatus';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from '../../matrix/protocol/thinkingPlaceholder';

// The folded work shows its tool calls once open, so these tests show them.
beforeEach(showToolCalls);

// The real RenderBody and its memo, under an MText that passes the formatted body and renders
// the extras after it, as MText does.
vi.mock('./MsgTypeRenderers', async () => {
  return {
    MEmote: () => null,
    MNotice: () => null,
    MText: ({ content, renderBody, renderAfterBody }: any) =>
      React.createElement(
        'div',
        null,
        renderBody({ body: content.body, customBody: content.formatted_body }),
        renderAfterBody
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

// The real split, counted.
vi.mock('../agent-run/finishedWorkSplit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent-run/finishedWorkSplit')>();
  return { ...actual, splitFinishedWork: vi.fn(actual.splitFinishedWork) };
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
  Line: 'Line',
  Toggle: 'Toggle',
  CogRow: 'CogRow',
  CollapseEnd: 'CollapseEnd',
  Label: 'Label',
  Chevron: 'Chevron',
  Segment: 'Segment',
  Rail: 'Rail',
  Body: 'Body',
  ActivityCode: 'ActivityCode',
  Bulb: 'Bulb',
  BulbIcon: 'BulbIcon',
}));
vi.mock('../agent-run/OutlineComet.css', () => ({ Outline: 'Outline' }));
vi.mock('../agent-run/ToolCallsFold.css', () => ({ CogRipple: 'CogRipple' }));
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

vi.mock('../MessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
  Html: 'Html',
}));

const htmlReactParserOptions: HTMLReactParserOptions = {};
const linkifyOpts = {};

const marker = (name: string, index: number) => `<p>🔧 <code>${name}</code> [${index}]</p>`;

const toolTrace = (...toolNames: string[]) => ({
  version: 2,
  events: toolNames.map((name, index) => ({
    type: 'tool_call_completed',
    tool_name: name,
    tool_call_id: `call_${index + 1}`,
  })),
});

/** The plain body of a reply with two tool calls, `length` characters long with its markers. */
const bodyOf = (length: number) => {
  const lines = [
    'Let me look.',
    '',
    '🔧 `web_search` [1]',
    '',
    'Now the file.',
    '',
    '🔧 `read_file` [2]',
  ];
  // Each line and its newline, a marker line counted as 80 characters, then the blank line's.
  const counted = lines.reduce((n, line) => n + (line.startsWith('🔧') ? 80 : line.length) + 1, 1);
  return [...lines, '', 'The answer.'.padEnd(length - counted, ' More.')].join('\n');
};
const LONG_BODY = bodyOf(6000);
const SHORT_BODY = bodyOf(5999);

/** A reply that searched, read a file, then answered, long enough to fold by default. */
const reply = (
  status: string | undefined,
  html = `<p>Let me look.</p>${marker('web_search', 1)}<p>Now the file.</p>${marker(
    'read_file',
    2
  )}<p>The answer.</p>`,
  body = LONG_BODY
): Record<string, unknown> => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: html,
  'io.mindroom.tool_trace': toolTrace('web_search', 'read_file'),
  ...(status === undefined ? {} : { 'io.mindroom.ai_run': { version: 1, status } }),
});

// Sent, then last edited 2 min 13 s later.
const mEvent = new MatrixEvent({
  event_id: '$reply',
  type: 'm.room.message',
  room_id: '!room:example.org',
  sender: '@agent:example.org',
  origin_server_ts: 1_000_000,
  content: {},
});
vi.spyOn(mEvent, 'replacingEvent').mockReturnValue(
  new MatrixEvent({ origin_server_ts: 1_133_000 })
);

// Each test shows a reply of its own.
let replyCount = 0;
let replyId = '$reply';

let renderer: ReactTestRenderer | undefined;
const render = (
  content: Record<string, unknown>,
  fromMindroomAgent = true,
  highlightRegex?: RegExp,
  secrets: InlineSecretRequestPlan = NO_INLINE_SECRET_REQUESTS
) =>
  act(() => {
    const tree = (
      <ClientConfigProvider value={{}}>
        <InlineSecretRequestsContext.Provider value={secrets}>
          <ToolCallMessageContext.Provider
            value={{ eventId: replyId, roomId: '!room:example.org' }}
          >
            {renderAgentMessageContent({
              mEvent,
              eventId: replyId,
              fromMindroomAgent,
              highlightRegex,
              displayName: 'Agent',
              msgType: 'm.text',
              content,
              htmlReactParserOptions,
              linkifyOpts,
            })}
          </ToolCallMessageContext.Provider>
        </InlineSecretRequestsContext.Provider>
      </ClientConfigProvider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
const text = () => JSON.stringify(renderer?.toJSON());
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
const firstParagraph = () =>
  renderer!.root.find((node) => node.type === 'p' && textOf(node) === 'Let me look.');
const reasoningToggle = () =>
  renderer!.root.find((node) => node.type === 'button' && textOf(node).startsWith('Thinking'));
const workedRow = () =>
  renderer!.root.find((node) => node.type === 'button' && textOf(node).startsWith('Worked'));
const toolCalls = () =>
  renderer?.root
    .findAll((node) => node.props.className === 'activity-detail')
    .map((node) => node.children.join(''));

describe('finished agent work', () => {
  beforeEach(() => {
    replyCount += 1;
    replyId = `$reply${replyCount}`;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('folds the work of a finished reply and keeps its answer', () => {
    render(reply('completed'));

    expect(text()).toContain('Worked for 2m 13s');
    expect(text()).toContain('The answer.');
    expect(text()).not.toContain('Let me look.');
    expect(text()).not.toContain('Now the file.');
    expect(toolCalls()).toEqual([]);
  });

  it('shows the work in place when the row is clicked', () => {
    render(reply('cached'));
    act(() => {
      workedRow().props.onClick();
    });

    expect(workedRow().props['aria-expanded']).toBe(true);
    expect(text()).toContain('Let me look.');
    expect(text()).toContain('Now the file.');
    expect(toolCalls()).toEqual(['web_search', 'read_file']);
    expect(text()).toContain('The answer.');
  });

  it.each([[undefined], ['streaming'], ['error'], ['cancelled']])(
    'does not fold a reply whose run status is %s',
    (status) => {
      render(reply(status));

      expect(text()).not.toContain('Worked');
      expect(text()).toContain('Let me look.');
      expect(toolCalls()).toEqual(['web_search', 'read_file']);
    }
  );

  it('does not fold a reply without tool calls', () => {
    render(reply('completed', '<p>Just an answer.</p>'));

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Just an answer.');
  });

  it('does not fold a reply that ends in a tool call', () => {
    render(reply('completed', `<p>Let me look.</p>${marker('web_search', 1)}`));

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
  });

  it('does not fold a message from someone other than a MindRoom agent', () => {
    render(reply('completed'), false);

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
  });

  it('keeps the work open while a secret request of its calls waits, and folds it once done', () => {
    const waiting = { ...NO_INLINE_SECRET_REQUESTS, waitingReplyIds: new Set([replyId]) };
    render(reply('completed'), true, undefined, waiting);
    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Now the file.');

    render(reply('completed'), true, undefined, NO_INLINE_SECRET_REQUESTS);
    expect(text()).toContain('Worked for 2m 13s');
  });

  it('folds a reply once it finishes on screen', () => {
    render(reply('streaming'));
    expect(text()).not.toContain('Worked');

    render(reply('completed'));
    expect(text()).toContain('Worked for 2m 13s');
    expect(text()).not.toContain('Let me look.');
  });

  it('folds a finished reply of 6000 characters, its tool markers counted as 80', () => {
    expect(LONG_BODY.length).toBeLessThan(6000);
    render(reply('completed', undefined, LONG_BODY));

    expect(text()).toContain('Worked for 2m 13s');
    expect(text()).not.toContain('Let me look.');
  });

  it('does not fold a shorter finished reply with tool calls', () => {
    render(reply('completed', undefined, SHORT_BODY));

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
    expect(text()).toContain('The answer.');
    expect(toolCalls()).toEqual(['web_search', 'read_file']);
  });

  it('does not fold a reply that search highlights', () => {
    render(reply('completed'), true, /answer/gi);

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
  });

  it('keeps a short reply in place when it finishes on screen', () => {
    render(reply('streaming', undefined, SHORT_BODY));
    const before = firstParagraph();

    render(reply('completed', undefined, SHORT_BODY));
    expect(text()).not.toContain('Worked');
    expect(firstParagraph()).toBe(before);
  });

  it('keeps the reasoning and body in place as the first tool call streams in', () => {
    const streaming = (body: string, html?: string) => ({
      ...reply('streaming', html),
      body,
      ...(html === undefined ? { formatted_body: undefined, format: undefined } : {}),
      [LIVE_REASONING_KEY]: 'Considering the question.',
    });

    render(streaming(MINDROOM_THINKING_PLACEHOLDER_BODY));
    // The bulb starts closed; the reader opens it.
    act(() => {
      reasoningToggle().props.onClick();
    });
    expect(reasoningToggle().props['aria-expanded']).toBe(true);

    // Two blocks: the parser keys the blocks of a body with more than one, so the first block of
    // any reply mounts again as its second arrives.
    const blocks = '<p>Let me look.</p><p>Searching.</p>';
    render(streaming('Let me look. Searching.', blocks));
    expect(reasoningToggle().props['aria-expanded']).toBe(true);
    const before = firstParagraph();

    render(streaming('Let me look. Searching.', `${blocks}${marker('web_search', 1)}`));
    expect(reasoningToggle().props['aria-expanded']).toBe(true);
    // Compared as a boolean: a failed toBe would print the whole fiber tree.
    expect(firstParagraph() === before).toBe(true);
    expect(toolCalls()).toEqual(['web_search']);
  });

  it('keeps every reasoning segment inside the folded work, and none in the answer', () => {
    const first = 'Which source is newest?';
    const last = 'The file settles it.';
    render({
      ...reply('completed'),
      'io.mindroom.reasoning': {
        text: `${first}\n\n${last}`,
        duration_ms: 9000,
        segments: [
          { start: 0, after_tool: 0, duration_ms: 4000 },
          // After the last tool call, right before the answer.
          { start: first.length + 2, after_tool: 2, duration_ms: 5000 },
        ],
      },
    });
    expect(text()).not.toContain('Thought for');

    act(() => {
      workedRow().props.onClick();
    });
    const bulb = renderer!.root.find(
      (node) => node.type === 'button' && textOf(node) === 'Thought for 9 s'
    );
    expect(text()).not.toContain(first);
    act(() => {
      bulb.props.onClick();
    });

    // The row's own element holds the work; the answer follows it.
    const work = workedRow().parent!;
    const segments = renderer!.root.findAll(
      (node) => node.type === 'div' && node.props.className === 'Segment'
    );
    expect(segments.map((segment) => textOf(segment).replace(/\n/g, ''))).toEqual([
      `Thought for 4 s${first}Hide thinking`,
      `Thought for 5 s${last}Hide thinking`,
    ]);
    const inWork = (node: ReactTestInstance | null): boolean =>
      !!node && (node === work || inWork(node.parent));
    expect(segments.map((segment) => inWork(segment))).toEqual([true, true]);
    const answer = renderer!.root.find(
      (node) => node.type === 'p' && textOf(node).startsWith('The answer.')
    );
    expect(inWork(answer)).toBe(false);
    // In the order it happened: the last thought after the last tool call, before the answer.
    const order = [first, 'web_search', 'read_file', last, 'The answer.'].map((part) =>
      text().indexOf(part)
    );
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('does not split a short reply', () => {
    vi.mocked(splitFinishedWork).mockClear();

    render(reply('completed', undefined, SHORT_BODY));
    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
    expect(splitFinishedWork).not.toHaveBeenCalled();
  });
});
