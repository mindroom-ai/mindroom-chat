import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  NO_VOICE_TRANSCRIPTS,
  planVoiceTranscripts,
  sameVoiceTranscriptPlan,
  voiceTranscriptText,
} from './voiceTranscripts';
import { getVoiceSourceEventId } from '../matrix/protocol/transcribingPlaceholder';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';

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

const voice = (id = '$voice', sender = PERSON, content: Record<string, unknown> = VOICE_CONTENT) =>
  new MatrixEvent({ event_id: id, type: 'm.room.message', sender, content });

const echo = (
  id: string,
  extra: Record<string, unknown> = { [SOURCE_KEY]: '$voice' },
  { sender = ROUTER, body = 'Router agent is transcribing…' } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
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
    routerUserId = ROUTER as string | undefined,
  } = {}
) =>
  planVoiceTranscripts({
    events,
    // As the timeline reads a row: the latest replacement by the event's own sender.
    getContent: (event) =>
      getLatestMessageContent(event, getEditedEvent(event.getId() ?? '', event, undefined)),
    routerUserId,
    ignored,
    revealed,
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

  it('pairs an echo from whichever account the room names as its router', () => {
    const sender = '@mindroom_router_lab1:example.org';
    const echoEvent = echo('$echo', undefined, { sender });
    expect(plan([voice(), echoEvent], { routerUserId: sender }).byVoiceId.get('$voice')).toBe(
      echoEvent
    );
  });

  it('keeps every row while the room names no trusted router', () => {
    const result = planVoiceTranscripts({
      events: [voice(), echo('$echo')],
      getContent: (event) => event.getContent(),
      routerUserId: undefined,
      ignored: new Set(),
      revealed: new Set(),
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

describe('voiceTranscriptText', () => {
  it('drops the microphone before the transcript', () => {
    expect(voiceTranscriptText({ body: '🎤 Invented words' })).toBe('Invented words');
    expect(voiceTranscriptText({ body: 'No microphone' })).toBe('No microphone');
    expect(voiceTranscriptText({})).toBe('');
  });
});
