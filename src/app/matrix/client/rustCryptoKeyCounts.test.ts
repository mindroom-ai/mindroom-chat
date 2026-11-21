import {
  DeviceId,
  initAsync,
  OlmMachine,
  RequestType,
  UserId,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { createClient, MemoryStore, type MatrixClient } from 'matrix-js-sdk';
import type { SyncCryptoChanges } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { RustCrypto } from 'matrix-js-sdk/lib/rust-crypto/rust-crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The SDK hands each /sync to the Rust crypto machine in one call (matrix-js-sdk #5503): the
// to-device messages, the device list changes and the one-time key counts together. These tests
// drive the real machine through the SDK's own method against a homeserver kept in memory, and
// count the one-time keys the device uploads.

const OWNER = '@owner:example.org';
const PEER = '@peer:example.org';
const DEVICE = 'OWNERDEVICE';

type KeysUploadBody = { device_keys?: unknown; one_time_keys?: Record<string, unknown> };

/** A homeserver that keeps the device's keys and counts the one-time keys it holds. */
const makeServer = (machine: OlmMachine) => {
  let deviceKeys: unknown;
  let keysHeld = 0;
  const uploads: number[] = [];
  /** Answers the machine's outgoing requests as a homeserver would, until it has none left. */
  const flush = async () => {
    for (let pass = 0; pass < 5; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      const requests = (await machine.outgoingRequests()) as {
        id: string;
        type: RequestType;
        body: string;
      }[];
      if (requests.length === 0) return;
      for (const request of requests) {
        let response: object = {};
        if (request.type === RequestType.KeysUpload) {
          const body = JSON.parse(request.body) as KeysUploadBody;
          deviceKeys = body.device_keys ?? deviceKeys;
          const uploaded = Object.keys(body.one_time_keys ?? {}).length;
          if (uploaded > 0) uploads.push(uploaded);
          keysHeld += uploaded;
          response = { one_time_key_counts: { signed_curve25519: keysHeld } };
        } else if (request.type === RequestType.KeysQuery) {
          response = { device_keys: { [OWNER]: { [DEVICE]: deviceKeys } }, failures: {} };
        }
        // eslint-disable-next-line no-await-in-loop
        await machine.markRequestAsSent(request.id, request.type, JSON.stringify(response));
      }
    }
    throw new Error('the machine kept sending requests');
  };
  return { flush, uploads, keysHeld: () => keysHeld };
};

/** The SDK's Rust crypto backend around the machine, with only the members these calls read. */
const sdkBackend = (machine: OlmMachine): RustCrypto => {
  const backend = Object.create(RustCrypto.prototype) as RustCrypto;
  Object.assign(backend, {
    olmMachine: machine,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return backend;
};

/** A device whose first sync filled the server with its one-time keys. */
const deviceWithKeysOnServer = async () => {
  const machine = await OlmMachine.initialize(new UserId(OWNER), new DeviceId(DEVICE));
  const server = makeServer(machine);
  const crypto = sdkBackend(machine);
  await server.flush();
  await crypto.processSyncChanges({
    toDeviceEvents: [],
    oneTimeKeysCounts: { signed_curve25519: server.keysHeld() },
    unusedFallbackKeys: ['signed_curve25519'],
  });
  await server.flush();
  await crypto.processSyncChanges({
    toDeviceEvents: [],
    oneTimeKeysCounts: { signed_curve25519: server.keysHeld() },
    unusedFallbackKeys: ['signed_curve25519'],
  });
  await server.flush();
  return { machine, server, crypto, uploadsAtStart: server.uploads.length };
};

beforeAll(async () => {
  await initAsync();
});

describe('one-time key counts in the SDK hand-over to the Rust crypto machine', () => {
  it('uploads no keys for syncs that bring only to-device messages or device list changes', async () => {
    const { machine, server, crypto, uploadsAtStart } = await deviceWithKeysOnServer();
    expect(server.keysHeld()).toBe(50);

    for (let index = 0; index < 3; index += 1) {
      // A sync's to-device messages come with its counts, which the server reports unchanged.
      // eslint-disable-next-line no-await-in-loop
      await crypto.processSyncChanges({
        toDeviceEvents: [{ sender: PEER, type: 'org.example.ping', content: { index } }],
        oneTimeKeysCounts: { signed_curve25519: server.keysHeld() },
        unusedFallbackKeys: ['signed_curve25519'],
      });
      // eslint-disable-next-line no-await-in-loop
      await server.flush();
    }
    for (const deviceLists of [{ changed: [PEER] }, { left: [PEER] }]) {
      // eslint-disable-next-line no-await-in-loop
      await crypto.processSyncChanges({
        toDeviceEvents: [],
        deviceLists,
        oneTimeKeysCounts: { signed_curve25519: server.keysHeld() },
        unusedFallbackKeys: ['signed_curve25519'],
      });
      // eslint-disable-next-line no-await-in-loop
      await server.flush();
    }

    expect(server.uploads.slice(uploadsAtStart)).toEqual([]);
    expect(server.keysHeld()).toBe(50);
    machine.free();
  });

  it('still refills the server when a sync leaves the counts out, which means none are left', async () => {
    const { machine, server, crypto, uploadsAtStart } = await deviceWithKeysOnServer();

    // Every key was claimed; the server then sends no `device_one_time_keys_count` at all.
    await crypto.processSyncChanges({
      toDeviceEvents: [],
      unusedFallbackKeys: ['signed_curve25519'],
    });
    await server.flush();

    expect(server.uploads.slice(uploadsAtStart)).toEqual([50]);
    machine.free();
  });
});

describe('one-time key counts of a sync that reports neither counts nor fallback keys', () => {
  const clients: MatrixClient[] = [];
  afterEach(() => {
    clients.splice(0).forEach((client) => client.stopClient());
  });

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('reads a live sync as no keys left, and the saved sync replay as no report', async () => {
    // A server without fallback keys (Matrix 1.1) leaves out both fields once every key was
    // claimed. The first /sync answers like that; later ones wait, as a long poll does.
    let syncs = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/versions')) return json({ versions: ['v1.1'] });
      if (url.pathname.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (!url.pathname.endsWith('/sync')) return json({});
      syncs += 1;
      if (syncs === 1) return json({ next_batch: 'live' });
      return new Promise<Response>(() => {
        // Nothing new: the long poll stays open.
      });
    });
    const store = new MemoryStore();
    store.getSavedSync = async () => ({
      nextBatch: 'saved',
      roomsData: { join: {}, invite: {}, leave: {}, knock: {} },
      accountData: [],
    });
    const client = createClient({
      baseUrl: 'https://matrix.example',
      userId: OWNER,
      deviceId: DEVICE,
      accessToken: 'token',
      store,
      fetchFn,
    });
    clients.push(client);
    const processSyncChanges = vi.fn(async (_changes: SyncCryptoChanges) => []);
    // Only the sync callbacks of the crypto backend matter here.
    (client as unknown as { cryptoBackend: unknown }).cryptoBackend = {
      processSyncChanges,
      onCryptoEvent: vi.fn(async () => undefined),
      onSyncCompleted: vi.fn(),
      stop: vi.fn(),
    };

    await client.startClient();
    await vi.waitFor(() => expect(processSyncChanges).toHaveBeenCalled(), { timeout: 5_000 });

    // The replay, which the live sync waits for, brings no counts and never reaches the crypto
    // layer; the live sync says none are left.
    expect(processSyncChanges.mock.calls).toEqual([
      [expect.objectContaining({ oneTimeKeysCounts: {}, unusedFallbackKeys: undefined })],
    ]);
  });

  it('makes the crypto machine refill the server', async () => {
    const { machine, server, crypto, uploadsAtStart } = await deviceWithKeysOnServer();

    await crypto.processSyncChanges({ toDeviceEvents: [], oneTimeKeysCounts: {} });
    await server.flush();

    expect(server.uploads.slice(uploadsAtStart)).toEqual([50]);
    machine.free();
  });
});
