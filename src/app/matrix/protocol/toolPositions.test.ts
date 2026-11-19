import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import positions from './__fixtures__/tool-positions-v1.json';
import { htmlBlockStarts, withToolMarkersRestored } from './toolPositions';
import { installEventContentGuard, sanitizeContent, trustAgentsOfViewer } from './untrustedContent';
import { getRenderedToolRefs } from '../../messages/agent-run/toolRefDom';

const TRACE = 'io.mindroom.tool_trace';

type Wire = { body: string; formatted_body: string; at: unknown[] };

const wireContent = (
  wire: Wire,
  events: readonly Record<string, unknown>[],
  at: readonly unknown[] = wire.at
) => ({
  msgtype: 'm.text',
  body: wire.body,
  format: 'org.matrix.custom.html',
  formatted_body: wire.formatted_body,
  [TRACE]: {
    version: 3,
    events: events.map((event, index) =>
      index < at.length ? { ...event, at: at[index] } : { ...event }
    ),
  },
});

const [between, , , , nested] = positions.cases;

describe('tool positions', () => {
  it.each(positions.cases.map((testCase) => [testCase.name, testCase] as const))(
    'puts the markers back: %s',
    (_name, { sent, wire, restored }) => {
      const content = withToolMarkersRestored(wireContent(wire, sent.events));
      expect(content.body).toBe(restored.body);
      expect(content.formatted_body).toBe(restored.formatted_body);
      expect((content[TRACE] as { version: unknown }).version).toBe(2);
    }
  );

  // A call in a list item renders as text in the sent reply; after the list, as a row.
  const rows = (html: string) => getRenderedToolRefs(html).toolBlocks;
  it.each(positions.cases.map((testCase) => [testCase.name, testCase] as const))(
    'renders the tool rows the sent reply renders: %s',
    (_name, { sent, wire }) => {
      const restored = withToolMarkersRestored(wireContent(wire, sent.events));
      expect(rows(restored.formatted_body as string)).toEqual(
        sent === nested.sent
          ? [{ toolName: 'shell', index: 1, pending: false }]
          : rows(sent.formatted_body)
      );
    }
  );

  it('counts top-level elements, void elements and text runs as blocks', () => {
    const html = ' <p>a<b>b</b></p>\n<hr>text <em>x</em><br/>\n<ul><li><p>c</p></li></ul>';
    expect(htmlBlockStarts(html).map((start) => html.slice(start, start + 4))).toEqual([
      '<p>a',
      '<hr>',
      'text',
      '<em>',
      '<br/',
      '<ul>',
    ]);
  });

  const ONE = '🔧 `shell` [1]';
  const TWO = '🔧 `shell` [2] ⏳';
  it.each([
    ['without a position', [], `Let me check.\n\nFound it.\n\n${ONE}\n\n${TWO}`],
    [
      'at a position that is no integer',
      [1.5, 1],
      `Let me check.\n\n${TWO}\n\nFound it.\n\n${ONE}`,
    ],
    ['at a negative position', [-1, 1], `Let me check.\n\n${TWO}\n\nFound it.\n\n${ONE}`],
    ['at a position that is a string', ['1', 1], `Let me check.\n\n${TWO}\n\nFound it.\n\n${ONE}`],
    ['past the last block', [1, 7], `Let me check.\n\n${ONE}\n\nFound it.\n\n${TWO}`],
    ['before an earlier call', [1, 0], `Let me check.\n\n${ONE}\n\nFound it.\n\n${TWO}`],
  ])('puts a call %s at the end of the reply', (_name, at, body) => {
    const restored = withToolMarkersRestored(wireContent(between.wire, between.sent.events, at));
    expect(restored.body).toBe(body);
    const html = restored.formatted_body as string;
    const markers = [...html.matchAll(/<p>🔧 <code>shell<\/code> \[(\d)\]/g)].map(([, n]) => n);
    expect(markers).toEqual(body.indexOf(ONE) < body.indexOf(TWO) ? ['1', '2'] : ['2', '1']);
    expect(html.endsWith('</p>\n')).toBe(true);
    expect(html.indexOf('Found it.') < html.lastIndexOf('🔧')).toBe(true);
  });

  it('leaves content without a version-3 trace as it is', () => {
    const v2 = { body: between.sent.body, [TRACE]: { version: 2, events: between.sent.events } };
    expect(withToolMarkersRestored(v2)).toBe(v2);
    const restored = withToolMarkersRestored(wireContent(between.wire, between.sent.events));
    expect(withToolMarkersRestored(restored)).toBe(restored);
  });

  it('puts the markers of a body without HTML back by its blocks', () => {
    const { formatted_body: _html, ...plain } = wireContent(between.wire, between.sent.events);
    expect(withToolMarkersRestored(plain).body).toBe(between.sent.body);
  });
});

describe('tool positions on read', () => {
  const VIEWER = '@reader:example.org';
  const AGENT = '@mindroom_helper:example.org';
  const event = (sender: string, content: Record<string, unknown>) =>
    new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      event_id: '$event',
      sender,
      origin_server_ts: 1,
      content,
    } as Partial<IEvent>);

  beforeAll(() => {
    installEventContentGuard();
    trustAgentsOfViewer(VIEWER);
  });

  it("reads an agent's reply and its edit with their markers", () => {
    const wire = wireContent(nested.wire, nested.sent.events);
    expect(event(AGENT, wire).getContent().formatted_body).toBe(nested.restored.formatted_body);
    const edit = event(AGENT, {
      ...wire,
      'm.new_content': wire,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    }).getContent();
    expect(edit.body).toBe(nested.restored.body);
    expect((edit['m.new_content'] as Record<string, unknown>).body).toBe(nested.restored.body);
  });

  it('puts back no markers for a sender that is no agent', () => {
    const content = sanitizeContent(wireContent(between.wire, between.sent.events), false);
    expect(content.body).toBe(between.wire.body);
    expect(content[TRACE]).toBeUndefined();
  });
});
