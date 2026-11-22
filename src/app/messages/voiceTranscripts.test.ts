import { EventStatus, MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NO_VOICE_TRANSCRIPTS,
  planVoiceTranscripts,
  sameVoiceTranscriptPlan,
  voiceTranscriptText,
} from './voiceTranscripts';
import { getVoiceSourceEventId } from '../matrix/protocol/transcribingPlaceholder';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';

const AGENT = '@mindroom_helper:example.org';
const ROUTER = '@mindroom_router:example.org';
const PERSON = '@sam:example.org';
const ECHO_KEY = 'com.mindroom.visible_router_voice_echo';
const SOURCE_KEY = 'com.mindroom.voice_source_event_id';

const VOICE_CONTENT = {
  msgtype: 'm.audio',
  body: 'voice.ogg',
  url: 'mxc://example.org/voice',
  'org.matrix.msc3245.voice': {},
};

const voice = (
  id = '$voice',
  sender = PERSON,
  content: Record<string, unknown> = VOICE_CONTENT,
  ts = Date.now(),
  age?: number
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    content,
    origin_server_ts: ts,
    ...(age === undefined ? {} : { unsigned: { age } }),
  });

const echo = (
  id: string,
  extra: Record<string, unknown> = { [SOURCE_KEY]: '$voice' },
  { sender = ROUTER, body = '🎤 Invented words' } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    origin_server_ts: Date.now() + 1,
    content: { msgtype: 'm.text', body, [ECHO_KEY]: true, ...extra },
  });

const replaceWith = (
  event: MatrixEvent,
  newContent: Record<string, unknown>,
  sender = event.getSender()
) => {
  const edit = new MatrixEvent({
    event_id: `${event.getId() ?? ''}-edit`,
    type: 'm.room.message',
    sender,
    content: {
      ...newContent,
      'm.new_content': newContent,
      'm.relates_to': { rel_type: 'm.replace', event_id: event.getId() },
    },
  });
  event.makeReplaced(edit);
  return event;
};

const plan = (
  events: MatrixEvent[],
  {
    ignored = new Set<string>(),
    revealed = new Set<string>(),
    trustedAccountIds = new Set([ROUTER]),
    expectsAnswer = (): boolean => false,
    hasThreadReplies = (_event: MatrixEvent): boolean => false,
  } = {}
) =>
  planVoiceTranscripts({
    events,
    // As the timeline reads a row: the latest replacement by the event's own sender.
    getContent: (event) =>
      getLatestMessageContent(event, getEditedEvent(event.getId() ?? '', event, undefined)),
    trustedAccountIds,
    ignored,
    revealed,
    viewerId: PERSON,
    expectsAnswer,
    hasThreadReplies,
  });

describe('getVoiceSourceEventId', () => {
  it('reads the voice message an echo names', () => {
    expect(getVoiceSourceEventId(echo('$echo').getContent())).toBe('$voice');
  });

  it.each([
    ['no name, from an older backend', { [ECHO_KEY]: true }],
    ['an empty name', { [ECHO_KEY]: true, [SOURCE_KEY]: '' }],
    ['a name that is not a string', { [ECHO_KEY]: true, [SOURCE_KEY]: 7 }],
    ['a name on a message that is no echo', { [SOURCE_KEY]: '$voice' }],
  ])('gives nothing for %s', (_case, content) => {
    expect(getVoiceSourceEventId(content)).toBeUndefined();
  });
});

describe('planVoiceTranscripts', () => {
  it('pairs an echo with the voice message it names and hides its row', () => {
    const source = voice();
    const echoEvent = echo('$echo');
    const result = plan([source, echoEvent]);
    expect(result.byVoiceId.get('$voice')).toBe(echoEvent);
    expect([...result.hiddenEventIds]).toEqual(['$echo']);
  });

  it('reads the name from the latest replacement', () => {
    const echoEvent = replaceWith(echo('$echo', {}), {
      msgtype: 'm.text',
      body: '🎤 Invented words',
      [ECHO_KEY]: true,
      [SOURCE_KEY]: '$voice',
    });
    expect(plan([voice(), echoEvent]).byVoiceId.get('$voice')).toBe(echoEvent);
  });

  it('keeps the row of an echo without a name, as older backends send', () => {
    expect(plan([voice(), echo('$echo', {})])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it.each([
    ['a text message', { msgtype: 'm.text', body: 'Invented words' }],
    ['an audio file', { msgtype: 'm.audio', body: 'song.ogg', url: 'mxc://example.org/song' }],
    ['a file marked as voice', { ...VOICE_CONTENT, msgtype: 'm.file' }],
  ])('keeps the row of an echo that names %s', (_case, content) => {
    expect(plan([voice('$voice', PERSON, content), echo('$echo')])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('keeps the row of an echo whose voice message is not loaded', () => {
    expect(plan([echo('$echo')])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it.each([
    ['is redacted', () => [Object.assign(voice(), { isRedacted: () => true }), echo('$echo')]],
    ['comes from an ignored sender', () => [voice('$voice', '@ignored:example.org'), echo('$e')]],
  ])('keeps the row of an echo whose voice message %s', (_case, events) => {
    expect(plan(events(), { ignored: new Set(['@ignored:example.org']) })).toBe(
      NO_VOICE_TRANSCRIPTS
    );
  });

  it.each([
    ['another agent', '@mindroom_helper:example.org'],
    ["another installation's router", '@mindroom_router_lab1:example.org'],
    ['a router of another homeserver', '@mindroom_router:elsewhere.org'],
  ])('keeps the row of an echo %s sent, the room naming another router', (_case, sender) => {
    expect(plan([voice(), echo('$echo', undefined, { sender })])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('pairs a trusted answering agent echo', () => {
    const echoEvent = echo('$echo', undefined, { sender: AGENT });
    const result = plan([voice(), echoEvent], { trustedAccountIds: new Set([ROUTER, AGENT]) });
    expect(result.byVoiceId.get('$voice')).toBe(echoEvent);
    expect([...result.hiddenEventIds]).toEqual(['$echo']);
  });

  it('pairs an echo from whichever account the room binds', () => {
    const sender = '@mindroom_router_lab1:example.org';
    const echoEvent = echo('$echo', undefined, { sender });
    expect(
      plan([voice(), echoEvent], { trustedAccountIds: new Set([sender]) }).byVoiceId.get('$voice')
    ).toBe(echoEvent);
  });

  it('keeps every row while the room names no trusted router', () => {
    const result = planVoiceTranscripts({
      events: [voice(), echo('$echo')],
      getContent: (event) => event.getContent(),
      trustedAccountIds: new Set(),
      ignored: new Set(),
      revealed: new Set(),
      viewerId: PERSON,
      expectsAnswer: () => false,
      hasThreadReplies: () => false,
    });
    expect(result).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it("reads no name from another sender's edit of the router's echo", () => {
    const echoEvent = replaceWith(
      echo('$echo', {}),
      { msgtype: 'm.text', body: '🎤 Not the router', [ECHO_KEY]: true, [SOURCE_KEY]: '$voice' },
      PERSON
    );
    expect(plan([voice(), echoEvent])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('keeps the row of an echo a person sent, and of one the route opened', () => {
    expect(plan([voice(), echo('$echo', undefined, { sender: PERSON })])).toBe(
      NO_VOICE_TRANSCRIPTS
    );
    expect(plan([voice(), echo('$echo')], { revealed: new Set(['$echo']) })).toBe(
      NO_VOICE_TRANSCRIPTS
    );
  });

  it('keeps the row of an echo from a router the viewer ignores', () => {
    expect(plan([voice(), echo('$echo')], { ignored: new Set([ROUTER]) })).toBe(
      NO_VOICE_TRANSCRIPTS
    );
  });

  it('keeps the row of an echo whose text is in a long-text sidecar', () => {
    const echoEvent = replaceWith(echo('$echo'), {
      msgtype: 'm.text',
      body: '🎤 Invented words\n\n[Message continues in attached file]',
      [ECHO_KEY]: true,
      [SOURCE_KEY]: '$voice',
      'io.mindroom.long_text': { version: 2 },
    });
    expect(plan([voice(), echoEvent])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('keeps the row of an echo whose latest version is the raw audio fallback', () => {
    // A failed transcription falls back to the voice message's attachment text.
    const echoEvent = replaceWith(echo('$echo'), {
      msgtype: 'm.text',
      body: '🎤 [Attached voice message]',
      [ECHO_KEY]: true,
      [SOURCE_KEY]: '$voice',
      'com.mindroom.voice_raw_audio_fallback': true,
    });
    expect(plan([voice(), echoEvent])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('folds a trusted legacy placeholder under the voice message it names', () => {
    const placeholder = echo('$echo', undefined, { body: 'Router agent is transcribing…' });
    const result = plan([voice(), placeholder]);
    expect(result.byVoiceId.get('$voice')).toBe(placeholder);
    expect(result.hiddenEventIds.has('$echo')).toBe(true);
  });

  it('pairs only the first echo naming a voice message', () => {
    const first = echo('$first');
    const result = plan([voice(), first, echo('$second')]);
    expect(result.byVoiceId.get('$voice')).toBe(first);
    expect([...result.hiddenEventIds]).toEqual(['$first']);
  });

  it('draws the same for the same pairs', () => {
    const events = [voice(), echo('$echo')];
    expect(sameVoiceTranscriptPlan(plan(events), plan(events))).toBe(true);
    expect(sameVoiceTranscriptPlan(plan(events), NO_VOICE_TRANSCRIPTS)).toBe(false);
  });
});

describe('pending voice transcription', () => {
  const now = 120_000;
  const pending = (events: MatrixEvent[]) => plan(events, { expectsAnswer: () => true });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("shows for the viewer's own fresh sent voice message without a transcript", () => {
    const sent = voice();
    sent.setStatus(EventStatus.SENT);
    const result = plan([sent], { expectsAnswer: () => true, trustedAccountIds: new Set() });
    expect([...result.pendingVoiceIds]).toEqual(['$voice']);
    expect(sameVoiceTranscriptPlan(result, NO_VOICE_TRANSCRIPTS)).toBe(false);
  });

  it('uses the age supplied by the server even if its clock is ahead', () => {
    const skewed = voice('$voice', PERSON, VOICE_CONTENT, now + 3_600_000, 40_000);
    expect([...pending([skewed]).pendingVoiceIds]).toEqual(['$voice']);
  });

  it('ends when a transcript folds, even if the events loaded out of order', () => {
    const source = voice();
    const transcript = echo('$echo');
    expect(pending([source]).pendingVoiceIds.has('$voice')).toBe(true);
    const result = pending([transcript, source]);
    expect(result.byVoiceId.get('$voice')).toBe(transcript);
    expect(result.pendingVoiceIds.size).toBe(0);
  });

  it('folds a transcript that arrives after the indicator expires', () => {
    const transcript = echo('$echo');
    const old = voice('$voice', PERSON, VOICE_CONTENT, now - 60_000);
    expect(pending([old, transcript]).byVoiceId.get('$voice')).toBe(transcript);
  });

  it.each(['m.room.message', 'm.room.encrypted'])('ends on a later drawn %s event', (type) => {
    const reply = new MatrixEvent({
      event_id: '$agent',
      type,
      sender: AGENT,
      origin_server_ts: now + 1,
    });
    expect(pending([voice(), reply])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('ends when a later agent event is drawn, regardless of the order of the rows', () => {
    const earlier = voice('$earlier', PERSON, VOICE_CONTENT, now - 10);
    const later = voice('$later', PERSON, VOICE_CONTENT, now + 10, 0);
    const reply = new MatrixEvent({
      event_id: '$agent',
      type: 'm.room.message',
      sender: AGENT,
      origin_server_ts: now,
    });
    expect([...pending([earlier, reply, later]).pendingVoiceIds]).toEqual(['$later']);
    expect([...pending([later, reply, earlier]).pendingVoiceIds]).toEqual(['$later']);
  });

  it('ends on an unfolded agent echo', () => {
    const untrusted = echo('$echo', undefined, { sender: AGENT });
    expect(pending([voice(), untrusted])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('ends on the raw-audio fallback without folding it', () => {
    const fallback = echo(
      '$echo',
      { [SOURCE_KEY]: '$voice', 'com.mindroom.voice_raw_audio_fallback': true },
      { sender: AGENT }
    );
    expect(pending([voice(), fallback])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('does not scan agent rows when no fresh voice candidate exists', () => {
    const stale = voice('$voice', PERSON, VOICE_CONTENT, now - 60_000);
    const reply = echo('$reply', {}, { sender: AGENT });
    const getTs = vi.spyOn(reply, 'getTs');
    expect(pending([stale, reply])).toBe(NO_VOICE_TRANSCRIPTS);
    expect(getTs).not.toHaveBeenCalled();
  });

  it('does not show without a joined agent', () => {
    expect(plan([voice()])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it('does not show if the voice message has thread replies', () => {
    expect(
      plan([voice()], {
        expectsAnswer: () => true,
        hasThreadReplies: (event) => event.getId() === '$voice',
      })
    ).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it.each([
    ["another person's voice", () => voice('$voice', '@alex:example.org')],
    ['a local echo', () => voice('~room:txn')],
    ['an old voice message', () => voice('$voice', PERSON, VOICE_CONTENT, now - 60_000)],
    ['an invalid timestamp', () => voice('$voice', PERSON, VOICE_CONTENT, NaN)],
    ['an audio file', () => voice('$voice', PERSON, { msgtype: 'm.audio', body: 'audio.ogg' })],
    ['a redacted voice message', () => Object.assign(voice(), { isRedacted: () => true })],
  ])('does not show for %s', (_case, source) => {
    expect(pending([source()])).toBe(NO_VOICE_TRANSCRIPTS);
  });

  it.each([EventStatus.SENDING, EventStatus.NOT_SENT])('does not show for a %s event', (status) => {
    const unsent = voice();
    unsent.setStatus(status);
    expect(pending([unsent])).toBe(NO_VOICE_TRANSCRIPTS);
  });
});

describe('voiceTranscriptText', () => {
  it('drops the microphone before the transcript', () => {
    expect(voiceTranscriptText({ body: '🎤 Invented words' })).toBe('Invented words');
    expect(voiceTranscriptText({ body: 'No microphone' })).toBe('No microphone');
    expect(voiceTranscriptText({})).toBe('');
  });
});
