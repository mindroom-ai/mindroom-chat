import { describe, expect, it } from 'vitest';
import { readChatUiAction } from './chatUiProtocol';
import { agentId, makeUiEvent, makeUiRoom, viewerId } from './testUtils';

describe('readChatUiAction', () => {
  it('binds a computer request to its event, actual sender, and canonical thread', () => {
    const { room } = makeUiRoom();
    expect(readChatUiAction(makeUiEvent(), viewerId, room)).toEqual({
      eventId: '$request',
      action: 'show_computer',
      agentUserId: agentId,
      threadId: '$thread',
    });
  });

  it.each([
    'general',
    'account',
    'notifications',
    'devices',
    'emojis-stickers',
    'developer',
    'about',
  ])('accepts the supported settings section %s', (section) => {
    const { room } = makeUiRoom();
    expect(
      readChatUiAction(makeUiEvent({ action: 'open_settings', section }), viewerId, room)
    ).toMatchObject({ action: 'open_settings', section });
  });

  it('accepts the existing Members side panel', () => {
    const { room } = makeUiRoom();
    expect(
      readChatUiAction(makeUiEvent({ action: 'open_panel', panel: 'members' }), viewerId, room)
    ).toMatchObject({ action: 'open_panel', panel: 'members' });
  });

  it('accepts a room request only when it has no thread relation', () => {
    const { room } = makeUiRoom();
    const event = makeUiEvent({ thread_id: null });
    delete event.event.content!['m.relates_to'];
    expect(readChatUiAction(event, viewerId, room)?.threadId).toBeUndefined();
    expect(readChatUiAction(makeUiEvent({ thread_id: null }), viewerId, room)).toBeUndefined();
  });

  it.each([
    { version: 2 },
    { version: true },
    { action: 'eval', javascript: 'alert(1)' },
    { action: 'open_settings', section: 'https://evil.example' },
    { action: 'open_panel', panel: 'unknown' },
    { requester_id: '@bob:example.org' },
    { agent_user_id: '@mindroom_second:example.org' },
    { room_id: '!another:example.org' },
    { thread_id: '$another' },
    { thread_id: undefined },
  ])('rejects unsupported or inconsistent metadata %j', (metadata) => {
    const { room } = makeUiRoom();
    expect(readChatUiAction(makeUiEvent(metadata), viewerId, room)).toBeUndefined();
  });

  it('rejects foreign, ordinary, and departed senders', () => {
    const { room } = makeUiRoom();
    ['@mindroom_foreign:elsewhere.org', viewerId, '@mindroom_departed:example.org'].forEach(
      (sender) => {
        expect(
          readChatUiAction(makeUiEvent({ agent_user_id: sender }, { sender }), viewerId, room)
        ).toBeUndefined();
      }
    );
  });

  it('rejects edits, edited originals, redactions, local echoes, and non-notice messages', () => {
    const { room } = makeUiRoom();
    const edit = makeUiEvent();
    edit.event.content!['m.relates_to'] = { rel_type: 'm.replace', event_id: '$original' };
    const edited = makeUiEvent();
    edited.makeReplaced(edit);
    const redacted = makeUiEvent();
    redacted.makeRedacted(makeUiEvent({}, { type: 'm.room.redaction' }), room);
    const text = makeUiEvent();
    text.event.content!.msgtype = 'm.text';
    [edit, edited, redacted, text, makeUiEvent({}, { event_id: undefined })].forEach((event) => {
      expect(readChatUiAction(event, viewerId, room)).toBeUndefined();
    });
  });
});
