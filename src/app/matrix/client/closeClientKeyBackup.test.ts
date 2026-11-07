import {
  BackupDecryptionKey,
  DeviceId,
  EncryptionSettings,
  OlmMachine,
  RoomId,
  UserId,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { createClient, MemoryStore, type MatrixClient } from 'matrix-js-sdk';
import type { Logger } from 'matrix-js-sdk/lib/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeClient } from './closeClient';

// An account switch closes the client and with it the Rust crypto machine, while the machine's
// key backup work may still be running: the check of the server's backup, the upload of new keys
// to it, a key download that waits for that check, and the check of a backup key that another
// session sent. These tests run that work with the real SDK and Rust crypto against a homeserver
// kept in memory, close the client at each point where the work waits, and expect it to end there
// instead of calling into the closed machine (which throws "null pointer passed to rust").

type MachineMethod = (...args: unknown[]) => Promise<unknown>;

/** The parts of the SDK's Rust crypto backend these tests reach into. */
type CryptoInternals = {
  olmMachine: OlmMachine;
  perSessionBackupDownloader: {
    onDecryptionKeyMissingError(roomId: string, sessionId: string): void;
    queuedRequests: unknown[];
  };
};

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A started client whose server has a key backup that this device trusts (it holds the backup's
 * decryption key, as after a recovery key unlock). The server holds the client's backup checks
 * until `releaseCheck`, and every key upload until `answerUpload`. With `keyInInbox`, the
 * backup's key waits in the machine's inbox as the client starts, as when another session sent
 * it just before the last close.
 */
const startWithServerBackup = async ({ keyInInbox = false } = {}) => {
  const key = BackupDecryptionKey.createRandomKey();
  if (keyInInbox) {
    vi.spyOn(OlmMachine.prototype, 'getSecretsFromInbox').mockResolvedValue(
      new Set([key.toBase64()])
    );
  }
  const backupInfo = {
    version: '1',
    algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2',
    auth_data: { public_key: key.megolmV1PublicKey.publicKeyBase64 },
    count: 0,
    etag: '0',
  };
  let releaseCheck!: () => void;
  const checkHeld = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  let answerUpload!: (response: Response) => void;
  const uploadHeld = new Promise<Response>((resolve) => {
    answerUpload = resolve;
  });
  let checks = 0;
  let uploads = 0;
  let closed = false;
  const requestsAfterClose: string[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(String(input));
    if (closed) requestsAfterClose.push(`${init?.method ?? 'GET'} ${pathname}`);
    if (pathname.endsWith('/room_keys/version')) {
      checks += 1;
      await checkHeld;
      return json(backupInfo);
    }
    if (pathname.endsWith('/room_keys/keys')) {
      uploads += 1;
      return uploadHeld;
    }
    if (pathname.endsWith('/keys/upload')) return json({ one_time_key_counts: {} });
    if (pathname.endsWith('/keys/query')) return json({ device_keys: {} });
    return json({});
  };
  const logged: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]) =>
      logged.push(`${level} ${args.map(String).join(' ')}`);
  const logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: record('warn'),
    error: record('error'),
    getChild: () => logger,
  };
  const client: MatrixClient = createClient({
    baseUrl: 'https://matrix.example',
    userId: '@reader:example',
    deviceId: 'DEVICE',
    accessToken: 'token',
    store: new MemoryStore(),
    fetchFn,
    logger: logger as unknown as Logger,
  });
  await client.initRustCrypto({ useIndexedDB: false });
  await vi.waitFor(() => expect(checks).toBeGreaterThan(0));
  const crypto = client.getCrypto() as unknown as CryptoInternals;
  await crypto.olmMachine.saveBackupDecryptionKey(key, backupInfo.version);

  const close = () => {
    closed = true;
    closeClient(client);
  };
  /** Closes the client right after the machine's `method` answers, as an account switch can. */
  const closeAfter = (method: string) => {
    const methods = crypto.olmMachine as unknown as Record<string, MachineMethod>;
    const original = methods[method]!.bind(crypto.olmMachine);
    methods[method] = async (...args: unknown[]) => {
      const answer = await original(...args);
      close();
      return answer;
    };
  };
  return {
    client,
    crypto,
    logged,
    requestsAfterClose,
    releaseCheck,
    answerUpload,
    close,
    closeAfter,
    isClosed: () => closed,
    checks: () => checks,
    uploads: () => uploads,
  };
};

describe('closing a client during its key backup work', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
    vi.restoreAllMocks();
  });

  it.each(['verifyBackup', 'getBackupKeys'])(
    'ends the backup check without an uncaught error when the close comes during %s',
    async (method) => {
      const backup = await startWithServerBackup();
      backup.closeAfter(method);
      backup.releaseCheck();
      await pause(200);

      expect(backup.isClosed()).toBe(true);
      expect(rejections).toEqual([]);
    }
  );

  it('ends the key upload when the server refuses it after the close', async () => {
    // The upload loop starts after a random delay of up to 10 s.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const backup = await startWithServerBackup();
    // A room key this device does not have in the backup yet.
    const peer = await OlmMachine.initialize(new UserId('@peer:example'), new DeviceId('PEER'));
    await peer.shareRoomKey(new RoomId('!room:example'), [], new EncryptionSettings());
    await backup.client.getCrypto()!.importRoomKeysAsJson(await peer.exportRoomKeys(() => true));
    backup.releaseCheck();
    await vi.waitFor(() => expect(backup.uploads()).toBe(1));

    // The backup was replaced on another device while this upload waited for the server.
    backup.close();
    backup.answerUpload(json({ errcode: 'M_NOT_FOUND', error: 'Unknown backup version' }, 404));
    await pause(200);

    expect(backup.logged.filter((line) => line.includes('null pointer'))).toEqual([]);
    expect(backup.requestsAfterClose).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('ends a key download that waits for the backup check when the client closes', async () => {
    const backup = await startWithServerBackup();
    const downloader = backup.crypto.perSessionBackupDownloader;
    // A message whose key is missing: the download first waits for the server's backup check.
    downloader.onDecryptionKeyMissingError('!room:example', 'SESSION');
    backup.closeAfter('enableBackupV1');
    const methods = backup.crypto.olmMachine as unknown as Record<string, MachineMethod>;
    const isBackupEnabled = methods.isBackupEnabled!.bind(backup.crypto.olmMachine);
    let callsAfterClose = 0;
    methods.isBackupEnabled = () => {
      if (backup.isClosed()) {
        callsAfterClose += 1;
        // The download used to retry at once and for ever; this ends it so the test can report it.
        if (callsAfterClose >= 50) downloader.queuedRequests.length = 0;
      }
      return isBackupEnabled();
    };
    backup.releaseCheck();
    await pause(200);

    expect(backup.isClosed()).toBe(true);
    expect(callsAfterClose).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('ends the check of a backup key waiting in the inbox when the client closes first', async () => {
    const backup = await startWithServerBackup({ keyInInbox: true });
    // The backup check and the check of the waiting key both wait for the server.
    await vi.waitFor(() => expect(backup.checks()).toBe(2));
    backup.close();
    backup.releaseCheck();
    await pause(200);

    expect(backup.logged.filter((line) => line.includes('null pointer'))).toEqual([]);
    expect(rejections).toEqual([]);
  });
});
