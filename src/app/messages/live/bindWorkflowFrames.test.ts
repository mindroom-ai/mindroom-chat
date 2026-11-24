import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import frames from './__fixtures__/workflow-frames-v1.json';
import { bindWorkflowFrames } from './bindWorkflowFrames';
import { WorkflowRunStore } from './workflowRunStore';

const firstFrame = frames[0]!;
const secondFrame = frames[1]!;
const ROOM = '!room:example.org';
const AGENT = '@mindroom_panels:example.org';
const VIEWER = '@alex:example.org';

const megolm = (ciphertext: string) => ({
  algorithm: 'm.megolm.v1.aes-sha2',
  sender_key: 'k',
  session_id: 's',
  device_id: 'd',
  ciphertext,
});

const createClient = ({ encrypted }: { encrypted: boolean }) => {
  const emitter = new EventEmitter();
  const decryptions = new Map<string, { type: string; content: Record<string, unknown> }>();
  const decrypted: MatrixEvent[] = [];
  const backend = {
    decryptEvent: async (event: MatrixEvent) => {
      const result = decryptions.get(String(event.getWireContent().ciphertext));
      if (!result) {
        throw new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no');
      }
      return { clearEvent: { ...result, room_id: ROOM } };
    },
  };
  const mx = Object.assign(emitter, {
    getUserId: () => VIEWER,
    getRoom: (roomId: string) =>
      roomId === ROOM ? { roomId, hasEncryptionStateEvent: () => encrypted } : null,
    decryptEventIfNeeded: vi.fn(async (event: MatrixEvent) => {
      decrypted.push(event);
      await event.attemptDecryption(backend as never);
    }),
  }) as unknown as MatrixClient;

  const store = new WorkflowRunStore();
  const ingest = vi.spyOn(store, 'ingest');
  const unbind = bindWorkflowFrames(mx, store);
  const receive = (
    content: Record<string, unknown>,
    { sender = AGENT, type = 'io.mindroom.workflow' } = {}
  ) => {
    emitter.emit(ClientEvent.Event, {
      getType: () => type,
      getRoomId: () => ROOM,
      getSender: () => sender,
      getTs: () => 1,
      getContent: () => content,
    });
  };
  return { store, ingest, unbind, receive, decryptions, decrypted };
};

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- each turn lets one queued step run.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
};

describe('bindWorkflowFrames', () => {
  const unbinds: (() => void)[] = [];

  afterEach(() => {
    unbinds.splice(0).forEach((unbind) => unbind());
  });

  const bind = (options: { encrypted: boolean }) => {
    const client = createClient(options);
    unbinds.push(client.unbind);
    return client;
  };

  it('stores workflow runs of an unencrypted room under the sync room and sender', async () => {
    const { store, receive } = bind({ encrypted: false });
    receive(firstFrame);
    receive(secondFrame);
    await settle();

    const entry = store.get(ROOM, firstFrame.run);
    expect(entry).toMatchObject({ roomId: ROOM, sender: AGENT, seq: 2 });
    expect(entry?.graph.nodes[0]?.status).toBe('completed');
  });

  it('decrypts workflow frames in an encrypted room under synthetic workflow ids', async () => {
    const { store, receive, decryptions, decrypted } = bind({ encrypted: true });
    decryptions.set('a', { type: 'io.mindroom.workflow', content: firstFrame });
    decryptions.set('b', { type: 'io.mindroom.workflow', content: secondFrame });

    receive({ v: 1, encrypted: megolm('a') });
    receive({ v: 1, encrypted: megolm('b') });
    await settle();

    expect(decrypted.map((event) => event.getId())).toEqual([
      '$io.mindroom.live.workflow.1',
      '$io.mindroom.live.workflow.2',
    ]);
    expect(store.get(ROOM, firstFrame.run)?.seq).toBe(2);
  });

  it('ignores non-agent senders and clears store on unbind', async () => {
    const { store, ingest, receive, unbind } = bind({ encrypted: false });
    receive(firstFrame, { sender: '@mallory:example.org' });
    await settle();
    expect(ingest).not.toHaveBeenCalled();

    receive(firstFrame);
    await settle();
    expect(store.get(ROOM, firstFrame.run)).toBeDefined();
    unbind();
    expect(store.get(ROOM, firstFrame.run)).toBeUndefined();
  });
});
