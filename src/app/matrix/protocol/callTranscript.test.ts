import { describe, expect, it } from 'vitest';
import {
  CALL_TRANSCRIPT_KEY,
  CALL_TRANSCRIPT_MAX_TOTAL_LENGTH,
  CALL_TRANSCRIPT_MAX_TURNS,
  callTranscriptSpeakersTrusted,
  clipTurnText,
  groupCallTranscriptTurns,
  readCallTranscript,
  speakerMemberships,
} from './callTranscript';
import { defined } from '../../../test/utils/defined';

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

  it("names the call of a people call's transcript message, whose body is the notes", () => {
    const content = {
      ...withTranscript({ duration_seconds: 720, turns: [turn(PERSON, 'Shall we ship it?')] }),
      'io.mindroom.call_notes': { call_id: 'call-1' },
    };
    expect(readCallTranscript(content)).toEqual({
      durationSeconds: 720,
      turns: [{ sender: PERSON, text: 'Shall we ship it?' }],
      callId: 'call-1',
      summaryOnly: false,
    });
    // Without a notes model the body is only the one-line summary.
    expect(readCallTranscript({ ...content, body: 'Call · 12 min' })?.summaryOnly).toBe(true);
  });

  it('counts speakers who were in a call between people and left since', () => {
    const turns = [turn(PERSON, 'Hello')];
    const people = readCallTranscript({
      ...withTranscript({ duration_seconds: 60, turns }),
      'io.mindroom.call_notes': { call_id: 'call-1' },
    });
    const agentCall = readCallTranscript(withTranscript({ duration_seconds: 60, turns }));
    expect([...speakerMemberships(defined(people, 'people'))].sort()).toEqual([
      'ban',
      'join',
      'leave',
    ]);
    expect([...speakerMemberships(defined(agentCall, 'agent call'))]).toEqual(['join']);
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

  it("reads each turn's time from the call's start, in whole seconds", () => {
    const content = withTranscript({
      duration_seconds: 125,
      turns: [
        { sender: PERSON, text: 'Can you hear me?', offset_seconds: 0 },
        { sender: AGENT, text: 'Yes.', offset_seconds: 4 },
        { sender: PERSON, text: 'Bye.', offset_seconds: 125 },
      ],
    });
    expect(readCallTranscript(content)?.turns.map((each) => each.offsetSeconds)).toEqual([
      0, 4, 125,
    ]);
  });

  it('reads a transcript without times, as older MindRoom versions send it', () => {
    const transcript = readCallTranscript(
      withTranscript({ duration_seconds: 60, turns: [turn(PERSON, 'Hello'), turn(AGENT, 'Hi')] })
    );
    expect(transcript?.turns).toHaveLength(2);
    expect(transcript?.turns.every((each) => each.offsetSeconds === undefined)).toBe(true);
  });

  it.each([
    ['a string', '12'],
    ['null', null],
    ['a negative number', -1],
    ['a fraction', 4.5],
    ['NaN', Number.NaN],
    ['an infinite number', Infinity],
    ['a time after the call ended', 61],
  ])('drops a time that is %s and keeps the turn', (_, offset) => {
    const transcript = readCallTranscript(
      withTranscript({
        duration_seconds: 60,
        turns: [{ sender: PERSON, text: 'Hello', offset_seconds: offset }, turn(AGENT, 'Hi')],
      })
    );
    expect(transcript?.turns[0]).toEqual({ sender: PERSON, text: 'Hello' });
    expect(transcript?.turns[0]?.offsetSeconds).toBeUndefined();
    expect(transcript?.turns).toHaveLength(2);
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

  it("shows a call between people's first turns up to the limits, and how many more there are", () => {
    const notes = { 'io.mindroom.call_notes': { call_id: 'call-1' } };
    const colleague = '@kai:example.org';
    const many = Array.from({ length: CALL_TRANSCRIPT_MAX_TURNS + 5 }, (_, index) =>
      turn(index % 2 ? colleague : PERSON, `Line ${index}`)
    );
    const long = readCallTranscript({
      ...withTranscript({ duration_seconds: 7200, turns: many }),
      ...notes,
    });
    expect(long?.turns).toHaveLength(CALL_TRANSCRIPT_MAX_TURNS);
    expect(long?.turns.at(-1)?.text).toBe(`Line ${CALL_TRANSCRIPT_MAX_TURNS - 1}`);
    expect(long?.moreTurns).toBe(5);

    const half = 'a'.repeat(CALL_TRANSCRIPT_MAX_TOTAL_LENGTH / 2);
    const large = readCallTranscript({
      ...withTranscript({
        duration_seconds: 7200,
        turns: [turn(PERSON, half), turn(colleague, half), turn(PERSON, 'One more.')],
      }),
      ...notes,
    });
    expect(large?.turns.map((each) => each.sender)).toEqual([PERSON, colleague]);
    expect(large?.moreTurns).toBe(1);
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

  it("gives a group its first turn's time", () => {
    const groups = groupCallTranscriptTurns([
      { sender: PERSON, text: 'Hi', offsetSeconds: 2 },
      { sender: PERSON, text: 'Are you there?', offsetSeconds: 6 },
      { sender: AGENT, text: 'Yes.' },
      { sender: AGENT, text: 'Go ahead.', offsetSeconds: 12 },
      { sender: PERSON, text: 'Great.', offsetSeconds: 15 },
    ]);
    expect(groups.map((group) => group.offsetSeconds)).toEqual([2, undefined, 15]);
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
