import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { parseDocumentEditArguments, readDocumentCard } from './documentProtocol';

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
  edit_arguments: Record<string, unknown>;
  cases: Array<{ id: string; event: ContractEvent }>;
};

const fixturePath =
  process.env.MICROSOFT_365_CONTRACT_FIXTURE ??
  fileURLToPath(new URL('./__fixtures__/microsoft365BackendContract.json', import.meta.url));
const contract = JSON.parse(readFileSync(fixturePath, 'utf8')) as ContractFixture;

const mx = new MatrixClient({ baseUrl: 'https://localhost', userId: contract.viewer_id });
const room = new Room(contract.room_id, mx, contract.viewer_id);
new Set([contract.viewer_id, ...contract.cases.map(({ event }) => event.sender)]).forEach(
  (userId) =>
    room.currentState.setStateEvents([
      new MatrixEvent({
        event_id: `$member-${userId}`,
        room_id: contract.room_id,
        sender: userId,
        type: 'm.room.member',
        state_key: userId,
        content: { membership: 'join' },
      }),
    ])
);

describe('Microsoft 365 backend contract', () => {
  it('covers every card event and scope the backend emits', () => {
    expect(contract.version).toBe(1);
    expect(contract.cases.map(({ id }) => id).sort()).toEqual([
      'room/connected',
      'thread/connected',
      'thread/edited',
      'thread/edited-partial',
      'thread/saved',
    ]);
  });

  it.each(contract.cases.map((item) => [item.id, item.event] as const))(
    'reads %s from the real backend event',
    (id, event) => {
      const card = readDocumentCard(new MatrixEvent(event), contract.viewer_id, room);
      expect(card, id).toBeDefined();
      expect(card?.event).toBe(id.split('/')[1].replace('-partial', ''));
      expect(card?.name).toBeTruthy();
      expect(card?.webUrl).toMatch(/^https:\/\//);
      expect(card?.fileUrl).toMatch(/^https:\/\//);
    }
  );

  it('reads edit outcomes from a partially applied change', () => {
    const partial = contract.cases.find(({ id }) => id === 'thread/edited-partial');
    const card = readDocumentCard(new MatrixEvent(partial!.event), contract.viewer_id, room);
    expect(card?.change?.status).toBe('partial');
    expect(card?.change?.verified).toBe(false);
    expect(card?.change?.edits.map((edit) => edit.outcome)).toEqual(['conflict', 'applied']);
  });

  it('parses the approval arguments the backend accepts', () => {
    const parsed = parseDocumentEditArguments(contract.edit_arguments);
    expect(parsed?.edits.map((edit) => edit.range)).toEqual([
      'Assumptions!B4:B5',
      "'Summary Sheet'!B2",
    ]);
  });
});
