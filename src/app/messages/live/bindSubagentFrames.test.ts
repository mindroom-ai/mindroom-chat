import { EventEmitter } from 'events';
import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSubagentFrames } from './bindSubagentFrames';
import { SubagentRunStore } from './subagentRunStore';

const ROOM = '!room:example';
const AGENT = '@mindroom_helper:example';
const VIEWER = '@alice:example';
const SID = '1762790000123-0a1b2c3d';

const wireMeta = {
  agent: 'helper',
  caller: 'lead',
  root: 'lead',
  parent: null,
  thread_id: '$thread:example',
  source: 'delegate',
  status: 'running',
  started_at: 1762790000,
  ended_at: null,
};
const snapshotFrame = {
  v: 1,
  run: 'del-1',
  sid: SID,
  seq: 0,
  meta: { ...wireMeta, task: 'Look it up.' },
  snapshot: { md: 'Hello', reasoning: '', tools: [], status: 'streaming', activity: '' },
};
const deltaFrame = {
  v: 1,
  run: 'del-1',
  sid: SID,
  seq: 1,
  meta: wireMeta,
  delta: { md: { at: 5, del: 0, ins: '!', len: 6 } },
};
const megolm = (id: string) => ({ algorithm: 'm.megolm.v1.aes-sha2', ciphertext: id });

type Decryption = { type: string; content: unknown };

// A client whose rooms are all encrypted or all not, with a real MatrixEvent decryption state
// and a crypto backend that answers per ciphertext.
const createClient = ({ encrypted }: { encrypted: boolean }) => {
  const emitter = new EventEmitter();
  const decryptions = new Map<string, Decryption>();
  const decrypted: MatrixEvent[] = [];
  const backend = {
    decryptEvent: async (event: MatrixEvent) => {
      const result = decryptions.get(event.getWireContent().ciphertext as string);
      if (!result) {
        throw new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no');
      }
      return { clearEvent: { ...result, room_id: ROOM } };
    },
  };
  const mx = Object.assign(emitter, {
    getUserId: () => VIEWER,
    getRoom: (roomId: string) =>
      roomId === ROOM ? { hasEncryptionStateEvent: () => encrypted } : null,
    decryptEventIfNeeded: async (event: MatrixEvent) => {
      decrypted.push(event);
      await event.attemptDecryption(backend as never);
    },
  }) as unknown as MatrixClient;
  const store = new SubagentRunStore();
  const ingest = vi.spyOn(store, 'ingest');
  const unbind = bindSubagentFrames(mx, store);
  const receive = (content: unknown, { sender = AGENT, type = 'io.mindroom.subagents' } = {}) => {
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        type,
        content: content as Record<string, unknown>,
        sender,
        room_id: ROOM,
        origin_server_ts: 1234,
      })
    );
  };
  return { store, ingest, unbind, receive, decryptions, decrypted };
};

// Lets the frame queue run its promise turns.
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- each turn lets one queued step run.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
};

describe('bindSubagentFrames', () => {
  const unbinds: (() => void)[] = [];

  afterEach(() => {
    unbinds.splice(0).forEach((unbind) => unbind());
  });

  const bind = (options: { encrypted: boolean }) => {
    const client = createClient(options);
    unbinds.push(client.unbind);
    return client;
  };

  it('stores the runs of an unencrypted room under the sync room and sender', async () => {
    const { store, receive } = bind({ encrypted: false });

    receive(snapshotFrame);
    receive(deltaFrame);
    receive({ ...snapshotFrame, meta: undefined });
    await settle();

    expect(store.runs(ROOM)).toMatchObject([
      { roomId: ROOM, run: 'del-1', sender: AGENT, seq: 1, meta: { task: 'Look it up.' } },
    ]);
    expect(store.runs(ROOM)[0]?.docs.md).toBe('Hello!');
  });

  it('ignores live reply frames and senders that are not MindRoom agents of the viewer', async () => {
    const { ingest, receive } = bind({ encrypted: false });

    receive(snapshotFrame, { type: 'io.mindroom.live' });
    receive(snapshotFrame, { sender: '@mallory:example' });
    receive(snapshotFrame, { sender: '@mindroom_helper:elsewhere.example' });
    await settle();

    expect(ingest).not.toHaveBeenCalled();
  });

  it('ignores plaintext frames in an encrypted room', async () => {
    const { ingest, receive, decrypted } = bind({ encrypted: true });

    receive(snapshotFrame);
    await settle();

    expect(decrypted).toEqual([]);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('decrypts frames as synthetic room events whose ids the SDK keeps out of key retries', async () => {
    const { store, receive, decryptions, decrypted } = bind({ encrypted: true });
    decryptions.set('a', { type: 'io.mindroom.subagents', content: snapshotFrame });
    decryptions.set('b', { type: 'io.mindroom.subagents', content: deltaFrame });

    receive({ v: 1, encrypted: megolm('a') });
    receive({ v: 1, encrypted: megolm('b') });
    await settle();

    expect(decrypted.map((event) => event.getId())).toEqual([
      '$io.mindroom.live.subagents.1',
      '$io.mindroom.live.subagents.2',
    ]);
    expect(decrypted[0]?.getSender()).toBe(AGENT);
    expect(decrypted[0]?.getRoomId()).toBe(ROOM);
    expect(store.runs(ROOM)).toMatchObject([{ sender: AGENT, seq: 1, docs: { md: 'Hello!' } }]);
  });

  it('drops frames that fail to decrypt or decrypt to another type', async () => {
    const { ingest, receive, decryptions } = bind({ encrypted: true });
    decryptions.set('reply', { type: 'io.mindroom.live', content: snapshotFrame });

    receive({ v: 1, encrypted: megolm('missing') });
    receive({ v: 1, encrypted: megolm('reply') });
    await settle();

    expect(ingest).not.toHaveBeenCalled();
  });

  it('stops listening and clears its store when unbound', async () => {
    const { store, receive, unbind } = bind({ encrypted: false });
    receive(snapshotFrame);
    await settle();
    expect(store.runs(ROOM)).toHaveLength(1);

    unbind();
    receive({ ...snapshotFrame, seq: 2 });
    await settle();

    expect(store.runs(ROOM)).toEqual([]);
  });
});
