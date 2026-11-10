import { describe, expect, it, vi } from 'vitest';
import { Editor, createEditor } from 'slate';
import {
  createClient,
  EventStatus,
  MatrixEvent,
  PendingEventOrdering,
  RelationType,
  Room,
} from 'matrix-js-sdk';
import {
  AutocompletePrefix,
  type AutocompleteQuery,
} from '../editor/autocomplete/autocompleteQuery';
import {
  createRoomInputPasteMarkerElement,
  getRoomInputPasteMarkerFileNames,
  getRoomInputVoiceSendContext,
  getRoomInputVoiceUploadRelation,
  isRoomInputAutocompleteQuery,
  RoomInputAutocomplete,
  RoomInputReplyContext,
  RoomInputThreadIndicator,
  refreshRoomInputVoiceSendContext,
  removeRoomInputPasteMarkerElements,
} from './RoomInputExtensions';
import { BlockType } from '../editor/types';

vi.mock('./commands/CommandAutocomplete', () => ({
  AgentCommandAutocomplete: () => null,
}));

vi.mock('../messages/ThreadIndicator', () => ({
  ThreadIndicator: () => null,
}));

vi.mock('../ui/PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('./voice/VoiceRecorderDialog', () => ({
  VoiceRecorderComposer: () => null,
}));

const range = {
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [0, 0], offset: 1 },
};

const query = (prefix: string): AutocompleteQuery<string> => ({
  range,
  prefix,
  text: '',
});

describe('RoomInputMindroomExtensions', () => {
  it('recognizes only MindRoom room-input autocomplete queries', () => {
    expect(isRoomInputAutocompleteQuery(query('!'))).toBe(true);
    expect(isRoomInputAutocompleteQuery(query(AutocompletePrefix.Command))).toBe(false);
    expect(isRoomInputAutocompleteQuery(undefined)).toBe(false);
  });

  it('does not render MindRoom autocomplete for upstream room-input queries', () => {
    expect(
      RoomInputAutocomplete({
        editor: {} as Editor,
        query: query(AutocompletePrefix.Command),
        requestClose: () => undefined,
      })
    ).toBeNull();
  });

  it('renders the thread indicator only for threaded reply drafts', () => {
    expect(
      RoomInputThreadIndicator({
        room: {} as never,
        relation: undefined,
      })
    ).toBeNull();

    expect(
      RoomInputThreadIndicator({
        room: {} as never,
        relation: {
          event_id: '$thread',
          rel_type: 'm.thread',
        } as never,
      })
    ).not.toBeNull();
  });

  it('renders the composer context only for replies or pending sends', () => {
    expect(
      RoomInputReplyContext({
        room: {} as never,
        relation: undefined,
      })
    ).toBeNull();

    expect(
      RoomInputReplyContext({
        pendingSend: true,
        room: {} as never,
        relation: undefined,
      })
    ).not.toBeNull();

    expect(
      RoomInputReplyContext({
        children: 'reply',
        room: {} as never,
        relation: undefined,
      })
    ).not.toBeNull();
  });

  it('creates and finds paste marker editor nodes', () => {
    const marker =
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';
    const element = createRoomInputPasteMarkerElement({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      raw: marker,
    });

    expect(element).toEqual({
      type: BlockType.PasteMarker,
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      marker,
      children: [{ text: '' }],
    });

    expect(
      getRoomInputPasteMarkerFileNames([
        {
          type: BlockType.Paragraph,
          children: [{ text: 'Before ' }, element, { text: ' after' }],
        },
      ])
    ).toEqual(new Set(['mindroom-paste-a3f19c.txt']));

    const editor = createEditor();
    editor.children = [
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Before ' }, element, { text: ' after' }],
      },
    ];

    removeRoomInputPasteMarkerElements(editor, new Set(['mindroom-paste-a3f19c.txt']));

    expect(getRoomInputPasteMarkerFileNames(editor.children)).toEqual(new Set());
  });

  it("marks a voice message recorded in a thread's own view as that view's", () => {
    const room = { roomId: '!room:example.org', getMembers: () => [] } as unknown as Room;
    const base = {
      ownerSessionId: '@me:example.org',
      roomId: room.roomId,
      room,
      threadId: '$thread',
      replyDraft: undefined,
    };

    expect(getRoomInputVoiceSendContext({ ...base, threadView: true }).threadView).toBe(true);
    expect(getRoomInputVoiceSendContext({ ...base, threadView: false })).not.toHaveProperty(
      'threadView'
    );
  });

  it('sends a voice reply to a threaded message without a thread relation in Classic mode', () => {
    const room = { roomId: '!room:example.org', getMembers: () => [] } as unknown as Room;
    const context = getRoomInputVoiceSendContext({
      ownerSessionId: '@me:example.org',
      roomId: room.roomId,
      room,
      threadId: undefined,
      replyDraft: {
        userId: '@you:example.org',
        eventId: '$reply',
        body: 'In the thread',
        relation: { rel_type: RelationType.Thread, event_id: '$root' },
      },
      threadingEnabled: false,
    });

    expect(getRoomInputVoiceUploadRelation(context, new File(['voice'], 'voice.ogg'))).toEqual({
      'm.in_reply_to': { event_id: '$reply' },
    });
  });

  it("takes the thread root's own ID once the server confirmed it", () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
    const room = new Room('!room:example.org', mx, '@me:example.org', {
      pendingEventOrdering: PendingEventOrdering.Chronological,
    });
    vi.spyOn(room, 'getMyMembership').mockReturnValue('join');
    vi.spyOn(mx, 'getRoom').mockReturnValue(room);
    const localId = `~${room.roomId}:txn-root`;
    const root = new MatrixEvent({
      event_id: localId,
      room_id: room.roomId,
      sender: '@me:example.org',
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Root' },
    });
    root.setStatus(EventStatus.SENDING);
    room.addPendingEvent(root, 'txn-root');
    const context = getRoomInputVoiceSendContext({
      ownerSessionId: '@me:example.org',
      roomId: room.roomId,
      room,
      threadId: localId,
      replyDraft: undefined,
    });
    // Still sending, the root has only its local ID.
    expect(refreshRoomInputVoiceSendContext(mx, context)?.threadId).toBe(localId);

    room.updatePendingEvent(root, EventStatus.SENT, '$root');
    expect(refreshRoomInputVoiceSendContext(mx, context)?.threadId).toBe('$root');
  });
});
