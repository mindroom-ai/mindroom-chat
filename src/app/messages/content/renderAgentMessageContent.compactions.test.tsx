// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { MatrixEvent } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { getSettings, settingsAtom } from '../../preferences/settings';
import {
  renderAgentMessageContent,
  type RenderAgentMessageContentOptions,
} from './renderAgentMessageContent';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { showToolCalls } from '../../../test/utils/showToolCalls';
import { LIVE_COMPACTIONS_KEY, LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import { COMPACTIONS_CONTENT_KEY } from '../../matrix/protocol/compactions';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from '../../matrix/protocol/thinkingPlaceholder';
import backendBodies from '../__fixtures__/backendToolMarkerBodies.json';

beforeEach(showToolCalls);

// Sidecar contents the tests have "downloaded", by MXC URI.
const sidecars = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('./LongTextText', () => ({
  LongTextKind: { Text: 'text', Emote: 'emote', Notice: 'notice' },
  LongTextText: ({ content, renderBody }: any) => {
    const resolved = sidecars.get(content.url) ?? content;
    return renderBody(resolved, { body: resolved.body, customBody: resolved.formatted_body });
  },
}));

// The real RenderBody and its memo, under an MText (and an MNotice like it) that passes the body
// alone, as a reply that arrives without its HTML does, so the agent's Markdown body renders as
// MindRoom writes it.
vi.mock('./MsgTypeRenderers', async () => {
  const MText = ({ content, renderBody, renderAfterBody }: any) =>
    React.createElement(
      'div',
      null,
      renderBody({ body: content.body, customBody: content.formatted_body }),
      renderAfterBody
    );
  return { MEmote: () => null, MNotice: MText, MText };
});
vi.mock('./RenderBody', async () => {
  const { RenderBody } = await import('./RenderBody');
  return { RenderBody };
});
vi.mock('./BrokenContent', async () => ({ BrokenContent: () => null }));
// A seam's card in place of folds' portal, which the test renderer cannot hold.
vi.mock('../../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/directional')>()),
  PopOut: ({ anchor, content }: any) => (anchor ? content : null),
}));
vi.mock('./FallbackContent', () => ({ MessageEmptyContent: () => null }));
vi.mock('../html/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));
vi.mock('../agent-run/StreamingIndicator', () => ({ renderStreamingIndicator: () => null }));
vi.mock('../thread-summary/ThreadSummaryCard', () => ({ ThreadSummaryCard: () => null }));
vi.mock('../../approvals/ToolApprovalCard', () => ({ ToolApprovalCard: () => null }));
vi.mock('./PasteAttachmentContent', () => ({ PasteAttachmentContent: () => null }));
vi.mock('../agent-run/ThinkingPlaceholder', () => ({
  ThinkingPlaceholder: () => React.createElement('p', null, 'Thinking placeholder'),
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
vi.mock('../agent-run/CompactionSeam.css', () => ({
  Seam: 'Seam',
  Trigger: 'Trigger',
  Icon: 'Icon',
  Separator: 'Separator',
  Rule: 'Rule',
  Card: 'Card',
  Head: 'Head',
  HeadIcon: 'HeadIcon',
  Tag: 'Tag',
  Subtitle: 'Subtitle',
  Gauge: 'Gauge',
  GaugeWas: 'GaugeWas',
  GaugeNow: 'GaugeNow',
  GaugeLabel: 'GaugeLabel',
  Rows: 'Rows',
  Term: 'Term',
  Value: 'Value',
}));
vi.mock('../agent-run/OutlineComet.css', () => ({
  Outline: 'Outline',
  Glow: 'Glow',
  Comet: 'Comet',
  CometHead: 'CometHead',
}));
vi.mock('../agent-run/ToolCallsFold.css', () => ({
  Cog: 'Cog',
  CogGear: 'CogGear',
  CogIcon: 'CogIcon',
  CogRipple: 'CogRipple',
  Fold: 'Fold',
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

/** A tool marker line as the backend writes it into the body. */
const markerLine = (name: string, index: number) => `🔧 \`${name}\` [${index}]`;

/** Marker lines for the tools `t<from>` to `t<to>`, one paragraph each. */
const markerLines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, offset) =>
    markerLine(`t${from + offset}`, from + offset)
  );

const toolTrace = (count: number) => ({
  version: 2,
  events: Array.from({ length: count }, (_, index) => ({
    type: 'tool_call_completed',
    tool_name: `t${index + 1}`,
  })),
});

/** A compaction entry as the backend writes it. */
const entry = (id: string, afterTool: number, fields: Record<string, unknown> = {}) => ({
  id,
  phase: afterTool === 0 ? 'pre_turn' : 'mid_turn',
  after_tool: afterTool,
  status: 'success',
  started_at: 1_794_940_102_256,
  duration_ms: 8400,
  before_tokens: 366_804,
  after_tokens: 6336,
  ...fields,
});

/** A reply that arrives with its Markdown body alone, as the backend's body-only edits do. */
const reply = (
  body: string,
  compactions: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  msgtype: 'm.text',
  body,
  'io.mindroom.tool_trace': toolTrace(20),
  'io.mindroom.stream_status': 'streaming',
  [COMPACTIONS_CONTENT_KEY]: compactions,
  ...extra,
});

/** An answer long enough to fold the work before it. */
const LONG_ANSWER = 'The answer.'.padEnd(6000, ' More.');

const paragraphs = (...parts: (string | string[])[]) => parts.flat().join('\n\n');

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

let replyCount = 0;
let replyId = '$reply';
let renderer: ReactTestRenderer | undefined;
// A button measures where a seam's card opens under it.
const createNodeMock = (element: React.ReactElement) =>
  element.type === 'button'
    ? { getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }), contains: () => false }
    : null;

const render = (
  content: Record<string, unknown>,
  overrides: Partial<RenderAgentMessageContentOptions> = {}
) =>
  act(() => {
    const tree = (
      <ClientConfigProvider value={{}}>
        {/* As RenderMessageContent wraps a reply: its cog folds the calls while hidden. */}
        <ToolCallsFold>
          {renderAgentMessageContent({
            mEvent,
            eventId: replyId,
            fromMindroomAgent: true,
            displayName: 'Agent',
            msgType: 'm.text',
            content,
            htmlReactParserOptions,
            linkifyOpts,
            ...overrides,
          })}
        </ToolCallsFold>
      </ClientConfigProvider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree, { createNodeMock });
  });

beforeEach(() => {
  replyCount += 1;
  replyId = `$reply${replyCount}`;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const isHost = (node: ReactTestInstance) => typeof node.type === 'string';
const isSeam = (node: ReactTestInstance) =>
  isHost(node) && node.props['data-compaction-seam'] !== undefined;

/** The reasoning line's toggle, as `Thought for N s` or `Thinking…` names it. */
const isBulb = (node: ReactTestInstance) =>
  node.type === 'button' && /^Th(ought|inking)/.test(textOf(node));

const seams = () => renderer!.root.findAll(isSeam);
const seamStates = () => seams().map((node) => node.props['data-state'] as string);

/**
 * The reply as it reads, in order: each seam as `seam`, each run of tool calls by its names, each
 * shown thinking segment as `thinking`, the bulb as `bulb`, and every paragraph by its text.
 */
const sequence = (): string[] => {
  const out: string[] = [];
  const visit = (node: ReactTestInstance | string) => {
    if (typeof node === 'string') return;
    if (isSeam(node)) {
      out.push('seam');
      return;
    }
    if (isHost(node)) {
      const { className } = node.props;
      if (className === 'activity-detail') {
        out.push(`tools:${textOf(node)}`);
        return;
      }
      if (className === 'Segment') {
        out.push('thinking');
        return;
      }
      if (isBulb(node)) {
        out.push('bulb');
        return;
      }
      if (node.type === 'p') {
        out.push(textOf(node));
        return;
      }
    }
    node.children.forEach(visit);
  };
  visit(renderer!.root);
  return out;
};

const bulb = () => renderer!.root.find(isBulb);
const workedRow = () =>
  renderer!.root.find((node) => node.type === 'button' && textOf(node).startsWith('Worked'));

describe('compaction seams in a reply', () => {
  it('shows a compaction before the first tool call at the top of the reply', () => {
    render(reply(paragraphs('Intro.', markerLine('t1', 1), 'Done.'), [entry('c1', 0)]));

    expect(sequence()).toEqual(['seam', 'Intro.', 'tools:t1', 'Done.']);
  });

  it('shows a top compaction below the reasoning line', () => {
    render(
      reply(paragraphs('Intro.', markerLine('t1', 1), 'Done.'), [entry('c1', 0)], {
        'io.mindroom.reasoning': { text: 'Considering.', duration_ms: 3000 },
      })
    );

    expect(sequence()).toEqual(['bulb', 'seam', 'Intro.', 'tools:t1', 'Done.']);
  });

  it('keeps an open top seam open when the first reasoning comes', () => {
    const running = [entry('c1', 0, { status: 'running', after_tokens: undefined })];
    const body = paragraphs('Intro.', markerLine('t1', 1), 'Done.');
    render(reply(body, running));
    const trigger = () => seams()[0]!.findByType('button');
    act(() => {
      trigger().props.onClick({ detail: 1 });
    });
    expect(trigger().props['aria-expanded']).toBe(true);

    render(reply(body, running, { [LIVE_REASONING_KEY]: 'Considering.' }));
    expect(sequence().slice(0, 2)).toEqual(['bulb', 'seam']);
    expect(trigger().props['aria-expanded']).toBe(true);
  });

  it('splits a run of consecutive tool calls at a compaction between them', () => {
    render(reply(paragraphs('Intro.', markerLines(1, 5), 'Done.'), [entry('c1', 3)]));

    expect(sequence()).toEqual(['Intro.', 'tools:t1, t2, t3', 'seam', 'tools:t4, t5', 'Done.']);
  });

  it('keeps a run whole without a compaction inside it', () => {
    render(reply(paragraphs('Intro.', markerLines(1, 5), 'Done.'), [entry('c1', 5)]));

    expect(sequence()).toEqual(['Intro.', 'tools:t1, t2, t3, t4, t5', 'seam', 'Done.']);
  });

  it('shows the compaction between the texts while the cog hides the tool calls', () => {
    getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: false });
    render(reply(paragraphs('First.', markerLines(1, 2), 'Second.'), [entry('c1', 1)]));

    expect(sequence()).toEqual(['First.', 'seam', 'Second.']);
  });

  it('places two compactions among eleven consecutive tool calls', () => {
    render(
      reply(paragraphs('Intro.', markerLines(1, 11), 'Done.'), [entry('c1', 4), entry('c2', 9)])
    );

    expect(sequence()).toEqual([
      'Intro.',
      'tools:t1, t2, t3, t4',
      'seam',
      'tools:t5, t6, t7, t8, t9',
      'seam',
      'tools:t10, t11',
      'Done.',
    ]);
  });

  it('shows the compaction before the thinking that follows at the same spot', () => {
    const first = 'Where to start?';
    const second = 'The search settles it.';
    render(
      reply(paragraphs('Intro.', markerLines(1, 3), 'Done.'), [entry('c1', 0), entry('c2', 2)], {
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.reasoning': {
          text: `${first}\n\n${second}`,
          duration_ms: 9000,
          segments: [
            { start: 0, after_tool: 0, duration_ms: 4000 },
            { start: first.length + 2, after_tool: 2, duration_ms: 5000 },
          ],
        },
      })
    );
    act(() => {
      bulb().props.onClick();
    });

    expect(sequence()).toEqual([
      'bulb',
      'seam',
      'thinking',
      'Intro.',
      'tools:t1, t2',
      'seam',
      'thinking',
      'tools:t3',
      'Done.',
    ]);
  });

  it('keeps the seams and the runs they split through the bulb and the cog opening and closing', () => {
    getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: false });
    const first = 'Where to start?';
    const second = 'The search settles it.';
    render(
      reply(paragraphs('Intro.', markerLines(1, 5), 'Done.'), [entry('c1', 0), entry('c2', 3)], {
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.reasoning': {
          text: `${first}\n\n${second}`,
          duration_ms: 9000,
          segments: [
            { start: 0, after_tool: 0, duration_ms: 4000 },
            { start: first.length + 2, after_tool: 3, duration_ms: 5000 },
          ],
        },
      })
    );
    const cog = () =>
      renderer!.root.find((node) => node.type === 'button' && node.props.className === 'Cog');
    const toggle = (button: () => ReactTestInstance) =>
      act(() => {
        button().props.onClick();
      });
    const closed = ['bulb', 'seam', 'Intro.', 'seam', 'Done.'];
    const thinking = ['bulb', 'seam', 'thinking', 'Intro.', 'seam', 'thinking', 'Done.'];
    const runs = ['tools:t1, t2, t3', 'seam', 'thinking', 'tools:t4, t5'];
    const both = ['bulb', 'seam', 'thinking', 'Intro.', ...runs, 'Done.'];
    const runsOnly = [
      'bulb',
      'seam',
      'Intro.',
      'tools:t1, t2, t3',
      'seam',
      'tools:t4, t5',
      'Done.',
    ];
    expect(sequence()).toEqual(closed);

    // The bulb, open, closed and open again, with the cog hiding the calls.
    toggle(bulb);
    expect(sequence()).toEqual(thinking);
    toggle(bulb);
    expect(sequence()).toEqual(closed);
    toggle(bulb);
    expect(sequence()).toEqual(thinking);

    // The cog, shown, hidden and shown again, with the thinking open: the seam still splits.
    toggle(cog);
    expect(sequence()).toEqual(both);
    toggle(cog);
    expect(sequence()).toEqual(thinking);
    toggle(cog);
    expect(sequence()).toEqual(both);

    // The bulb closing under shown calls keeps the seam's split; the cog then hides them.
    toggle(bulb);
    expect(sequence()).toEqual(runsOnly);
    toggle(cog);
    expect(sequence()).toEqual(closed);
    toggle(bulb);
    toggle(cog);
    expect(sequence()).toEqual(both);
    expect(seamStates()).toEqual(['success', 'success']);
  });

  it('shows a compaction anchored past the rendered tool calls after the last one', () => {
    render(reply(paragraphs('Intro.', markerLines(1, 2), 'Done.'), [entry('c1', 7)]));

    expect(sequence()).toEqual(['Intro.', 'tools:t1, t2', 'seam', 'Done.']);
  });

  it('places a compaction after the last tool call that renders as a block', () => {
    // Marker 1 is inside a code block, so only marker 2 renders as a call.
    const { body } = backendBodies['list-marker line inside a fence'];
    render(reply(body, [entry('c1', 1), entry('c2', 2)]));

    expect(sequence()).toEqual(['seam', 'tools:t2', 'seam', 'Answer']);
  });

  it.each(['tool call inside a raw div', 'tool call inside a details block'] as const)(
    'places a compaction after the call of the fixture "%s"',
    (name) => {
      const { body, formatted_body: html } = backendBodies[name];
      render(
        reply(body, [entry('c1', 1)], { format: 'org.matrix.custom.html', formatted_body: html })
      );

      expect(sequence()).toEqual(['tools:t1', 'seam', 'Answer']);
    }
  );

  it('moves a seam to the top when an edit turns its call into text of the same marker count', () => {
    render(reply(paragraphs(markerLine('t1', 1), 'Answer'), [entry('c1', 1)]));
    expect(sequence()).toEqual(['tools:t1', 'seam', 'Answer']);

    // The edit shows the marker in a code block: as many 🔧 as before, no call drawn.
    render(
      reply(paragraphs('```', markerLine('t1', 1), '```', 'Answer'), [entry('c1', 1)], {
        format: 'org.matrix.custom.html',
        formatted_body: '<pre><code>🔧 `t1` [1]\n</code></pre><p>Answer</p>',
      })
    );
    expect(sequence()).toEqual(['seam', 'Answer']);
  });

  it('places a compaction after a call whose name holds another index', () => {
    const { body, formatted_body: html } = backendBodies['tool name containing another index'];
    render(
      reply(body, [entry('c1', 1)], { format: 'org.matrix.custom.html', formatted_body: html })
    );

    expect(sequence().slice(0, 2)).toEqual(['tools:t1', 'seam']);
  });

  it('shows a compaction at the top when its tool call renders as text', () => {
    render(reply(backendBodies['tool call as a list item'].body, [entry('c1', 1)]));

    expect(sequence()[0]).toBe('seam');
    expect(seams()).toHaveLength(1);
  });

  it('shows no seam without compactions, or for a malformed list', () => {
    render(reply(paragraphs('Intro.', markerLine('t1', 1)), []));
    expect(seams()).toHaveLength(0);

    render(
      reply(paragraphs('Intro.', markerLine('t1', 1)), [{ id: 'c1', after_tool: -1 }], {
        [COMPACTIONS_CONTENT_KEY]: { not: 'a list' },
      })
    );
    expect(seams()).toHaveLength(0);
  });
});

describe('compaction seams in finished and live replies', () => {
  it('keeps every seam in the folded work of a long finished reply, none in the answer', () => {
    const answer = LONG_ANSWER;
    render(
      reply(
        paragraphs(
          'Let me look.',
          markerLine('t1', 1),
          'Now the file.',
          markerLine('t2', 2),
          answer
        ),
        [entry('c1', 0), entry('c2', 1), entry('c3', 2)],
        {
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
        }
      )
    );
    expect(workedRow().props['aria-expanded']).toBe(false);
    expect(seams()).toHaveLength(0);
    expect(sequence()).toEqual([answer]);

    act(() => {
      workedRow().props.onClick();
    });
    expect(sequence()).toEqual([
      'seam',
      'Let me look.',
      'tools:t1',
      'seam',
      'Now the file.',
      'tools:t2',
      'seam',
      answer,
    ]);
    // The row's own element holds the work; the answer follows it.
    const work = workedRow().parent!;
    const inWork = (node: ReactTestInstance | null): boolean =>
      !!node && (node === work || inWork(node.parent));
    expect(seams().map(inWork)).toEqual([true, true, true]);
    const answerParagraph = renderer!.root.find(
      (node) => node.type === 'p' && textOf(node) === answer
    );
    expect(inWork(answerParagraph)).toBe(false);
  });

  it('keeps the seam after a last tool call inside a div in the folded work', () => {
    const answer = LONG_ANSWER;
    const html =
      '<p>🔧 <code>t1</code> [1]</p><p>Now the file.</p>' +
      `<div><p>🔧 <code>t2</code> [2]</p></div><p>${answer}</p>`;
    render(
      reply(
        paragraphs(
          markerLine('t1', 1),
          'Now the file.',
          '<div>',
          markerLine('t2', 2),
          '</div>',
          answer
        ),
        [entry('c1', 1), entry('c2', 2)],
        {
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
          format: 'org.matrix.custom.html',
          formatted_body: html,
        }
      )
    );
    expect(sequence()).toEqual([answer]);

    act(() => {
      workedRow().props.onClick();
    });
    expect(sequence()).toEqual(['tools:t1', 'seam', 'Now the file.', 'tools:t2', 'seam', answer]);
    const work = workedRow().parent!;
    const inWork = (node: ReactTestInstance | null): boolean =>
      !!node && (node === work || inWork(node.parent));
    expect(seams().map(inWork)).toEqual([true, true]);
  });

  it('places each seam after its call when a div holds a direct call, then one in a paragraph', () => {
    const answer = LONG_ANSWER;
    const html = `<div>🔧 <code>t1</code> [1]<p>🔧 <code>t2</code> [2]</p></div><p>${answer}</p>`;
    render(
      reply(
        paragraphs('<div>', markerLine('t1', 1), markerLine('t2', 2), '</div>', answer),
        [entry('c1', 1), entry('c2', 2)],
        {
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
          format: 'org.matrix.custom.html',
          formatted_body: html,
        }
      )
    );
    expect(sequence()).toEqual([answer]);

    act(() => {
      workedRow().props.onClick();
    });
    expect(sequence()).toEqual(['tools:t1', 'seam', 'tools:t2', 'seam', answer]);
    const work = workedRow().parent!;
    const inWork = (node: ReactTestInstance | null): boolean =>
      !!node && (node === work || inWork(node.parent));
    expect(seams().map(inWork)).toEqual([true, true]);
  });

  it('folds a call the sanitizer takes out of a section with the work, its seam too', () => {
    const answer = LONG_ANSWER;
    const html =
      '<p>🔧 <code>t1</code> [1]</p>' +
      `<section><p>🔧 <code>t2</code> [2]</p></section><p>${answer}</p>`;
    render(
      reply(
        paragraphs(markerLine('t1', 1), markerLine('t2', 2), answer),
        [entry('c1', 1), entry('c2', 2)],
        {
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
          format: 'org.matrix.custom.html',
          formatted_body: html,
        }
      )
    );
    expect(sequence()).toEqual([answer]);

    act(() => {
      workedRow().props.onClick();
    });
    expect(sequence()).toEqual(['tools:t1', 'seam', 'tools:t2', 'seam', answer]);
  });

  it('shows the live compactions over the event’s while the reply streams', () => {
    render(
      reply(paragraphs('Intro.', markerLine('t1', 1), 'More.'), [entry('c1', 1)], {
        [LIVE_COMPACTIONS_KEY]: [entry('c1', 1, { status: 'running', after_tokens: undefined })],
      })
    );

    expect(seamStates()).toEqual(['running']);
    expect(sequence()).toEqual(['Intro.', 'tools:t1', 'seam', 'More.']);
  });

  it('shows no seam while the live list is empty, over the event’s', () => {
    render(
      reply(paragraphs('Intro.', markerLine('t1', 1), 'More.'), [entry('c1', 1)], {
        [LIVE_COMPACTIONS_KEY]: [],
      })
    );

    expect(seams()).toHaveLength(0);
  });

  it('shows the live compactions of a long reply over its downloaded sidecar', () => {
    sidecars.set('mxc://example.org/long', {
      ...reply(paragraphs('Intro.', markerLine('t1', 1), 'More.'), [entry('c1', 1)]),
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Intro.</p><p>🔧 <code>t1</code> [1]</p><p>More.</p>',
    });
    render({
      msgtype: 'm.text',
      body: 'Intro.',
      url: 'mxc://example.org/long',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      'io.mindroom.stream_status': 'streaming',
      [LIVE_COMPACTIONS_KEY]: [entry('c1', 1, { status: 'running', after_tokens: undefined })],
    });
    sidecars.clear();

    expect(seamStates()).toEqual(['running']);
    expect(sequence()).toEqual(['Intro.', 'tools:t1', 'seam', 'More.']);
  });

  it('keeps the event’s own compactions when the downloaded sidecar leaves them out', () => {
    const long = {
      msgtype: 'm.text',
      body: 'Intro.',
      url: 'mxc://example.org/durable',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      'io.mindroom.stream_status': 'completed',
      [COMPACTIONS_CONTENT_KEY]: [entry('c1', 0)],
    };
    // Before the download: the preview, under the event's own list.
    render(long);
    expect(seamStates()).toEqual(['success']);

    const { [COMPACTIONS_CONTENT_KEY]: _none, ...withoutList } = reply(
      paragraphs('Intro.', markerLine('t1', 1), 'More.'),
      []
    );
    sidecars.set(long.url, { ...withoutList, 'io.mindroom.stream_status': 'completed' });
    render({ ...long });
    expect(seamStates()).toEqual(['success']);

    // A list of its own in the download is the one shown.
    sidecars.set(long.url, {
      ...withoutList,
      'io.mindroom.stream_status': 'completed',
      [COMPACTIONS_CONTENT_KEY]: [entry('c2', 1, { status: 'failed', after_tokens: undefined })],
    });
    render({ ...long });
    sidecars.clear();
    expect(seamStates()).toEqual(['failed']);
  });

  it('shows no seam in a reply from an account that is no agent for this viewer', () => {
    render(
      reply(paragraphs('Intro.', markerLine('t1', 1), 'More.'), [entry('c1', 1)], {
        [LIVE_COMPACTIONS_KEY]: [entry('c2', 0, { status: 'running' })],
      }),
      { fromMindroomAgent: false }
    );

    expect(sequence()).toContain('More.');
    expect(seams()).toHaveLength(0);
  });

  it("shows no seam from a person's downloaded sidecar", () => {
    sidecars.set('mxc://example.org/person', {
      ...reply(paragraphs('Intro.', 'More.'), [entry('c1', 0)]),
      [LIVE_COMPACTIONS_KEY]: [entry('c2', 0, { status: 'running' })],
    });
    render(
      {
        msgtype: 'm.text',
        body: 'Intro.',
        url: 'mxc://example.org/person',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
      { fromMindroomAgent: false, displayName: 'Bob', eventId: '$person-long' }
    );
    sidecars.clear();

    expect(renderer!.toJSON()).not.toBeNull();
    expect(seams()).toHaveLength(0);
  });

  it('shows a running compaction before the reply on its pending placeholder', () => {
    render({
      msgtype: 'm.text',
      body: MINDROOM_THINKING_PLACEHOLDER_BODY,
      'io.mindroom.stream_status': 'pending',
      [LIVE_COMPACTIONS_KEY]: [
        entry('c1', 0, { status: 'running', after_tokens: undefined, runs_remaining: 15 }),
      ],
    });

    expect(seamStates()).toEqual(['running']);
    expect(sequence()).toEqual(['seam', 'Thinking placeholder']);
  });

  it('shows a compaction still running on a finished reply as interrupted', () => {
    const running = entry('c1', 1, { status: 'running', after_tokens: undefined });
    render(
      reply(paragraphs('Intro.', markerLine('t1', 1), 'Done.'), [running], {
        'io.mindroom.stream_status': 'completed',
      })
    );
    expect(seamStates()).toEqual(['interrupted']);

    // A failed one stays failed, and one on a streaming reply still runs.
    render(
      reply(
        paragraphs('Intro.', markerLine('t1', 1), 'Done.'),
        [entry('c2', 0, { status: 'failed', after_tokens: undefined }), running],
        { 'io.mindroom.stream_status': 'streaming' }
      )
    );
    expect(seamStates()).toEqual(['failed', 'running']);
  });
});

/**
 * A reply with these edits, in order. `read` gives the content it shows, read as the timeline
 * reads it (`getEditedEvent`). Each edit carries its MindRoom metadata twice, in its wrapper and
 * its new content, as the backend writes it.
 */
const withEdits = (...edits: Record<string, unknown>[]) => {
  const sender = '@agent:example.org';
  const target = new MatrixEvent({
    event_id: '$target',
    type: 'm.room.message',
    room_id: '!room:example.org',
    sender,
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Thinking…' },
  });
  const events = edits.map(
    (newContent, index) =>
      new MatrixEvent({
        event_id: `$edit${index}`,
        type: 'm.room.message',
        room_id: '!room:example.org',
        sender,
        origin_server_ts: 2000 + index * 1000,
        content: {
          ...newContent,
          body: `* ${newContent.body}`,
          'm.new_content': newContent,
          'm.relates_to': { event_id: '$target', rel_type: 'm.replace' },
        },
      })
  );
  const timelineSet = {
    relations: { getChildEventsForEvent: () => ({ getRelations: () => events }) },
  };
  const read = () =>
    getLatestMessageContent(
      target,
      getEditedEvent('$target', target, timelineSet as never)
    ) as Record<string, unknown>;
  return { events, read };
};

describe('compaction seams across the edits of a reply', () => {
  const finished = reply(paragraphs('Intro.', markerLine('t1', 1), 'Done.'), [entry('c1', 1)], {
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
  });
  const failed = entry('c2', 1, { status: 'failed', after_tokens: undefined });
  const running = entry('c2', 1, { status: 'running', after_tokens: undefined });
  /** A stop, error or interrupt write: its text, its stream status and the reply's list. */
  const stopped = (compactions: unknown[]) =>
    reply(paragraphs('Again.', markerLine('t1', 1)), compactions, {
      'io.mindroom.stream_status': 'cancelled',
    });

  it('shows no seam of the previous answer on a regenerated one that did not compact', () => {
    const { [COMPACTIONS_CONTENT_KEY]: _none, ...regenerated } = reply(
      paragraphs('Again.', markerLine('t1', 1), 'Done again.'),
      [],
      { 'io.mindroom.stream_status': 'completed' }
    );
    render(withEdits(finished, regenerated).read());

    expect(sequence()).toEqual(['Again.', 'tools:t1', 'Done again.']);
  });

  it('keeps a running seam of a regenerated reply running, whatever the previous answer said', () => {
    const regenerating = reply(paragraphs('Again.', markerLine('t1', 1)), [running], {
      'io.mindroom.stream_status': 'streaming',
    });
    render(withEdits(finished, regenerating).read());

    expect(seamStates()).toEqual(['running']);
  });

  it('keeps the work of a long regenerated reply open while its own stream still runs', () => {
    // The regeneration inherits the previous answer's completed run; its own status streams.
    const regenerating = reply(paragraphs('Again.', markerLine('t1', 1), LONG_ANSWER), [running], {
      'io.mindroom.stream_status': 'streaming',
    });
    const content = withEdits(finished, regenerating).read();
    expect(content['io.mindroom.ai_run']).toEqual({ version: 1, status: 'completed' });
    render(content);

    expect(seamStates()).toEqual(['running']);
    expect(textOf(seams()[0]!.findByType('button'))).toMatch(/^Compacting context….*\d+ s$/);
    expect(
      renderer!.root.findAll((node) => node.type === 'button' && textOf(node).startsWith('Worked'))
    ).toHaveLength(0);
  });

  it('keeps the work of a long regenerated reply open when its own stream stopped or failed', () => {
    for (const streamStatus of ['cancelled', 'error']) {
      const regenerated = reply(paragraphs('Again.', markerLine('t1', 1), LONG_ANSWER), [running], {
        'io.mindroom.stream_status': streamStatus,
      });
      const content = withEdits(finished, regenerated).read();
      expect(content['io.mindroom.ai_run']).toEqual({ version: 1, status: 'completed' });
      render(content);

      expect(seamStates()).toEqual(['interrupted']);
      expect(
        renderer!.root.findAll(
          (node) => node.type === 'button' && textOf(node).startsWith('Worked')
        )
      ).toHaveLength(0);
    }
  });

  it('reads a stream status written as a record, as the other readers do', () => {
    const regeneration = (streamStatus: Record<string, unknown>) =>
      withEdits(
        finished,
        reply(paragraphs('Again.', markerLine('t1', 1), LONG_ANSWER), [running], {
          'io.mindroom.stream_status': streamStatus,
        })
      ).read();
    const worked = () =>
      renderer!.root.findAll((node) => node.type === 'button' && textOf(node).startsWith('Worked'));

    render(regeneration({ state: 'streaming' }));
    expect(seamStates()).toEqual(['running']);
    expect(worked()).toHaveLength(0);
    act(() => renderer?.unmount());
    renderer = undefined;

    render(regeneration({ status: 'cancelled' }));
    expect(seamStates()).toEqual(['interrupted']);
    expect(worked()).toHaveLength(0);
  });

  it('shows the seams a stop write carries, not those of the answer before', () => {
    render(withEdits(finished, stopped([failed])).read());

    expect(seamStates()).toEqual(['failed']);
  });

  it('shows a compaction a stop write carries as running as interrupted', () => {
    render(withEdits(finished, stopped([running])).read());

    expect(seamStates()).toEqual(['interrupted']);
  });

  it('shows the same seams when an older edit decrypts late', () => {
    // An older backend's stop write carries no list.
    const { [COMPACTIONS_CONTENT_KEY]: _none, ...bareStop } = stopped([]);
    const progress = reply(paragraphs('Again.', markerLine('t1', 1)), [running]);
    for (const [older, shown] of [
      [finished, stopped([failed])],
      [progress, bareStop],
    ]) {
      const { events, read } = withEdits(older!, shown!);
      const decrypted = vi.spyOn(events[0]!, 'isDecryptionFailure').mockReturnValue(true);
      render(read());
      const before = seamStates();
      decrypted.mockReturnValue(false);
      render(read());

      expect(seamStates()).toEqual(before);
      act(() => renderer?.unmount());
      renderer = undefined;
    }
  });
});

describe('an old compaction notice outside an open thread', () => {
  const notice = {
    msgtype: 'm.notice',
    body: '📦 Compacted 24 runs: 366,804 → 6,336 / 351,792 history budget',
    'io.mindroom.compaction': {
      version: 3,
      mode: 'auto',
      status: 'success',
      before_tokens: 366_804,
      after_tokens: 6336,
    },
  };

  it("draws an agent's notice as its seam row, in place of the notice text", () => {
    render(notice);

    expect(seamStates()).toEqual(['success']);
    expect(textOf(seams()[0]!)).toContain('Compacted context');
  });

  it("keeps a person's message with the compaction key as text", () => {
    render(notice, {
      fromMindroomAgent: false,
      displayName: 'Bob',
      msgType: 'm.notice',
      eventId: '$person',
    });

    expect(seams()).toHaveLength(0);
    expect(textOf(renderer!.root)).toContain('📦 Compacted 24 runs');
  });

  it('counts no seconds for a running notice without its event, whose start is unknown', () => {
    const running = {
      ...notice,
      'io.mindroom.compaction': { ...notice['io.mindroom.compaction'], status: 'running' },
    };
    render(running, { mEvent: undefined, msgType: 'm.notice', eventId: '$no-event' });

    expect(seamStates()).toEqual(['running']);
    expect(textOf(seams()[0]!.findByType('button'))).toBe('Compacting context…');
  });
});
