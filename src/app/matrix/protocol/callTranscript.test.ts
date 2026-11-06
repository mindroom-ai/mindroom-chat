import { describe, expect, it } from 'vitest';
import {
  CALL_TRANSCRIPT_KEY,
  CALL_TRANSCRIPT_MAX_TURNS,
  CALL_TRANSCRIPT_MAX_TEXT_LENGTH,
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

  it('falls back for a turn longer than it renders', () => {
    const longest = 'a'.repeat(CALL_TRANSCRIPT_MAX_TEXT_LENGTH);
    expect(
      readCallTranscript(withTranscript({ duration_seconds: 10, turns: [turn(PERSON, longest)] }))
    ).toBeDefined();
    expect(
      readCallTranscript(
        withTranscript({ duration_seconds: 10, turns: [turn(PERSON, `${longest}a`)] })
      )
    ).toBeUndefined();
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
