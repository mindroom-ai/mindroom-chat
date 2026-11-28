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

const MINUTE = 60_000;
const AGENT = '@mindroom_helper:example.org';
const AI_RUN_WITH_MODEL = {
  version: 1,
  status: 'completed',
  model: { config: 'sonnet', id: 'claude-sonnet-4', provider: 'anthropic' },
};

const makeEvent = ({
  id = '$event',
  sender = '@alice:example.org',
  ts = 1_700_000_000_000,
  type = 'm.room.message',
  content = { msgtype: 'm.text', body: 'hello' },
  stateKey,
}: {
  id?: string;
  sender?: string;
  ts?: number;
  type?: string;
  content?: Record<string, unknown>;
  stateKey?: string;
} = {}) =>
  new MatrixEvent({
    content,
    event_id: id,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type,
    ...(stateKey === undefined ? {} : { state_key: stateKey }),
  });

const html = (formattedBody: string, body = 'rich', extra: Record<string, unknown> = {}) => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: formattedBody,
  ...extra,
});

const makeTimelineSetWithReplace = (
  targetId: string,
  edits: MatrixEvent[]
): Pick<EventTimelineSet, 'relations'> => {
  const relationBucket = { getRelations: () => edits };
  return {
    relations: {
      getChildEventsForEvent: (eventId: string, relType: string, eventType: string) => {
        if (eventId === targetId && relType === 'm.replace' && eventType === 'm.room.message') {
          return relationBucket;
        }
        return undefined;
      },
    },
  } as unknown as Pick<EventTimelineSet, 'relations'>;
};

const codeReply = html(
  '<p>Reply <strong>1</strong></p><pre><code>function step() {\n  return 1;\n}</code></pre>' +
    '<ul><li>first point</li><li>second point</li></ul>'
);

describe('estimateFormattedBodyPx', () => {
  it('leaves plain text and inline HTML to the text estimate', () => {
    expect(estimateFormattedBodyPx({ msgtype: 'm.text', body: 'plain' })).toBeUndefined();
    expect(estimateFormattedBodyPx(html('<p>one <strong>bold</strong> word</p>'))).toBeUndefined();
  });

  it('prices short code blocks by wrapped lines and lists by items', () => {
    // Paragraph (1) + 2 list items (2) = 3 lines, 2 block gaps (0.8 lines) + 3-line code block (52 + 3 * 19.5).
    expect(estimateFormattedBodyPx(codeReply)).toBe(Math.round(52 + 3 * 19.5 + (3 + 0.8) * 22));
  });

  it('wraps short code blocks at narrow widths and collapses code blocks past 16 logical lines', () => {
    const tenWrappedLines = html(
      `<pre><code>${Array.from(
        { length: 10 },
        (_, i) => `const check_${i} = verifyServiceHealth("service-${i}", timeout);`
      ).join('\n')}</code></pre>`
    );
    const narrowCoarse = estimateFormattedBodyPx(tenWrappedLines, 38, true)!;
    const desktopFine = estimateFormattedBodyPx(tenWrappedLines, 110, false)!;
    // Narrow wraps each 60-char line to 2 lines (20 * 19.5 + 71) vs desktop 1 line (10 * 19.5 + 52).
    expect(narrowCoarse).toBe(Math.round(71 + 20 * 19.5));
    expect(desktopFine).toBe(Math.round(52 + 10 * 19.5));
    expect(narrowCoarse).toBeGreaterThan(desktopFine);

    const fortyLines = html(
      `<pre><code>${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}</code></pre>`
    );
    expect(estimateFormattedBodyPx(fortyLines, 48, false)).toBe(36 + 270);
    expect(estimateFormattedBodyPx(fortyLines, 38, true)).toBe(53 + 270);
  });

  it('prices table rows from wrapped cell text and adds narrow wide-table controls', () => {
    const simpleTable = html(
      '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'
    );
    expect(estimateFormattedBodyPx(simpleTable, 48)).toBe(2 * (17 + 22));

    const multiLineWideTable = html(
      '<table>' +
        '<tr><th>Component</th><th>State</th><th>Responsibility</th></tr>' +
        '<tr><td>Service A</td><td>Active</td><td>Handles primary ingress routing and TLS termination across edge nodes in region alpha.</td></tr>' +
        '<tr><td>Service B</td><td>Active</td><td>Processes background worker queues with exponential backoff and archival pipelines.</td></tr>' +
        '</table>'
    );
    const narrow = estimateFormattedBodyPx(multiLineWideTable, 38)!;
    const desktop = estimateFormattedBodyPx(multiLineWideTable, 110)!;
    // Header row (1 line = 39) + 2 wrapped body rows (2 lines each = 61 * 2) = 161 desktop; +66 narrow controls.
    expect(desktop).toBe(39 + 61 + 61);
    expect(narrow).toBe(desktop + 66);
  });
});

describe('estimateMessageRowHeight', () => {
  it('matches the text estimate for plain messages, edits and reactions', () => {
    const plain = makeEvent({ content: { msgtype: 'm.text', body: 'one\ntwo\nthree' } });
    expect(estimateMessageRowHeight(plain, { compact: false })).toBe(
      estimateThreadEventRowHeight(plain, { compact: false })
    );
    const edit = makeEvent({
      content: {
        msgtype: 'm.text',
        body: '* edited',
        'm.new_content': { msgtype: 'm.text', body: 'edited' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$event' },
      },
    });
    expect(estimateMessageRowHeight(edit, { compact: false })).toBe(0);
  });

  it('folds long human messages at 9 lines while pricing long plain-text and inline-HTML agent replies in full', () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Step ${i + 1}: verify Service X health check in staging.`
    );
    const inlineHtmlContent = html(
      paragraphs.map((p) => `<p><strong>Note:</strong> ${p}</p>`).join(''),
      paragraphs.join('\n\n')
    );
    const human = makeEvent({ id: '$human-long', content: inlineHtmlContent });
    const agentInline = makeEvent({
      id: '$agent-inline',
      sender: AGENT,
      content: inlineHtmlContent,
    });
    const agentPlain = makeEvent({
      id: '$agent-plain',
      sender: AGENT,
      content: { msgtype: 'm.text', body: paragraphs.join('\n') },
    });

    expect(estimateMessageRowHeight(human, { compact: false, wrapChars: 38 })).toBe(8 + 9 * 22);
    expect(
      estimateMessageRowHeight(agentInline, { compact: false, wrapChars: 38 })
    ).toBeGreaterThan(960);
    expect(estimateMessageRowHeight(agentPlain, { compact: false, wrapChars: 38 })).toBeGreaterThan(
      800
    );
  });

  it('prices >48-line agent replies past 960 px', () => {
    const richList = html(
      `<ul>${Array.from({ length: 60 }, (_, i) => `<li>Item ${i + 1}: verify Service X</li>`).join('')}</ul>`,
      Array.from({ length: 60 }, (_, i) => `- Item ${i + 1}: verify Service X`).join('\n')
    );
    const agent = makeEvent({ id: '$agent-60', sender: AGENT, content: richList });
    expect(estimateMessageRowHeight(agent, { compact: false, wrapChars: 48 })).toBe(8 + 60 * 22);
    expect(estimateMessageRowHeight(agent, { compact: false, wrapChars: 48 })).toBeGreaterThan(960);
  });

  it('folds a rich message from a person and shows a collapsed code block for an agent', () => {
    const longCode = html(
      `<pre><code>${Array.from({ length: 30 }, (_v, n) => `line ${n}`).join('\n')}</code></pre>`,
      Array.from({ length: 30 }, (_v, n) => `line ${n}`).join('\n')
    );
    const person = makeEvent({ content: longCode });
    const agent = makeEvent({ content: longCode, sender: AGENT });
    expect(estimateMessageRowHeight(person, { compact: false })).toBe(8 + 9 * 22);
    expect(estimateMessageRowHeight(agent, { compact: false })).toBe(8 + 36 + 270);
  });

  it('sizes images within the media box and keeps tall captions on small images', () => {
    const image = makeEvent({
      content: { msgtype: 'm.image', body: 'cat.png', info: { w: 800, h: 400 } },
    });
    expect(estimateMessageRowHeight(image, { compact: false })).toBe(8 + 200);
    const captionedThumb = makeEvent({
      id: '$thumb',
      content: {
        msgtype: 'm.image',
        body: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6',
        info: { w: 20, h: 20 },
      },
    });
    expect(estimateMessageRowHeight(captionedThumb, { compact: false })).toBe(8 + 6 * 22);
  });

  it('prices body-only Markdown fenced code blocks comparably to HTML pre/code blocks', () => {
    const eightyLines = Array.from(
      { length: 80 },
      (_, i) => `const step_${i} = runStage(${i});`
    ).join('\n');
    const htmlCode = makeEvent({
      id: '$html-80',
      sender: AGENT,
      content: html(`<pre><code>${eightyLines}</code></pre>`, eightyLines),
    });
    const backtickMd = makeEvent({
      id: '$md-backtick-80',
      sender: AGENT,
      content: { msgtype: 'm.text', body: `\`\`\`ts\n${eightyLines}\n\`\`\`` },
    });
    const tildeMd = makeEvent({
      id: '$md-tilde-80',
      sender: AGENT,
      content: { msgtype: 'm.text', body: `~~~ts\n${eightyLines}\n~~~` },
    });
    // Collapsed on phone: base (8) + coarse collapsed header (53) + 270 = 331 px (not ~1,768 px).
    const htmlPx = estimateMessageRowHeight(htmlCode, {
      compact: false,
      wrapChars: 38,
      coarsePointer: true,
    });
    expect(htmlPx).toBe(8 + 53 + 270);
    expect(
      estimateMessageRowHeight(backtickMd, { compact: false, wrapChars: 38, coarsePointer: true })
    ).toBe(htmlPx);
    expect(
      estimateMessageRowHeight(tildeMd, { compact: false, wrapChars: 38, coarsePointer: true })
    ).toBe(htmlPx);

    const tenShortLines = Array.from(
      { length: 10 },
      (_, i) => `const check_${i} = verifyServiceHealth("service-${i}", timeout);`
    ).join('\n');
    const mdShort = makeEvent({
      id: '$md-short-10',
      sender: AGENT,
      content: { msgtype: 'm.text', body: `\`\`\`ts\n${tenShortLines}\n\`\`\`` },
    });
    const htmlShort = makeEvent({
      id: '$html-short-10',
      sender: AGENT,
      content: html(`<pre><code>${tenShortLines}</code></pre>`, tenShortLines),
    });
    expect(
      estimateMessageRowHeight(mdShort, { compact: false, wrapChars: 38, coarsePointer: true })
    ).toBe(
      estimateMessageRowHeight(htmlShort, { compact: false, wrapChars: 38, coarsePointer: true })
    );
  });

  it('sanitizes hydrated v3 long_text sidecars so restored tool markers fold finished work', async () => {
    const owner = {};
    const previewContent = {
      msgtype: 'm.file',
      body: 'Checking Service X...',
      url: 'mxc://example.org/sidecar-v3-folded',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
      'io.mindroom.stream_status': 'completed',
    };
    const source = getLongTextSource(previewContent)!;
    const headLines = Array.from(
      { length: 20 },
      (_, i) => `Step ${i + 1}: checking logs for Service X shard ${i + 1}.`
    );
    const body = `${headLines.join('\n')}\n\nAll checks passed.`;
    const formattedBody = `${headLines.map((l) => `<p>${l}</p>`).join('\n')}\n<p>All checks passed.</p>\n`;
    const sidecarJson = JSON.stringify({
      msgtype: 'm.text',
      body,
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
      'io.mindroom.tool_trace': {
        version: 3,
        events: [{ type: 'tool_call_completed', tool_name: 'shell', body_line: 21, at: 20 }],
      },
    });
    await hydrateLongTextSource(source, async () => sidecarJson, owner);

    const sidecarEvent = makeEvent({
      id: '$v3-sidecar',
      sender: AGENT,
      content: previewContent,
    });
    // Without sanitizeContent, 20 head paragraphs would price >450 px; with restored 🔧 markers,
    // FinishedWorkFold folds the head to base (8) + bar (28) + 1-line answer (22) = 58 px.
    expect(
      estimateMessageRowHeight(sidecarEvent, {
        compact: false,
        wrapChars: 38,
        coarsePointer: true,
        longTextCacheOwner: owner,
      })
    ).toBe(8 + 28 + 22);
  });

  it('prices FinishedWorkFold as 28 px + tail instead of hidden intermediate tool work', () => {
    const headParagraphs = Array.from(
      { length: 20 },
      (_, i) => `<p>Step ${i + 1}: checking logs for Service X shard ${i + 1}.</p>`
    ).join('');
    const content = html(
      `${headParagraphs}<p>🔧 <code>shell</code> [1]</p><p>All checks passed.</p>`,
      'Checking logs...\n\n🔧 `shell` [1]\n\nAll checks passed.',
      {
        'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.reasoning': { text: 'Planning verification steps.', duration_ms: 2100 },
      }
    );
    const reply = makeEvent({ id: '$folded-work', sender: AGENT, content });
    // Base (8) + FinishedWorkFold bar (28) + 1-line tail (22) = 58 (not 20 lines of hidden work!).
    expect(estimateMessageRowHeight(reply, { compact: false, showToolCalls: false })).toBe(
      8 + 28 + 22
    );
  });

  it('prices Reasoning, standalone ToolCallsFold cog, and visible tool rows accurately', () => {
    const toolsOnlyAtStart = html(
      '<p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>shell</code> [2]</p><p>Summary ready.</p>',
      '🔧 `read_file` [1]\n🔧 `shell` [2]\nSummary ready.',
      {
        'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
        'io.mindroom.stream_status': 'completed',
      }
    );
    const noReasoning = makeEvent({ id: '$tools-only', sender: AGENT, content: toolsOnlyAtStart });
    // Hidden tool calls: base (8) + standalone cog (26 fine / 36 coarse) + 1-line body (22), excluding 🔧 lines.
    expect(
      estimateMessageRowHeight(noReasoning, {
        compact: false,
        coarsePointer: false,
        showToolCalls: false,
      })
    ).toBe(8 + 26 + 22);
    expect(
      estimateMessageRowHeight(noReasoning, {
        compact: false,
        coarsePointer: true,
        showToolCalls: false,
      })
    ).toBe(8 + 36 + 22);
    // Shown tool calls: base (8) + 2 tool rows (2 * 38) + 1-line body (22).
    expect(
      estimateMessageRowHeight(noReasoning, {
        compact: false,
        coarsePointer: false,
        showToolCalls: true,
      })
    ).toBe(8 + 2 * 38 + 22);

    const withReasoning = makeEvent({
      id: '$tools-and-reasoning',
      sender: AGENT,
      content: {
        ...toolsOnlyAtStart,
        'io.mindroom.reasoning': { text: 'Checking Service X', duration_ms: 1200 },
      },
    });
    // With reasoning and hidden tool calls, cog shares the 28 px reasoning line.
    expect(
      estimateMessageRowHeight(withReasoning, {
        compact: false,
        coarsePointer: true,
        showToolCalls: false,
      })
    ).toBe(8 + 28 + 22);
  });

  it('adds QuestionCard and option heights for interactive questions', () => {
    const questionText = 'Which environment should receive the rollout first?';
    const interactive = {
      version: 1,
      question_text: questionText,
      options: {
        '1': 'staging',
        '1️⃣': 'staging',
        '2': 'canary',
        '2️⃣': 'canary',
        '3': 'prod',
        '3️⃣': 'prod',
      },
      option_labels: {
        '1': 'Staging',
        '1️⃣': 'Staging',
        '2': 'Canary',
        '2️⃣': 'Canary',
        '3': 'Production',
        '3️⃣': 'Production',
      },
    };
    const withoutFallback = makeEvent({
      id: '$q-plain',
      sender: AGENT,
      content: {
        msgtype: 'm.text',
        body: questionText,
        'io.mindroom.interactive': interactive,
      },
    });
    const plainOnly = makeEvent({
      id: '$plain-only',
      sender: AGENT,
      content: { msgtype: 'm.text', body: questionText },
    });
    const qPx = estimateMessageRowHeight(withoutFallback, { compact: false, wrapChars: 38 });
    const plainPx = estimateMessageRowHeight(plainOnly, { compact: false, wrapChars: 38 });
    // Card chrome (30) + 3 options * 42 = +156 px over body.
    expect(qPx - plainPx).toBe(30 + 3 * 42);

    const fallbackHtmlContent = html(
      `<p>${questionText}</p><ol><li>1️⃣ Staging</li><li>2️⃣ Canary</li><li>3️⃣ Production</li></ol><p>${INTERACTIVE_INSTRUCTION_TEXT}</p>`,
      `${questionText}\n1. Staging\n2. Canary\n3. Production\n${INTERACTIVE_INSTRUCTION_TEXT}`,
      { 'io.mindroom.interactive': interactive }
    );
    const withFallback = makeEvent({
      id: '$q-fallback',
      sender: AGENT,
      content: fallbackHtmlContent,
    });
    const fallbackPx = estimateMessageRowHeight(withFallback, { compact: false, wrapChars: 48 });
    const fallbackBodyPx = estimateFormattedBodyPx(fallbackHtmlContent, 48)!;
    // Base (8) + fallback body + 3 options * 20 px button delta.
    expect(fallbackPx).toBe(8 + fallbackBodyPx + 3 * 20);
  });
});

describe('estimateMessageRowHeight reuse and edit awareness', () => {
  it('prices a row once until what it shows changes', () => {
    const reply = makeEvent({ content: { msgtype: 'm.text', body: 'one\ntwo' } });
    const relation = vi.spyOn(reply, 'getRelation');
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(8 + 2 * 22);
    const reads = relation.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    // The virtual list prices every unmeasured row again at each render.
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(8 + 2 * 22);
    expect(relation.mock.calls.length).toBe(reads);

    expect(estimateMessageRowHeight(reply, { compact: true })).toBe(6 + 2 * 22);

    // An edit gives the row other content.
    const twelveLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
    const edit = makeEvent({
      id: '$edit',
      content: {
        msgtype: 'm.text',
        body: `* ${twelveLines}`,
        'm.new_content': { msgtype: 'm.text', body: twelveLines },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$event' },
      },
    });
    reply.makeReplaced(edit);
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(8 + 9 * 22);

    // Metadata an older edit lends is written into the shown content in place.
    reply.getContent()[THREAD_SUMMARY_METADATA_KEY] = true;
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(
      estimateThreadEventRowHeight(reply, { compact: false })
    );
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(8 + 12 * 22);
  });

  it('resolves unapplied m.replace edits once and skips getEditedEvent on repeated cache hits', () => {
    const target = makeEvent({
      id: '$thinking',
      sender: AGENT,
      content: { msgtype: 'm.text', body: 'Thinking...', 'io.mindroom.stream_status': 'streaming' },
    });
    const replacedLines = Array.from({ length: 15 }, (_, i) => `Step ${i + 1}: Service X ok`).join(
      '\n'
    );
    const edit = makeEvent({
      id: '$final-edit',
      sender: AGENT,
      ts: target.getTs() + 2_000,
      content: {
        msgtype: 'm.text',
        body: `* ${replacedLines}`,
        'm.new_content': {
          msgtype: 'm.text',
          body: replacedLines,
          'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
          'io.mindroom.stream_status': 'completed',
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$thinking' },
        'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
      },
    });
    const edits = [edit];
    const timelineSet = makeTimelineSetWithReplace('$thinking', edits);
    const editedSpy = vi.spyOn(roomUtils, 'getEditedEvent');
    const latestSpy = vi.spyOn(roomUtils, 'getLatestMessageContent');
    try {
      const opts = { compact: false, wrapChars: 38, coarsePointer: true, timelineSet };
      const firstPx = estimateThreadRowHeight(target, undefined, opts);
      // Base (8) + 15 lines (330) + coarse header (60) = 398, NOT "Thinking..." (~90 px).
      expect(firstPx).toBe(8 + 15 * 22 + 60);
      expect(editedSpy).toHaveBeenCalledTimes(1);
      expect(latestSpy).toHaveBeenCalledTimes(1);

      // Repeated renders hit WeakMap on O(1) source identities without calling getEditedEvent.
      for (let i = 0; i < 4; i += 1) {
        expect(estimateThreadRowHeight(target, undefined, opts)).toBe(firstPx);
      }
      expect(editedSpy).toHaveBeenCalledTimes(1);
      expect(latestSpy).toHaveBeenCalledTimes(1);

      // In-place mutation of the cached resolved edit's m.new_content invalidates the cache.
      (edit.getContent()['m.new_content'] as Record<string, unknown>)['io.mindroom.reasoning'] = {
        text: 'Reasoning added in place.',
      };
      expect(estimateThreadRowHeight(target, undefined, opts)).toBe(firstPx + 28);
      expect(editedSpy).toHaveBeenCalledTimes(2);

      // Appending a newer replacement to timelineSet.relations invalidates the cache.
      edits.push(
        makeEvent({
          id: '$newer-edit',
          sender: AGENT,
          ts: target.getTs() + 4_000,
          content: {
            msgtype: 'm.text',
            body: '* Short final',
            'm.new_content': {
              msgtype: 'm.text',
              body: 'Short final',
              'io.mindroom.ai_run': AI_RUN_WITH_MODEL,
              'io.mindroom.stream_status': 'completed',
            },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$thinking' },
          },
        })
      );
      // Base (8) + borrowed reasoning from older edit (28) + 1 line (22) + coarse header (60) = 118.
      expect(estimateThreadRowHeight(target, undefined, opts)).toBe(8 + 28 + 22 + 60);
      expect(editedSpy).toHaveBeenCalledTimes(3);
    } finally {
      editedSpy.mockRestore();
      latestSpy.mockRestore();
    }
  });

  it('prices a redacted row again', () => {
    const reply = makeEvent({ content: { msgtype: 'm.text', body: 'one\ntwo\nthree' } });
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(8 + 3 * 22);
    reply.makeRedacted(
      new MatrixEvent({
        type: 'm.room.redaction',
        redacts: '$event',
        event_id: '$redaction',
        sender: '@alice:example.org',
        content: {},
      }),
      new Room('!room:example.org', {} as MatrixClient, '@alice:example.org')
    );
    expect(estimateMessageRowHeight(reply, { compact: false })).toBe(
      estimateThreadEventRowHeight(reply, { compact: false })
    );
    expect(estimateMessageRowHeight(reply, { compact: false })).not.toBe(8 + 3 * 22);
  });
});

describe('estimateThreadRowHeight and estimateRoomRowHeight', () => {
  const first = makeEvent({ id: '$first' });

  it('applies author headers, coarse SenderLine, ModelBadge min height, compact layout, and day dividers', () => {
    // Human group start: 68 fine, 90 coarse.
    expect(
      estimateThreadRowHeight(first, undefined, { compact: false, coarsePointer: false })
    ).toBe(68);
    expect(estimateThreadRowHeight(first, undefined, { compact: false, coarsePointer: true })).toBe(
      90
    );
    // Compact puts sender beside body (no header added above).
    expect(estimateThreadRowHeight(first, undefined, { compact: true, coarsePointer: true })).toBe(
      6 + 22
    );

    // Agent reply with ModelBadge: 94 fine, 114 coarse avatar column floor.
    const agentShort = makeEvent({
      id: '$agent-short',
      sender: AGENT,
      ts: first.getTs() + 1_000,
      content: { msgtype: 'm.text', body: 'Done.', 'io.mindroom.ai_run': AI_RUN_WITH_MODEL },
    });
    expect(
      estimateThreadRowHeight(agentShort, first, { compact: false, coarsePointer: false })
    ).toBe(94);
    expect(
      estimateThreadRowHeight(agentShort, first, { compact: false, coarsePointer: true })
    ).toBe(114);

    // Day divider adds +34 px in threads as well as rooms.
    const nextDay = makeEvent({
      id: '$next-day',
      ts: first.getTs() + 24 * 60 * MINUTE,
    });
    expect(estimateThreadRowHeight(nextDay, first, { compact: false, coarsePointer: true })).toBe(
      90 + 34
    );
    expect(estimateThreadRowHeight(nextDay, first, { compact: true, coarsePointer: true })).toBe(
      6 + 22 + 34
    );
  });

  it('gives the first message of a room group its author line and margin', () => {
    expect(estimateRoomRowHeight(first, undefined)).toBe(68);
    const threeLines = makeEvent({ id: '$three', content: { msgtype: 'm.text', body: 'a\nb\nc' } });
    // Base (8) + 3 lines (66) + header+margin (38) = 112.
    expect(estimateRoomRowHeight(threeLines, undefined)).toBe(8 + 3 * 22 + 38);
  });

  it('prices a message that continues the group without a header', () => {
    const next = makeEvent({ id: '$next', ts: first.getTs() + 1_000 });
    expect(estimateRoomRowHeight(next, first)).toBe(30);
    const later = makeEvent({ id: '$later', ts: first.getTs() + 5 * MINUTE });
    expect(estimateRoomRowHeight(later, first)).toBe(68);
    const other = makeEvent({ id: '$other', sender: '@bob:example.org', ts: first.getTs() + 1 });
    expect(estimateRoomRowHeight(other, first)).toBe(68);
  });

  it('keeps the author line of an agent reply that follows one from the same agent', () => {
    const run = { version: 1, status: 'completed' };
    const reply = makeEvent({
      id: '$reply',
      ts: first.getTs() + 1_000,
      content: { msgtype: 'm.text', body: 'hello', 'io.mindroom.ai_run': run },
    });
    expect(estimateRoomRowHeight(reply, first)).toBe(68);
    const streaming = makeEvent({
      id: '$streaming',
      sender: '@mindroom_code:example.org',
      ts: first.getTs() + 1_000,
      content: { msgtype: 'm.text', body: 'hello', 'io.mindroom.stream_status': 'streaming' },
    });
    const agentFirst = makeEvent({ id: '$agent', sender: '@mindroom_code:example.org' });
    expect(estimateRoomRowHeight(streaming, agentFirst)).toBe(68);
  });

  it('adds the thread badge the threaded view shows under a message', () => {
    expect(estimateRoomRowHeight(first, undefined, { threadBadge: true })).toBe(68 + 31);
  });

  it('adds the date separator above the first message of a new day', () => {
    const tomorrow = makeEvent({ id: '$tomorrow', ts: first.getTs() + 24 * 60 * MINUTE });
    expect(estimateRoomRowHeight(tomorrow, first)).toBe(68 + 34);
  });

  it('wraps narrow (390 px) columns at 38 chars and desktop (960 px) at 110 chars', () => {
    expect(columnWrapCharsForWidth(undefined)).toBe(48);
    expect(columnWrapCharsForWidth(390)).toBe(38);
    expect(columnWrapCharsForWidth(960)).toBe(110);
    expect(columnWrapCharsForWidth(200)).toBe(24);

    const fourMediumLines = makeEvent({
      id: '$step',
      sender: AGENT,
      content: {
        msgtype: 'm.text',
        body: 'Step 1/3 for Item A: inspecting Service X rollout diagnostics.\n'.repeat(4),
      },
    });
    const phoneCoarse = estimateRoomRowHeight(fourMediumLines, first, {
      wrapChars: columnWrapCharsForWidth(390),
      coarsePointer: true,
    });
    const desktopFine = estimateRoomRowHeight(fourMediumLines, first, {
      wrapChars: columnWrapCharsForWidth(960),
      coarsePointer: false,
    });
    expect(desktopFine).toBeLessThan(phoneCoarse);
    // 4 lines of 62 chars: 2 lines each on 38-char phone (+4 lines = +88 px) + coarse header (+22 px) = +110 px.
    expect(phoneCoarse - desktopFine).toBe(4 * 22 + (60 - 38));
  });

  it('shows membership and name changes as one line and other state as nothing', () => {
    const join = makeEvent({
      type: 'm.room.member',
      stateKey: '@alice:example.org',
      content: { membership: 'join' },
    });
    const powerLevels = makeEvent({ type: 'm.room.power_levels', stateKey: '', content: {} });
    expect(estimateRoomRowHeight(join, undefined)).toBe(28);
    expect(estimateRoomRowHeight(powerLevels, undefined)).toBe(0);
    expect(estimateRoomRowHeight(makeEvent({ type: 'm.call.invite', content: {} }), first)).toBe(0);
  });
});
