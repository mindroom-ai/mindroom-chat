import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { estimateThreadEventRowHeight } from '../event-store/threads/threadRenderUtils';
import {
  estimateFormattedBodyPx,
  estimateMessageRowHeight,
  estimateRoomRowHeight,
} from './timelineRowEstimate';

const MINUTE = 60_000;

const makeEvent = ({
  id = '$event',
  sender = '@alice:example.org',
  ts = 1_700_000_000_000,
  type = 'm.room.message',
  content = { msgtype: 'm.text', body: 'hello' } as Record<string, unknown>,
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

const html = (formattedBody: string, body = 'rich') => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: formattedBody,
});

const codeReply = html(
  '<p>Reply <strong>1</strong></p><pre><code>function step() {\n  return 1;\n}</code></pre>' +
    '<ul><li>first point</li><li>second point</li></ul>'
);

describe('estimateFormattedBodyPx', () => {
  it('leaves plain text and inline HTML to the text estimate', () => {
    expect(estimateFormattedBodyPx({ msgtype: 'm.text', body: 'plain' })).toBeUndefined();
    expect(estimateFormattedBodyPx(html('<p>one <strong>bold</strong> word</p>'))).toBeUndefined();
  });

  it('prices code blocks by their lines and lists by their items', () => {
    // A paragraph and two items (three lines, two block gaps) and a three-line code block.
    expect(estimateFormattedBodyPx(codeReply)).toBe(Math.round(3 * 20 + 2 * 0.4 * 20 + 50 + 60));
  });

  it('gives table rows their padding', () => {
    const table = html('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(estimateFormattedBodyPx(table)).toBe(Math.round(2 * 1.6 * 20));
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

  it('folds a rich message from a person and shows an agent reply in full', () => {
    const longCode = html(
      `<pre><code>${Array.from({ length: 30 }, (_v, n) => `line ${n}`).join('\n')}</code></pre>`
    );
    const person = makeEvent({ content: longCode });
    const agent = makeEvent({ content: longCode, sender: '@mindroom_helper:example.org' });
    expect(estimateMessageRowHeight(person, { compact: false })).toBe(10 + 9 * 20);
    expect(estimateMessageRowHeight(agent, { compact: false })).toBe(10 + 50 + 30 * 20);
  });

  it('sizes images by their stated size within the media box', () => {
    const image = makeEvent({
      content: { msgtype: 'm.image', body: 'cat.png', info: { w: 800, h: 400 } },
    });
    expect(estimateMessageRowHeight(image, { compact: false })).toBe(10 + 200);
  });
});

describe('estimateRoomRowHeight', () => {
  const first = makeEvent({ id: '$first' });

  it('gives the first message of a group its author line', () => {
    expect(estimateRoomRowHeight(first, undefined)).toBe(68);
    const twoLines = makeEvent({ id: '$two', content: { msgtype: 'm.text', body: 'a\nb\nc' } });
    expect(estimateRoomRowHeight(twoLines, undefined)).toBe(10 + 3 * 20 + 22);
  });

  it('prices a message that continues the group without one', () => {
    const next = makeEvent({ id: '$next', ts: first.getTs() + 1_000 });
    expect(estimateRoomRowHeight(next, first)).toBe(30);
    const later = makeEvent({ id: '$later', ts: first.getTs() + 5 * MINUTE });
    expect(estimateRoomRowHeight(later, first)).toBe(68);
    const other = makeEvent({ id: '$other', sender: '@bob:example.org', ts: first.getTs() + 1 });
    expect(estimateRoomRowHeight(other, first)).toBe(68);
  });

  it('adds the thread badge the threaded view shows under a message', () => {
    expect(estimateRoomRowHeight(first, undefined, { threadBadge: true })).toBe(68 + 31);
  });

  it('adds the date separator above the first message of a new day', () => {
    const tomorrow = makeEvent({ id: '$tomorrow', ts: first.getTs() + 24 * 60 * MINUTE });
    expect(estimateRoomRowHeight(tomorrow, first)).toBe(68 + 34);
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
