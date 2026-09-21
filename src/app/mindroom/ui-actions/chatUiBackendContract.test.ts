import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { readChatUiAction, type ChatUiSettingsSection } from './chatUiProtocol';

type ContractEvent = {
  event_id: string;
  room_id: string;
  sender: string;
  type: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
};

type ContractFixture = {
  version: number;
  viewer_id: string;
  room_id: string;
  cases: Array<{ id: string; event: ContractEvent }>;
};

type ExpectedAction =
  | { action: 'show_computer' }
  | { action: 'open_settings'; section: ChatUiSettingsSection }
  | { action: 'open_panel'; panel: 'members' };

const fixturePath =
  process.env.CHAT_UI_CONTRACT_FIXTURE ??
  fileURLToPath(new URL('./__fixtures__/chatUiBackendContract.json', import.meta.url));
const contract = JSON.parse(readFileSync(fixturePath, 'utf8')) as ContractFixture;

const SETTINGS_SECTIONS = [
  'general',
  'account',
  'notifications',
  'devices',
  'emojis-stickers',
  'developer',
  'about',
] as const;

const expectedCases = new Map<string, ExpectedAction>();
(['thread', 'room'] as const).forEach((scope) => {
  expectedCases.set(`${scope}/show_computer`, { action: 'show_computer' });
  // The canonical panel API keeps the existing Computer wire action for compatibility.
  expectedCases.set(`${scope}/open_panel/computer`, { action: 'show_computer' });
  SETTINGS_SECTIONS.forEach((section) => {
    expectedCases.set(`${scope}/open_settings/${section}`, { action: 'open_settings', section });
  });
  expectedCases.set(`${scope}/open_panel/members`, { action: 'open_panel', panel: 'members' });
});

const mx = new MatrixClient({ baseUrl: 'https://localhost', userId: contract.viewer_id });
const room = new Room(contract.room_id, mx, contract.viewer_id);
const memberIds = new Set([contract.viewer_id, ...contract.cases.map(({ event }) => event.sender)]);
memberIds.forEach((userId) => {
  room.currentState.setStateEvents([
    new MatrixEvent({
      event_id: `$member-${userId}`,
      room_id: contract.room_id,
      sender: userId,
      type: 'm.room.member',
      state_key: userId,
      content: { membership: 'join' },
    }),
  ]);
});

describe('MindRoom backend Chat UI wire contract', () => {
  it('contains every supported action in room and thread scope', () => {
    expect(contract.version).toBe(1);
    expect(new Set(contract.cases.map(({ id }) => id))).toEqual(new Set(expectedCases.keys()));
  });

  it.each(contract.cases)('parses the real backend notice for $id', ({ id, event }) => {
    const expected = expectedCases.get(id);
    expect(expected).toBeDefined();
    expect(readChatUiAction(new MatrixEvent(event), contract.viewer_id, room)).toEqual({
      eventId: event.event_id,
      agentUserId: event.sender,
      threadId: id.startsWith('thread/') ? '$thread' : undefined,
      ...expected,
    });
  });
});
