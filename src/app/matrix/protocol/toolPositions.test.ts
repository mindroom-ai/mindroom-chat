import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import positions from './__fixtures__/tool-positions-v1.json';
import { htmlBlockStarts, withToolMarkersRestored } from './toolPositions';
import { installEventContentGuard, sanitizeContent, trustAgentsOfViewer } from './untrustedContent';

const TRACE = 'io.mindroom.tool_trace';

type Case = (typeof positions.cases)[number];
type Wire = { body: string; formatted_body: string; body_line: unknown[]; at: unknown[] };

type Trace = { version: number; events: Record<string, unknown>[] };

/** A case's wire content, with `place` in place of each call's positions when given. */
const wireContent = ({ sent, wire }: { sent: Case['sent']; wire: Wire }, place?: unknown[]) => {
  const events = sent.events.map((event, index): Record<string, unknown> => {
    const line = place ? place[index] : wire.body_line[index];
    const at = place ? place[index] : wire.at[index];
    return {
      ...event,
      ...(line === null ? {} : { body_line: line }),
      ...(at === null ? {} : { at }),
    };
  });
  const trace: Trace = { version: 3, events };
  return {
    msgtype: 'm.text',
    body: wire.body,
    format: 'org.matrix.custom.html',
    formatted_body: wire.formatted_body,
    [TRACE]: trace,
  };
};

const caseNamed = (name: string) => {
  const found = positions.cases.find((testCase) => testCase.name === name);
  if (!found?.wire) throw new Error(`No fixture case ${name}`);
  return { sent: found.sent, wire: found.wire as Wire };
};
const between = caseNamed('calls between two paragraphs share one position');
const heading = caseNamed('a heading with no blank line after it');
const sentCases = positions.cases.filter((testCase) => testCase.wire !== null);
const keptCases = positions.cases.filter((testCase) => testCase.wire === null);

describe('tool positions', () => {
  it.each(sentCases.map((testCase) => [testCase.name, testCase] as const))(
    'gives the version-2 reply back byte for byte: %s',
    (_name, { sent, wire }) => {
      const content = withToolMarkersRestored(wireContent({ sent, wire: wire as Wire }));
      expect(content.body).toBe(sent.body);
      expect(content.formatted_body).toBe(sent.formatted_body);
      expect((content[TRACE] as { version: unknown }).version).toBe(2);
    }
  );

  it.each(keptCases.map((testCase) => [testCase.name, testCase] as const))(
    'reads a reply the backend sent with its markers as it is: %s',
    (_name, { sent }) => {
      const content = { body: sent.body, formatted_body: sent.formatted_body };
      const v2 = { ...content, [TRACE]: { version: 2, events: sent.events } };
      expect(withToolMarkersRestored(v2)).toBe(v2);
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
    ['at a position that is null', [null, 2]],
    ['at a position that is no integer', [1.5, 2]],
    ['at a negative position', [-1, 2]],
    ['at a position that is a string', ['1', 2]],
    ['at a position that is a boolean', [true, 2]],
    ['past the end', [9, 2]],
  ])('puts a call %s at the end of the reply', (_name, place) => {
    const content = wireContent(between);
    const events = content[TRACE].events;
    content[TRACE].events = events.map((event, index) => ({
      ...event,
      body_line: place[index],
      at: index === 0 ? place[0] : 1,
    }));
    const restored = withToolMarkersRestored(content);
    expect(restored.body).toBe(`Let me check.\n\n${TWO}\n\nFound it.\n\n${ONE}`);
    expect(restored.formatted_body).toBe(
      '<p>Let me check.</p>\n<p>🔧 <code>shell</code> [2] ⏳</p>\n<p>Found it.</p>\n<p>🔧 <code>shell</code> [1]</p>\n'
    );
  });

  it('puts a call before an earlier one at the end of the reply', () => {
    const restored = withToolMarkersRestored(wireContent(between, [2, 0]));
    expect(restored.body).toBe(`Let me check.\n\n${ONE}\n\nFound it.\n\n${TWO}`);
  });

  it('draws no line for a call without a position, whose marker the text never showed', () => {
    const content = wireContent(between);
    content[TRACE].events = content[TRACE].events.map((event, index) => {
      const { body_line: _line, at: _at, ...unplaced } = event;
      return index === 1 ? unplaced : event;
    });
    const restored = withToolMarkersRestored(content);
    expect(restored.body).toBe(`Let me check.\n\n${ONE}\n\nFound it.`);
    expect(restored.formatted_body).not.toContain('[2]');
  });

  it.each([
    ['version 2', { version: 2, events: [{ tool_name: 'shell', at: 0, body_line: 0 }] }],
    ['version 4', { version: 4, events: [{ tool_name: 'shell', at: 0, body_line: 0 }] }],
    ['a version that is a string', { version: '3', events: [{ tool_name: 'shell', at: 0 }] }],
    ['events that are no list', { version: 3, events: { at: 0 } }],
    ['events that are a number', { version: 3, events: 5 }],
  ])('leaves a trace of %s as it is', (_name, trace) => {
    const content = { body: 'Found it.', formatted_body: '<p>Found it.</p>\n', [TRACE]: trace };
    expect(withToolMarkersRestored(content)).toBe(content);
  });

  it('writes nothing for entries that are no named call', () => {
    const events = [1, null, 'x', { tool_name: 3, at: 0, body_line: 0 }, { tool_name: '', at: 0 }];
    const content = {
      body: 'Found it.',
      formatted_body: '<p>Found it.</p>\n',
      [TRACE]: { version: 3, events },
    };
    const restored = withToolMarkersRestored(content);
    expect([restored.body, restored.formatted_body]).toEqual(['Found it.', '<p>Found it.</p>\n']);
  });

  it('puts the markers of a body without HTML back by its lines', () => {
    const { formatted_body: _html, ...plain } = wireContent(heading);
    expect(withToolMarkersRestored(plain).body).toBe(heading.sent.body);
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
    const wire = wireContent(heading);
    expect(event(AGENT, wire).getContent().body).toBe(heading.sent.body);
    expect(event(AGENT, wire).getContent().formatted_body).toBe(heading.sent.formatted_body);
    const edit = event(AGENT, {
      ...wire,
      body: `* ${wire.body}`,
      'm.new_content': wire,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    }).getContent();
    expect((edit['m.new_content'] as Record<string, unknown>).body).toBe(heading.sent.body);
  });

  /** The edit the backend sends for `layer`: the fallback repeats it after "* ". */
  const editOf = (layer: Record<string, unknown>, fallbackTrace = true) => {
    const { [TRACE]: trace, ...rest } = layer;
    return {
      ...rest,
      ...(fallbackTrace ? { [TRACE]: trace } : {}),
      body: `* ${String(layer.body)}`,
      'm.new_content': layer,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    };
  };
  /** The text of an edit's fallback and of its replacement, and the version of each trace. */
  const textOf = (edit: Record<string, unknown>) => {
    const replacement = edit['m.new_content'] as Record<string, unknown>;
    return [edit, replacement].map((layer) => [
      layer.body,
      layer.formatted_body,
      (layer[TRACE] as Trace | undefined)?.version,
    ]);
  };

  it.each(sentCases.map((testCase) => [testCase.name, testCase] as const))(
    "reads an agent's edit with the fallback of its restored replacement: %s",
    (_name, { sent, wire }) => {
      for (const fallbackTrace of [true, false]) {
        const edit = editOf(wireContent({ sent, wire: wire as Wire }), fallbackTrace);
        expect(textOf(event(AGENT, edit).getContent())).toEqual([
          [`* ${sent.body}`, sent.formatted_body, fallbackTrace ? 2 : undefined],
          [sent.body, sent.formatted_body, 2],
        ]);
      }
    }
  );

  it('builds the fallback of an edit that opens with a call after "* "', () => {
    const opening = caseNamed('calls that open and end the reply');
    const read = event(AGENT, editOf(wireContent(opening))).getContent();
    expect(read.body).toBe('* 🔧 `read_file` [1]\n\nReading done.\n\n🔧 `shell` [2]');
  });

  it('puts the calls back in a fallback that names an agent as its author typed it', () => {
    const wire = wireContent(between);
    const edit = editOf({ ...wire, body: wire.body.replace('Found it.', 'Over to @helper:x.') });
    const read = event(AGENT, { ...edit, body: `* ${wire.body.replace('Found it.', '@helper')}` });
    expect(read.getContent().body).toBe(`* ${between.sent.body.replace('Found it.', '@helper')}`);
    expect(read.getContent().formatted_body).toBe(between.sent.formatted_body);
  });

  it.each([
    ['has other HTML', { formatted_body: '<p>Something else.</p>\n' }],
    // The backend sends such an edit with its markers; this is one somebody else wrote.
    ['has no HTML', { formatted_body: undefined }],
    ['does not open with "* "', { body: 'Something else.' }],
  ])('leaves a fallback that %s as it was sent', (_name, fallback) => {
    const edit: Record<string, unknown> = { ...editOf(wireContent(between), false), ...fallback };
    const read = event(AGENT, edit).getContent();
    expect([read.body, read.formatted_body]).toEqual([edit.body, edit.formatted_body]);
    expect((read['m.new_content'] as Record<string, unknown>).body).toBe(between.sent.body);
  });

  it('puts back no markers for a sender that is no agent', () => {
    const content = sanitizeContent(wireContent(between), false);
    expect(content.body).toBe(between.wire.body);
    expect(content[TRACE]).toBeUndefined();
    expect(event('@someone:example.org', wireContent(between)).getContent().body).toBe(
      between.wire.body
    );
  });

  it('mends a broken relation without putting markers in the wire content, whoever sent it', () => {
    for (const sender of [AGENT, '@someone:example.org']) {
      const wire = event(sender, {
        ...wireContent(between),
        'm.relates_to': 'broken',
      }).getWireContent();
      expect(wire['m.relates_to']).toBeUndefined();
      expect(wire.body).toBe(between.wire.body);
      expect(wire.formatted_body).toBe(between.wire.formatted_body);
    }
  });
});
