import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientStartupProvider } from '../../pages/client/ClientStartupContext';
import { ServerEmojiJoinFeature } from './ServerEmojiJoinFeature';

const ROOM_ID = '!emoji:example.com';
const ALIAS = '#emoji:example.com';
const DISCOVERY = {
  'm.homeserver': { base_url: 'https://example.com' },
  'io.mindroom.emoji': { room: ALIAS },
};

const emojiRoom = {
  roomId: ROOM_ID,
  getCanonicalAlias: () => ALIAS,
  getMyMembership: () => 'join',
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (type: string) =>
        type === 'm.room.create' ? { getContent: () => ({ 'm.federate': false }) } : null,
    }),
  }),
};

/** The account on the server: its push rules and account data, shared by every page load. */
const account = () => {
  const overrides = new Map<string, unknown>();
  const accountData = new Map<string, Record<string, unknown>>();
  return { overrides, accountData };
};

/** A new client per page load, as the app creates, over the same account. */
const pageLoad = (server: ReturnType<typeof account>) => ({
  getRooms: () => [emojiRoom],
  getRoom: (roomId: string) => (roomId === ROOM_ID ? emojiRoom : null),
  joinRoom: vi.fn(async () => ({})),
  getAccountData: (type: string) => {
    if (type === 'm.push_rules') {
      const override = [...server.overrides.keys()].map((rule_id) => ({ rule_id }));
      return { getContent: () => ({ global: { override } }) };
    }
    const content = server.accountData.get(type);
    return content ? { getContent: () => content } : undefined;
  },
  setAccountData: vi.fn(async (type: string, content: Record<string, unknown>) => {
    server.accountData.set(type, content);
    return {};
  }),
  addPushRule: vi.fn(async (_scope: string, _kind: string, ruleId: string, rule: unknown) => {
    server.overrides.set(ruleId, rule);
    return {};
  }),
  on: vi.fn(),
  removeListener: vi.fn(),
});

let renderer: ReactTestRenderer | undefined;
const open = async (client: ReturnType<typeof pageLoad>, synced = true) => {
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={client as never}>
        <AutoDiscoveryInfoProvider value={DISCOVERY as never}>
          <ClientStartupProvider hasCompletedInitialSync={synced}>
            <Provider store={createStore()}>
              <ServerEmojiJoinFeature />
            </Provider>
          </ClientStartupProvider>
        </AutoDiscoveryInfoProvider>
      </MatrixClientProvider>
    );
  });
};
const close = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
};

afterEach(close);

describe('ServerEmojiJoinFeature after the person unmutes the room', () => {
  it('mutes the room once per account, so an unmute lasts across page loads', async () => {
    const server = account();
    const first = pageLoad(server);
    await open(first);
    expect(first.addPushRule).toHaveBeenCalledTimes(1);
    expect(server.accountData.get('io.mindroom.server_emoji_muted')).toEqual({
      rooms: [ROOM_ID],
    });
    close();

    // The notification menu's unmute deletes the override rule.
    server.overrides.delete(ROOM_ID);
    const second = pageLoad(server);
    await open(second);

    expect(second.addPushRule).not.toHaveBeenCalled();
  });

  it('waits for the first sync, which brings the account data that says so', async () => {
    const server = account();
    const client = pageLoad(server);
    await open(client, false);
    expect(client.addPushRule).not.toHaveBeenCalled();
  });
});
