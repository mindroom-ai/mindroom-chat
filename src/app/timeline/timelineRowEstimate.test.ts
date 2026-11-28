import { MatrixClient, MatrixEvent, Room, type EventTimelineSet } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import * as roomUtils from '../matrix/room';
import { INTERACTIVE_INSTRUCTION_TEXT } from '../matrix/protocol/interactiveQuestion';
import { getLongTextSource, hydrateLongTextSource } from '../matrix/protocol/longText';
import { THREAD_SUMMARY_METADATA_KEY } from '../matrix/protocol/threadSummary';
import { estimateThreadEventRowHeight } from '../event-store/threads/threadRenderUtils';
import {
  columnWrapCharsForWidth,
  estimateFormattedBodyPx,
  estimateMessageRowHeight,
  estimateRoomRowHeight,
  estimateThreadRowHeight,
} from './timelineRowEstimate';

const MIN = 60_000;
const BASE_TS = 1_700_000_000_000;
const USER = '@alice:example.org';
const AGENT = '@mindroom_helper:example.org';
const FINE = { compact: false, coarsePointer: false } as const;
const COARSE = { compact: false, coarsePointer: true } as const;
const PHONE = { ...COARSE, wrapChars: 38 } as const;
const SHOW_TOOLS = { compact: false, showToolCalls: true } as const;
const AI_RUN = {
  version: 1,
  status: 'completed',
  model: { config: 'sonnet', id: 'claude-sonnet-4', provider: 'anthropic' },
};

const seq = (n: number, fn: (i: number) => string, sep = '\n') =>
  Array.from({ length: n }, (_, i) => fn(i)).join(sep);
const text = (body: string, extra?: Record<string, unknown>) => ({
  msgtype: 'm.text',
  body,
  ...extra,
});
const html = (formattedBody: string, body = 'rich', extra?: Record<string, unknown>) => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: formattedBody,
  ...extra,
});

type EventOpts = {
  id?: string;
  sender?: string;
  ts?: number;
  type?: string;
  content?: Record<string, unknown>;
  stateKey?: string;
};
const ev = ({
  id = '$e',
  sender = USER,
  ts = BASE_TS,
  type = 'm.room.message',
  content = text('hello'),
  stateKey,
}: EventOpts = {}) =>
  new MatrixEvent({
    content,
    event_id: id,
    origin_server_ts: ts,
    room_id: '!r:x',
    sender,
    type,
    ...(stateKey === undefined ? {} : { state_key: stateKey }),
  });
const agentEv = (id: string, content: Record<string, unknown>, ts = BASE_TS) =>
  ev({ id, sender: AGENT, content, ts });
const rx = (id: string, targetId: string, key: string, sender = USER, ts = BASE_TS + 1_000) =>
  ev({
    id,
    sender,
    ts,
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key } },
  });
const editEv = (
  id: string,
  targetId: string,
  newContent: Record<string, unknown>,
  extra?: { sender?: string; ts?: number; outer?: Record<string, unknown> }
) =>
  ev({
    id,
    sender: extra?.sender ?? USER,
    ts: extra?.ts ?? BASE_TS + 2_000,
    content: text(`* ${String(newContent.body ?? '')}`, {
      'm.new_content': newContent,
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
      ...extra?.outer,
    }),
  });

type MsgOpts = Parameters<typeof estimateMessageRowHeight>[1];
type RoomOpts = Parameters<typeof estimateRoomRowHeight>[2];
const msgH = (e: MatrixEvent, o: MsgOpts = { compact: false }) => estimateMessageRowHeight(e, o);
const threadH = (e: MatrixEvent, a?: MatrixEvent, o: MsgOpts = { compact: false }) =>
  estimateThreadRowHeight(e, a, o);
const roomH = (e: MatrixEvent, a?: MatrixEvent, o?: RoomOpts) => estimateRoomRowHeight(e, a, o);

const relSet = (targetId: string, relType: string, eventType: string, list: MatrixEvent[]) => {
  const bucket = { getRelations: () => list };
  return {
    relations: {
      getChildEventsForEvent: (id: string, rel: string, type: string) =>
        id === targetId && rel === relType && type === eventType ? bucket : undefined,
    },
  } as unknown as Pick<EventTimelineSet, 'relations'>;
};

const redact = (target: MatrixEvent, id: string) =>
  target.makeRedacted(
    new MatrixEvent({
      type: 'm.room.redaction',
      redacts: target.getId(),
      event_id: id,
      sender: USER,
      content: {},
    }),
    new Room('!r:x', {} as MatrixClient, USER)
  );

describe('estimateFormattedBodyPx', () => {
  it('returns undefined for plain/empty HTML and prices inline HTML from visible text (not URLs)', () => {
    expect(estimateFormattedBodyPx(text('plain'))).toBeUndefined();
    expect(estimateFormattedBodyPx(html('   ', 'plain'))).toBeUndefined();
    expect(estimateFormattedBodyPx(html('<p>one <strong>bold</strong> word</p>'))).toBe(22);

    const urls = Array.from(
      { length: 9 },
      (_, i) => `https://docs.example.org/services/alpha/shard-${i}/runbook-details-and-reference`
    );
    const mdBody = `Sources: ${urls.map((u, i) => `[${i + 1}](${u})`).join(' ')}`;
    const linkHtml = `<p>Sources: ${urls.map((u, i) => `<a href="${u}">${i + 1}</a>`).join(' ')}</p>`;
    expect(mdBody.length).toBeGreaterThan(700);
    // Visible HTML text is 1 line ("Sources: 1 ... 9"), NOT 19 lines of raw Markdown URLs.
    expect(estimateFormattedBodyPx(html(linkHtml, mdBody), 38)).toBe(22);
    expect(msgH(agentEv('$links', html(linkHtml, mdBody)), PHONE)).toBe(8 + 22);
  });

  it('prices code blocks (short, wrapped, >16-line collapsed), lists, and tables accurately', () => {
    const codeAndList = html(
      '<p>Reply <strong>1</strong></p><pre><code>function step() {\n  return 1;\n}</code></pre>' +
        '<ul><li>first point</li><li>second point</li></ul>'
    );
    expect(estimateFormattedBodyPx(codeAndList)).toBe(Math.round(52 + 3 * 19.5 + (3 + 0.8) * 22));

    const tenWrapped = html(
      `<pre><code>${seq(10, (i) => `const item_${i} = computeSummaryValue(input_${i}, option_${i});`)}</code></pre>`
    );
    const narrowCoarse = estimateFormattedBodyPx(tenWrapped, 38, true)!;
    expect(narrowCoarse).toBeGreaterThan(estimateFormattedBodyPx(tenWrapped, 110, false)!);
    expect(narrowCoarse).toBe(Math.round(71 + 20 * 19.5));

    const forty = html(`<pre><code>${seq(40, (i) => `line ${i}`)}</code></pre>`);
    expect(estimateFormattedBodyPx(forty, 48, false)).toBe(36 + 270);
    expect(estimateFormattedBodyPx(forty, 38, true)).toBe(53 + 270);

    const simple = html(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    );
    expect(estimateFormattedBodyPx(simple, 48)).toBe(2 * (17 + 22));

    const wide = html(
      '<table><tr><th>Stage</th><th>Target</th><th>Status</th></tr>' +
        '<tr><td>Phase 1</td><td>Service X</td><td>Verified and rolled out across all nodes</td></tr></table>'
    );
    expect(estimateFormattedBodyPx(wide, 38)!).toBe(estimateFormattedBodyPx(wide, 110)! + 66);
  });
});

describe('estimateMessageRowHeight', () => {
  it('handles plain text, edits, reactions, human 9-line fold vs full agent replies, and media', () => {
    const plain = ev({ content: text('one\ntwo\nthree') });
    expect(msgH(plain)).toBe(estimateThreadEventRowHeight(plain, { compact: false }));
    expect(msgH(editEv('$ed', '$e', text('a')))).toBe(0);
    expect(msgH(rx('$rx', '$e', '👍'))).toBe(0);

    const twenty = seq(20, (i) => `line ${i + 1}`);
    expect(msgH(ev({ content: text(twenty) }))).toBe(8 + 9 * 22);
    expect(msgH(agentEv('$a20', text(twenty)))).toBe(8 + 20 * 22);

    const sixty = html(
      `<ul>${seq(60, (i) => `<li>Item ${i + 1}: verify Service X</li>`, '')}</ul>`,
      seq(60, (i) => `- Item ${i + 1}: verify Service X`)
    );
    expect(msgH(agentEv('$a60', sixty))).toBe(8 + 60 * 22);

    const longCode = html(`<pre><code>${seq(30, (n) => `line ${n}`)}</code></pre>`);
    expect(msgH(ev({ content: longCode }))).toBe(8 + 9 * 22);
    expect(msgH(agentEv('$ac', longCode))).toBe(8 + 36 + 270);

    const img = ev({ content: { msgtype: 'm.image', body: 'a.png', info: { w: 800, h: 400 } } });
    const thumb = ev({
      id: '$t',
      content: { msgtype: 'm.image', body: '1\n2\n3\n4\n5\n6', info: { w: 20, h: 20 } },
    });
    expect(msgH(img)).toBe(8 + 200);
    expect(msgH(thumb)).toBe(8 + 6 * 22);
  });

  it('matches formatMarkdownTextBodyAsHtml parity on fences and inline-marker budget fallback', () => {
    const eighty = seq(80, (i) => `const step_${i} = runStage(${i});`);
    const htmlPx = msgH(agentEv('$h80', html(`<pre><code>${eighty}</code></pre>`, eighty)), PHONE);
    expect(htmlPx).toBe(8 + 53 + 270);
    // Unindented backticks collapse via formatMarkdownTextBodyAsHtml; tilde, indented, unclosed do not.
    expect(msgH(agentEv('$bt', text(`\`\`\`ts\n${eighty}\n\`\`\``)), PHONE)).toBe(htmlPx);
    expect(msgH(agentEv('$ti', text(`~~~ts\n${eighty}\n~~~`)), PHONE)).toBe(8 + 82 * 22);
    expect(msgH(agentEv('$in', text(`   \`\`\`ts\n${eighty}\n   \`\`\``)), PHONE)).toBe(
      8 + 82 * 22
    );
    expect(msgH(agentEv('$op', text(`\`\`\`ts\n${eighty}`)), PHONE)).toBe(8 + 81 * 22);

    // ~6 KB body-only Python snippet with >512 underscores exceeds formatMarkdownTextBodyAsHtml's
    // inline-marker budget (returns '') and prices in full, NOT collapsed to 331 px.
    const heavyPy = seq(
      90,
      (i) => `val_a_b_c_d_e_${i} = run_stage_check_value(${i}, max_retries_count)`
    );
    expect(heavyPy.length).toBeGreaterThan(5_000);
    expect(msgH(agentEv('$bud', text(`\`\`\`python\n${heavyPy}\n\`\`\``)), PHONE)).toBeGreaterThan(
      3_000
    );

    const ten = seq(10, (i) => `const check_${i} = verifyServiceHealth("service-${i}", timeout);`);
    expect(msgH(agentEv('$m10', text(`\`\`\`ts\n${ten}\n\`\`\``)), PHONE)).toBe(
      msgH(agentEv('$h10', html(`<pre><code>${ten}</code></pre>`, ten)), PHONE)
    );
  });

  it('sanitizes hydrated v3 long_text sidecars so restored tool markers fold finished work', async () => {
    const owner = {};
    const preview = {
      msgtype: 'm.file',
      body: 'Checking Service X...',
      url: 'mxc://example.org/sidecar-v3-folded',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      'io.mindroom.ai_run': AI_RUN,
      'io.mindroom.stream_status': 'completed',
    };
    const head = Array.from({ length: 20 }, (_, i) => `Step ${i + 1}: checking shard ${i + 1}.`);
    const sidecarJson = JSON.stringify({
      ...html(
        `${head.map((l) => `<p>${l}</p>`).join('\n')}\n<p>All checks passed.</p>`,
        `${head.join('\n')}\n\nAll checks passed.`
      ),
      'io.mindroom.tool_trace': {
        version: 3,
        events: [{ type: 'tool_call_completed', tool_name: 'shell', body_line: 21, at: 20 }],
      },
    });
    await hydrateLongTextSource(getLongTextSource(preview)!, async () => sidecarJson, owner);
    expect(msgH(agentEv('$v3', preview), { ...PHONE, longTextCacheOwner: owner })).toBe(
      8 + 28 + 22
    );
  });

  it('folds finished work by default and keeps pre-tool checklist height when expandAll/showToolCalls is on', () => {
    const checklist = seq(
      40,
      (i) => `<li>Check ${i + 1}: verify Service X shard ${i + 1}</li>`,
      ''
    );
    const reply = agentEv(
      '$folded-checklist',
      html(
        `<ul>${checklist}</ul><p>🔧 <code>shell</code> [1]</p><p>All checks passed.</p>`,
        'done',
        {
          'io.mindroom.ai_run': AI_RUN,
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.reasoning': { text: 'Planning checks.', duration_ms: 2100 },
        }
      )
    );
    expect(msgH(reply, { compact: false, showToolCalls: false })).toBe(8 + 28 + 22);
    expect(msgH(reply, SHOW_TOOLS)).toBeGreaterThan(8 + 40 * 22);
  });

  it('prices Reasoning, standalone ToolCallsFold cog, and consecutive vs separated visible tool runs', () => {
    const atStart = html(
      '<p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>shell</code> [2]</p><p>Summary ready.</p>',
      '🔧 `read_file` [1]\n🔧 `shell` [2]\nSummary ready.',
      { 'io.mindroom.ai_run': AI_RUN, 'io.mindroom.stream_status': 'completed' }
    );
    const noReason = agentEv('$t-only', atStart);
    expect(msgH(noReason, { ...FINE, showToolCalls: false })).toBe(8 + 26 + 22);
    expect(msgH(noReason, { ...COARSE, showToolCalls: false })).toBe(8 + 36 + 22);
    expect(msgH(noReason, SHOW_TOOLS)).toBe(8 + 38 + 22);

    const live = { 'io.mindroom.ai_run': AI_RUN, 'io.mindroom.stream_status': 'streaming' };
    const twelve = agentEv(
      '$t12',
      html(
        `${seq(12, (i) => `<p>🔧 <code>s_${i + 1}</code> [${i + 1}]</p>`, '')}<p>Done.</p>`,
        'Done.',
        live
      )
    );
    const twoHtml = agentEv(
      '$t2h',
      html(
        '<p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>grep</code> [2]</p><p>Checking.</p><p>🔧 <code>shell</code> [3]</p>',
        'Checking.',
        live
      )
    );
    const onePlain = agentEv(
      '$t1p',
      text('🔧 `read_file` [1]\n🔧 `grep` [2]\n\n🔧 `shell` [3]\nSummary.', live)
    );
    const twoPlain = agentEv('$t2p', text('🔧 `read_file` [1]\nChecking.\n🔧 `shell` [2]', live));
    expect(msgH(twelve, SHOW_TOOLS)).toBe(8 + 38 + 22);
    expect(msgH(twoHtml, SHOW_TOOLS)).toBe(8 + 2 * 38 + 22);
    expect(msgH(onePlain, SHOW_TOOLS)).toBe(8 + 38 + 22);
    expect(msgH(twoPlain, SHOW_TOOLS)).toBe(8 + 2 * 38 + 22);

    const withReason = agentEv('$t-reason', {
      ...atStart,
      'io.mindroom.reasoning': { text: 'Check', duration_ms: 1200 },
    });
    expect(msgH(withReason, { ...COARSE, showToolCalls: false })).toBe(8 + 28 + 22);
  });

  it('strips 80-line Matrix reply fallbacks and adds quote height only when a reply quote renders', () => {
    const quoted = Array.from({ length: 80 }, (_, i) => `Quoted line ${i + 1} for Service X.`);
    const fbBody = `> <${USER}> ${quoted[0]}\n${quoted
      .slice(1)
      .map((l) => `> ${l}`)
      .join('\n')}\n\nDone.`;
    const fbHtml = `<mx-reply><blockquote><a href="https://matrix.to/#/!r/$t">In reply to</a> <a href="https://matrix.to/#/${USER}">${USER}</a><br/>${quoted.join('<br/>')}</blockquote></mx-reply>Done.`;
    const target = ev({ id: '$target' });
    const other = ev({ id: '$other', sender: '@bob:example.org', ts: BASE_TS + 1000 });
    const inReply = { 'm.relates_to': { 'm.in_reply_to': { event_id: '$target' } } };

    const genuine = agentEv('$rh', html(fbHtml, fbBody, inReply), BASE_TS + 2000);
    expect(estimateThreadEventRowHeight(genuine, { compact: false })).toBe(8 + 22);
    expect(msgH(genuine)).toBe(8 + 22);
    expect(threadH(genuine, other)).toBe(8 + 22 + 24 + 38);
    expect(threadH(genuine, target)).toBe(68);

    const bodyOnly = agentEv('$rp', text(fbBody, inReply), BASE_TS + 3000);
    expect(threadH(bodyOnly, other)).toBe(8 + 22 + 24 + 38);

    const threadFb = agentEv(
      '$rt',
      html(fbHtml, fbBody, {
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$target',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$target' },
        },
      }),
      BASE_TS + 4000
    );
    expect(threadH(threadFb, other)).toBe(68);
  });

  it('prices unanswered vs answered QuestionCards and invalidates cache on answer arrival or retraction', () => {
    const qText = 'Which cluster should run the rollout?';
    const labels = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
    const keys = labels.map((_, i) => `${i + 1}\uFE0F\u20E3`);
    const interactive = {
      version: 1,
      question_text: qText,
      options: Object.fromEntries(keys.map((k, i) => [k, labels[i]!.toLowerCase()])),
      option_labels: Object.fromEntries(keys.map((k, i) => [k, labels[i]!])),
    };

    const plainQ = agentEv('$q6', text(qText, { 'io.mindroom.interactive': interactive }));
    const rxs = [
      rx('$seed', '$q6', keys[0]!, AGENT, BASE_TS + 1000),
      rx('$like', '$q6', '👍', USER, BASE_TS + 2000),
    ];
    const opts = {
      compact: false,
      wrapChars: 48,
      timelineSet: relSet('$q6', 'm.annotation', 'm.reaction', rxs),
    };
    const unanswered = msgH(plainQ, opts);
    expect(unanswered).toBe(8 + 22 + 30 + 6 * 42);

    // Swap 👍 -> answer reaction (active count stays 2) to verify exact answer-state invalidation.
    redact(rxs[1]!, '$r-like');
    const answer = rx('$ans', '$q6', keys[1]!, USER, BASE_TS + 3_000);
    rxs.push(answer);
    const answered = msgH(plainQ, opts);
    expect(answered).toBe(8 + 22 + 30 + 42);
    expect(unanswered - answered).toBe(5 * 42);

    redact(answer, '$r-ans');
    expect(msgH(plainQ, opts)).toBe(unanswered);

    const fbContent = html(
      `<p>${qText}</p><ol>${keys.map((k, i) => `<li>${k} ${labels[i]}</li>`).join('')}</ol><p>${INTERACTIVE_INSTRUCTION_TEXT}</p>`,
      `${qText}\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n${INTERACTIVE_INSTRUCTION_TEXT}`,
      { 'io.mindroom.interactive': interactive }
    );
    const fbQ = agentEv('$q6-fb', fbContent);
    const fbRxs: MatrixEvent[] = [];
    const fbOpts = {
      compact: false,
      wrapChars: 48,
      timelineSet: relSet('$q6-fb', 'm.annotation', 'm.reaction', fbRxs),
    };
    const fbBodyPx = estimateFormattedBodyPx(fbContent, 48)!;
    const unansweredFb = msgH(fbQ, fbOpts);
    expect(unansweredFb).toBe(8 + fbBodyPx + 6 * 20);

    fbRxs.push(rx('$fb-ans', '$q6-fb', keys[2]!, USER, BASE_TS + 4_000));
    const answeredFb = msgH(fbQ, fbOpts);
    expect(answeredFb).toBe(8 + fbBodyPx + 20 - 5 * 22);
    expect(unansweredFb - answeredFb).toBe(5 * (20 + 22));
  });
});

describe('estimateMessageRowHeight reuse and edit awareness', () => {
  it('reuses WeakMap entries until content, edits, metadata, or redaction change', () => {
    const reply = ev({ content: text('one\ntwo') });
    const relation = vi.spyOn(reply, 'getRelation');
    expect(msgH(reply)).toBe(8 + 2 * 22);
    const reads = relation.mock.calls.length;
    expect(msgH(reply)).toBe(8 + 2 * 22);
    expect(relation.mock.calls.length).toBe(reads);
    expect(msgH(reply, { compact: true })).toBe(6 + 2 * 22);

    const twelve = seq(12, (i) => `line ${i + 1}`);
    reply.makeReplaced(editEv('$edit', '$e', text(twelve)));
    expect(msgH(reply)).toBe(8 + 9 * 22);

    reply.getContent()[THREAD_SUMMARY_METADATA_KEY] = true;
    expect(msgH(reply)).toBe(8 + 12 * 22);

    redact(reply, '$redaction');
    expect(msgH(reply)).toBe(estimateThreadEventRowHeight(reply, { compact: false }));
    expect(msgH(reply)).not.toBe(8 + 12 * 22);
  });

  it('resolves unapplied m.replace edits once and invalidates on in-place mutation or newer edit', () => {
    const target = agentEv(
      '$think',
      text('Thinking...', {
        'io.mindroom.ai_run': AI_RUN,
        'io.mindroom.stream_status': 'streaming',
      })
    );
    const fifteen = seq(15, (i) => `Line ${i + 1}: short result.`);
    const done = { 'io.mindroom.ai_run': AI_RUN, 'io.mindroom.stream_status': 'completed' };
    const edit = editEv('$e1', '$think', text(fifteen, done), {
      sender: AGENT,
      outer: { 'io.mindroom.ai_run': AI_RUN },
    });
    const edits = [edit];
    const opts = { ...PHONE, timelineSet: relSet('$think', 'm.replace', 'm.room.message', edits) };
    const editedSpy = vi.spyOn(roomUtils, 'getEditedEvent');
    const latestSpy = vi.spyOn(roomUtils, 'getLatestMessageContent');
    try {
      const firstPx = threadH(target, undefined, opts);
      expect(firstPx).toBe(8 + 15 * 22 + 60);
      for (let i = 0; i < 4; i += 1) expect(threadH(target, undefined, opts)).toBe(firstPx);
      expect(editedSpy).toHaveBeenCalledTimes(1);
      expect(latestSpy).toHaveBeenCalledTimes(1);

      (edit.getContent()['m.new_content'] as Record<string, unknown>)['io.mindroom.reasoning'] = {
        text: 'Added.',
      };
      expect(threadH(target, undefined, opts)).toBe(firstPx + 28);
      expect(editedSpy).toHaveBeenCalledTimes(2);

      edits.push(
        editEv('$e2', '$think', text('Short final', done), { sender: AGENT, ts: BASE_TS + 4_000 })
      );
      expect(threadH(target, undefined, opts)).toBe(8 + 28 + 22 + 60);
      expect(editedSpy).toHaveBeenCalledTimes(3);
    } finally {
      editedSpy.mockRestore();
      latestSpy.mockRestore();
    }
  });
});

describe('estimateThreadRowHeight and estimateRoomRowHeight', () => {
  const first = ev({ id: '$first' });

  it('applies author headers, coarse SenderLine, ModelBadge floor, compact mode, day dividers, and badges', () => {
    expect(threadH(first, undefined, FINE)).toBe(68);
    expect(threadH(first, undefined, COARSE)).toBe(90);
    expect(threadH(first, undefined, { compact: true, coarsePointer: true })).toBe(6 + 22);

    const agentShort = agentEv(
      '$a-short',
      text('ok', { 'io.mindroom.ai_run': AI_RUN }),
      BASE_TS + 1_000
    );
    expect(threadH(agentShort, first, FINE)).toBe(94);
    expect(threadH(agentShort, first, COARSE)).toBe(114);

    const nextDay = ev({ id: '$next-day', ts: BASE_TS + 24 * 60 * MIN });
    expect(threadH(nextDay, first, COARSE)).toBe(90 + 34);
    expect(threadH(nextDay, first, { compact: true, coarsePointer: true })).toBe(6 + 22 + 34);
    expect(roomH(nextDay, first)).toBe(68 + 34);
    expect(roomH(first, undefined, { threadBadge: true })).toBe(68 + 31);
  });

  it('handles room group continuation, agent ownRun separation, column width wrapping, and state events', () => {
    expect(roomH(ev({ id: '$3', content: text('a\nb\nc') }))).toBe(8 + 3 * 22 + 38);
    expect(roomH(ev({ id: '$next', ts: BASE_TS + 1_000 }), first)).toBe(30);
    expect(roomH(ev({ id: '$later', ts: BASE_TS + 5 * MIN }), first)).toBe(68);
    expect(roomH(ev({ id: '$other', sender: '@bob:example.org', ts: BASE_TS + 1 }), first)).toBe(
      68
    );

    const ownRun = ev({
      id: '$run',
      ts: BASE_TS + 1_000,
      content: text('hi', { 'io.mindroom.ai_run': { version: 1, status: 'completed' } }),
    });
    const stream = agentEv(
      '$stream',
      text('hi', { 'io.mindroom.stream_status': 'streaming' }),
      BASE_TS + 1_000
    );
    expect(roomH(ownRun, first)).toBe(68);
    expect(roomH(stream, agentEv('$a1', text('hi')))).toBe(68);

    expect([undefined, 390, 960, 200].map(columnWrapCharsForWidth)).toEqual([48, 38, 110, 24]);

    const four = agentEv(
      '$step',
      text('Step 1/3 for Item A: inspecting Service X rollout diagnostics.\n'.repeat(4))
    );
    const phoneC = roomH(four, first, { wrapChars: 38, coarsePointer: true });
    const deskF = roomH(four, first, { wrapChars: 110, coarsePointer: false });
    expect(phoneC - deskF).toBe(4 * 22 + (60 - 38));

    expect(
      roomH(ev({ type: 'm.room.member', stateKey: USER, content: { membership: 'join' } }))
    ).toBe(28);
    expect(roomH(ev({ type: 'm.room.power_levels', stateKey: '', content: {} }))).toBe(0);
    expect(roomH(ev({ type: 'm.call.invite', content: {} }), first)).toBe(0);
  });
});
