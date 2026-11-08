// @vitest-environment jsdom
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_NOTES_KEY,
  CALL_ROW_KEY,
  isCallRowEvent,
  readCallNotes,
  readCallRow,
} from './callRow';
import { installEventContentGuard, sanitizeContent, trustAgentsOfViewer } from './untrustedContent';
import { putSession, setActiveSession } from '../session/sessions';

const VIEWER = '@reader:example.org';
const ROUTER = '@mindroom_router:example.org';
const PERSON = '@person:example.org';

const event = (sender: string, content: Record<string, unknown>): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!room:example.org',
    event_id: '$row',
    sender,
    origin_server_ts: 1,
    content,
  } as Partial<IEvent>);

const row = (callId: unknown) => ({
  msgtype: 'm.notice',
  body: 'Call started',
  [CALL_ROW_KEY]: { call_id: callId },
});

const notes = (callId: unknown) => ({
  msgtype: 'm.notice',
  body: '## Decisions',
  [CALL_NOTES_KEY]: { call_id: callId },
});

const signIn = (userId: string, setActive = true) =>
  putSession(
    { baseUrl: 'https://matrix.example', userId, deviceId: 'DEVICE', accessToken: 'token' },
    { setActive }
  );

beforeAll(() => {
  installEventContentGuard();
  trustAgentsOfViewer(VIEWER);
});

beforeEach(() => {
  localStorage.clear();
  signIn(VIEWER);
});

describe('readCallRow and readCallNotes', () => {
  it('read the call id; an unedited row is a live call', () => {
    expect(readCallRow(row('call-1'))).toEqual({ callId: 'call-1' });
    expect(readCallNotes(notes('call-1'))).toBe('call-1');
  });

  it('read the end and the transcript message from the edits the router makes', () => {
    const ended = {
      msgtype: 'm.notice',
      body: 'Call ended · 12 min',
      [CALL_ROW_KEY]: {
        call_id: 'call-1',
        ended_at: '2026-11-07T10:00:00Z',
        duration_seconds: 720,
      },
    };
    expect(readCallRow(ended)).toEqual({ callId: 'call-1', ended: { durationSeconds: 720 } });
    const transcribed = {
      ...ended,
      [CALL_ROW_KEY]: { ...ended[CALL_ROW_KEY], transcript_event_id: '$notes' },
    };
    expect(readCallRow(transcribed)).toEqual({
      callId: 'call-1',
      ended: { durationSeconds: 720, transcriptEventId: '$notes' },
    });
  });

  it('read an end without a usable duration or event ID as an end alone', () => {
    expect(
      readCallRow({
        [CALL_ROW_KEY]: {
          call_id: 'call-1',
          ended_at: '2026-11-07T10:00:00Z',
          duration_seconds: -5,
          transcript_event_id: 'notes',
        },
      })
    ).toEqual({ callId: 'call-1', ended: {} });
  });

  it.each([
    ['no key', { msgtype: 'm.notice', body: 'Call started' }],
    ['a string', { [CALL_ROW_KEY]: 'call-1' }],
    ['no call id', { [CALL_ROW_KEY]: {} }],
    ['a number', row(7)],
    ['an empty id', row('')],
  ])('answer undefined for %s', (_case, content) => {
    expect(readCallRow(content)).toBeUndefined();
  });
});

describe('isCallRowEvent', () => {
  it('counts a row from a MindRoom agent', () => {
    expect(isCallRowEvent(event(ROUTER, row('call-1')))).toBe(true);
  });

  it('never counts a row a person wrote, nor any other message', () => {
    expect(isCallRowEvent(event(PERSON, row('call-1')))).toBe(false);
    // Not even where the content reaches it unchecked.
    const unchecked = event(PERSON, row('call-1'));
    vi.spyOn(unchecked, 'getContent').mockReturnValue(row('call-1'));
    expect(isCallRowEvent(unchecked)).toBe(false);
    expect(isCallRowEvent(event(ROUTER, { msgtype: 'm.notice', body: 'Call started' }))).toBe(
      false
    );
  });

  it("counts only the active account's agents, with another account signed in", () => {
    // Both accounts' clients started on this page, so the content guard trusts both accounts'
    // agents; only the active account's agents post rows it shows.
    const OTHER_ACCOUNT = '@reader:second.example';
    trustAgentsOfViewer(OTHER_ACCOUNT);
    const other = signIn(OTHER_ACCOUNT, false);
    const elsewhere = event('@mindroom_router:second.example', row('call-1'));
    expect(isCallRowEvent(elsewhere)).toBe(false);
    expect(isCallRowEvent(event(ROUTER, row('call-1')))).toBe(true);

    setActiveSession(other.sessionId);
    expect(isCallRowEvent(elsewhere)).toBe(true);
    expect(isCallRowEvent(event(ROUTER, row('call-1')))).toBe(false);
  });

  it('never counts a redacted row', () => {
    const redacted = event(ROUTER, row('call-1'));
    redacted.makeRedacted(
      new MatrixEvent({ type: 'm.room.redaction', redacts: '$row' } as Partial<IEvent>),
      { getUnfilteredTimelineSet: () => undefined } as never
    );
    expect(isCallRowEvent(redacted)).toBe(false);
  });
});

describe("the call keys are an agent's only", () => {
  it('are stripped from what a person sends', () => {
    expect(sanitizeContent({ ...row('call-1'), ...notes('call-1') }, false)).toEqual({
      msgtype: 'm.notice',
      body: '## Decisions',
    });
  });
});
