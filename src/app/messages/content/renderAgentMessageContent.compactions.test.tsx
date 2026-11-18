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
import { renderAgentMessageContent } from './renderAgentMessageContent';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { showToolCalls } from '../../../test/utils/showToolCalls';
import { LIVE_COMPACTIONS_KEY } from '../live/useLiveReplyContent';
import { COMPACTIONS_CONTENT_KEY } from '../../matrix/protocol/compactions';
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

// The real RenderBody and its memo, under an MText that passes the body alone, as a reply that
// arrives without its HTML does, so the agent's Markdown body renders as MindRoom writes it.
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
  return { RenderBody };
});
vi.mock('./BrokenContent', async () => ({ BrokenContent: () => null }));
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
  Tag: 'Tag',
  Subtitle: 'Subtitle',
  Gauge: 'Gauge',
  GaugeWas: 'GaugeWas',
  GaugeNow: 'GaugeNow',
  GaugeLabel: 'GaugeLabel',
  Rows: 'Rows',
  Term: 'Term',
  Value: 'Value',
  Reason: 'Reason',
}));
vi.mock('../agent-run/OutlineComet.css', () => ({ Outline: 'Outline' }));
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

const render = (content: Record<string, unknown>) =>
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
          })}
        </ToolCallsFold>
      </ClientConfigProvider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
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
  beforeEach(() => {
    replyCount += 1;
    replyId = `$reply${replyCount}`;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

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
  beforeEach(() => {
    replyCount += 1;
    replyId = `$reply${replyCount}`;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('keeps every seam in the folded work of a long finished reply, none in the answer', () => {
    const answer = 'The answer.'.padEnd(6000, ' More.');
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
        { 'io.mindroom.ai_run': { version: 1, status: 'completed' } }
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
    const answer = 'The answer.'.padEnd(6000, ' More.');
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

  it("shows no seam from a person's downloaded sidecar", () => {
    sidecars.set('mxc://example.org/person', {
      ...reply(paragraphs('Intro.', 'More.'), [entry('c1', 0)]),
      [LIVE_COMPACTIONS_KEY]: [entry('c2', 0, { status: 'running' })],
    });
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          {renderAgentMessageContent({
            mEvent,
            eventId: '$person-long',
            fromMindroomAgent: false,
            displayName: 'Bob',
            msgType: 'm.text',
            content: {
              msgtype: 'm.text',
              body: 'Intro.',
              url: 'mxc://example.org/person',
              'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
            },
            htmlReactParserOptions,
            linkifyOpts,
          })}
        </ClientConfigProvider>
      );
    });
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

describe('an old compaction notice outside an open thread', () => {
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

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
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          {renderAgentMessageContent({
            mEvent,
            eventId: '$person',
            fromMindroomAgent: false,
            displayName: 'Bob',
            msgType: 'm.notice',
            content: notice,
            htmlReactParserOptions,
            linkifyOpts,
          })}
        </ClientConfigProvider>
      );
    });

    expect(seams()).toHaveLength(0);
  });

  it('counts no seconds for a running notice without its event, whose start is unknown', () => {
    const running = {
      ...notice,
      'io.mindroom.compaction': { ...notice['io.mindroom.compaction'], status: 'running' },
    };
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          {renderAgentMessageContent({
            eventId: '$no-event',
            fromMindroomAgent: true,
            displayName: 'Agent',
            msgType: 'm.notice',
            content: running,
            htmlReactParserOptions,
            linkifyOpts,
          })}
        </ClientConfigProvider>
      );
    });

    expect(seamStates()).toEqual(['running']);
    expect(textOf(seams()[0]!.findByType('button'))).toBe('Compacting context…');
  });
});
