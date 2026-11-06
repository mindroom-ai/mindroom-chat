import { describe, expect, it } from 'vitest';
import {
  CALL_TRANSCRIPT_KEY,
  CALL_TRANSCRIPT_MAX_TOTAL_LENGTH,
  CALL_TRANSCRIPT_MAX_TURNS,
  callTranscriptSpeakersTrusted,
  clipTurnText,
  groupCallTranscriptTurns,
  readCallTranscript,
} from './callTranscript';

const PERSON = '@robin:example.org';
const AGENT = '@mindroom_helper:example.org';

const withTranscript = (value: unknown): Record<string, unknown> => ({
  msgtype: 'm.text',
  body: 'Voice call',
  [CALL_TRANSCRIPT_KEY]: value,
});

const turn = (sender: string, text: string) => ({ sender, text });

describe('readCallTranscript', () => {
  it('reads the duration and the turns in order', () => {
    const content = withTranscript({
      duration_seconds: 125,
      turns: [turn(PERSON, 'Can you hear me?'), turn(AGENT, 'Yes, loud and clear.')],
    });
    expect(readCallTranscript(content)).toEqual({
      durationSeconds: 125,
      turns: [
        { sender: PERSON, text: 'Can you hear me?' },
        { sender: AGENT, text: 'Yes, loud and clear.' },
      ],
    });
  });

  it('rounds a fractional duration and ignores extra fields', () => {
    const content = withTranscript({
      duration_seconds: 59.6,
      version: 2,
      turns: [{ sender: PERSON, text: 'Hello', lang: 'en' }],
    });
    expect(readCallTranscript(content)).toEqual({
      durationSeconds: 60,
      turns: [{ sender: PERSON, text: 'Hello' }],
    });
  });

  it('answers undefined without the key, so the message renders as before', () => {
    expect(readCallTranscript({ msgtype: 'm.text', body: 'hi' })).toBeUndefined();
  });

  it.each([
    ['a string', 'transcript'],
    ['an array', [turn(PERSON, 'Hello')]],
    ['null', null],
    ['no turns', { duration_seconds: 10 }],
    ['turns that are not an array', { duration_seconds: 10, turns: { 0: turn(PERSON, 'x') } }],
    ['no turn at all', { duration_seconds: 10, turns: [] }],
    ['no duration', { turns: [turn(PERSON, 'Hello')] }],
    ['a string duration', { duration_seconds: '60', turns: [turn(PERSON, 'Hello')] }],
    ['a negative duration', { duration_seconds: -1, turns: [turn(PERSON, 'Hello')] }],
    ['an infinite duration', { duration_seconds: Infinity, turns: [turn(PERSON, 'Hello')] }],
    ['a duration of NaN', { duration_seconds: Number.NaN, turns: [turn(PERSON, 'Hello')] }],
    ['a duration over a week', { duration_seconds: 8 * 24 * 3600, turns: [turn(PERSON, 'x')] }],
    ['a turn that is not an object', { duration_seconds: 10, turns: ['Hello'] }],
    ['a turn without a sender', { duration_seconds: 10, turns: [{ text: 'Hello' }] }],
    ['a sender that is no user ID', { duration_seconds: 10, turns: [turn('robin', 'Hello')] }],
    ['a sender that is a room ID', { duration_seconds: 10, turns: [turn('!r:example.org', 'x')] }],
    ['a turn without text', { duration_seconds: 10, turns: [{ sender: PERSON }] }],
    ['a text that is not a string', { duration_seconds: 10, turns: [{ sender: PERSON, text: 5 }] }],
    ['a blank text', { duration_seconds: 10, turns: [turn(PERSON, '   ')] }],
    [
      'one bad turn among good ones',
      { duration_seconds: 10, turns: [turn(PERSON, 'Hello'), null, turn(AGENT, 'Hi')] },
    ],
  ])('answers undefined for %s, so the HTML fallback renders', (_, value) => {
    expect(readCallTranscript(withTranscript(value))).toBeUndefined();
  });

  it('takes the most turns it renders and falls back beyond them', () => {
    const turns = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        turn(index % 2 ? AGENT : PERSON, `Line ${index}`)
      );
    expect(
      readCallTranscript(
        withTranscript({ duration_seconds: 10, turns: turns(CALL_TRANSCRIPT_MAX_TURNS) })
      )?.turns
    ).toHaveLength(CALL_TRANSCRIPT_MAX_TURNS);
    expect(
      readCallTranscript(
        withTranscript({ duration_seconds: 10, turns: turns(CALL_TRANSCRIPT_MAX_TURNS + 1) })
      )
    ).toBeUndefined();
  });

  it('keeps a long turn whole: one speaker can talk for many minutes', () => {
    const dictation = 'word '.repeat(4000).trim();
    expect(
      readCallTranscript(
        withTranscript({ duration_seconds: 900, turns: [turn(PERSON, dictation)] })
      )?.turns[0]?.text
    ).toBe(dictation);
  });

  it('falls back past the total size it renders', () => {
    const half = 'a'.repeat(CALL_TRANSCRIPT_MAX_TOTAL_LENGTH / 2);
    expect(
      readCallTranscript(
        withTranscript({ duration_seconds: 10, turns: [turn(PERSON, half), turn(AGENT, half)] })
      )
    ).toBeDefined();
    expect(
      readCallTranscript(
        withTranscript({
          duration_seconds: 10,
          turns: [turn(PERSON, half), turn(AGENT, `${half}a`)],
        })
      )
    ).toBeUndefined();
  });
});

describe('clipTurnText', () => {
  it('leaves a short text alone', () => {
    expect(clipTurnText('Hello there.', 20)).toEqual({ text: 'Hello there.', clipped: false });
  });

  it('cuts a long text at the last space before the limit and adds an ellipsis', () => {
    expect(clipTurnText('one two three four five', 15)).toEqual({
      text: 'one two three…',
      clipped: true,
    });
  });

  it('cuts a text without spaces at the limit, never inside a character', () => {
    expect(clipTurnText('abcdefghij', 4)).toEqual({ text: 'abcd…', clipped: true });
    // An emoji is two UTF-16 code units: the cut keeps or drops it whole.
    expect(clipTurnText('ab😀cdef', 3)).toEqual({ text: 'ab…', clipped: true });
  });
});

describe('groupCallTranscriptTurns', () => {
  it('puts consecutive turns of one speaker under one name', () => {
    const groups = groupCallTranscriptTurns([
      turn(PERSON, 'Hi'),
      turn(PERSON, 'Are you there?'),
      turn(AGENT, 'Yes.'),
      turn(PERSON, 'Great.'),
      turn(AGENT, 'What can I do?'),
      turn(AGENT, 'I am listening.'),
    ]);
    expect(groups).toEqual([
      { sender: PERSON, texts: ['Hi', 'Are you there?'], index: 0 },
      { sender: AGENT, texts: ['Yes.'], index: 2 },
      { sender: PERSON, texts: ['Great.'], index: 3 },
      { sender: AGENT, texts: ['What can I do?', 'I am listening.'], index: 4 },
    ]);
  });

  it('answers no groups for no turns', () => {
    expect(groupCallTranscriptTurns([])).toEqual([]);
  });
});

describe('callTranscriptSpeakersTrusted', () => {
  const VIEWER = '@reader:example.org';
  const COLLEAGUE = '@kai:example.org';
  const OTHER_AGENT = '@mindroom_research:example.org';
  const FOREIGN_AGENT = '@mindroom_helper:other.example';
  const joined = new Set([PERSON, COLLEAGUE, AGENT, OTHER_AGENT, FOREIGN_AGENT]);
  const isJoinedMember = (userId: string) => joined.has(userId);
  const spoken = (...senders: string[]) => ({
    durationSeconds: 60,
    turns: senders.map((sender) => turn(sender, 'Words.')),
  });
  const trusted = (poster: string, ...senders: string[]) =>
    callTranscriptSpeakersTrusted(spoken(...senders), poster, VIEWER, isJoinedMember);

  it('trusts an agent that speaks as itself with joined people', () => {
    expect(trusted(AGENT, PERSON, AGENT, COLLEAGUE, PERSON)).toBe(true);
  });

  it('distrusts a person who posts the key, even with the agent as a speaker', () => {
    expect(trusted(PERSON, PERSON, AGENT)).toBe(false);
  });

  it('distrusts an agent of another homeserver as the poster', () => {
    expect(trusted(FOREIGN_AGENT, PERSON)).toBe(false);
  });

  it('distrusts an agent that attributes turns to another agent', () => {
    expect(trusted(AGENT, PERSON, OTHER_AGENT)).toBe(false);
    // An agent account of another homeserver is an agent too, never a person.
    expect(trusted(AGENT, PERSON, FOREIGN_AGENT)).toBe(false);
  });

  it('distrusts a person who is not a joined member of the room', () => {
    expect(trusted(AGENT, PERSON, '@visitor:other.example')).toBe(false);
  });
});
