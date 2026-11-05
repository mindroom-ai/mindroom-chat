import { createDecipheriv, createHmac, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RoomKeyExportError, decryptRoomKeyExport, encryptRoomKeyExport } from './roomKeyExport';
import { defined } from '../../../test/utils/defined';

const SESSIONS = JSON.stringify([
  {
    algorithm: 'm.megolm.v1.aes-sha2',
    room_id: '!room:example.org',
    sender_key: 'curve25519 key',
    session_id: 'session',
    session_key: 'AQAAAA…',
    sender_claimed_keys: { ed25519: 'ed25519 key' },
    forwarding_curve25519_key_chain: [],
  },
]);
// Few rounds keep the test fast; files written by the app use the default.
const ROUNDS = 1000;

/** Reads the file the way the spec lays it out, with Node's own primitives. */
const decryptBySpec = (file: string, passphrase: string): string => {
  const base64 = file
    .split('\n')
    .filter((line) => line && !line.startsWith('-----'))
    .join('');
  const body = Buffer.from(base64, 'base64');
  expect(body[0]).toBe(1);
  const salt = body.subarray(1, 17);
  const iv = body.subarray(17, 33);
  const rounds = body.readUInt32BE(33);
  const ciphertext = body.subarray(37, body.length - 32);
  const key = pbkdf2Sync(passphrase, salt, rounds, 64, 'sha512');
  const mac = createHmac('sha256', key.subarray(32))
    .update(body.subarray(0, body.length - 32))
    .digest();
  expect(mac.equals(body.subarray(body.length - 32))).toBe(true);
  const decipher = createDecipheriv('aes-256-ctr', key.subarray(0, 32), iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

describe('room key export files', () => {
  it('writes the armored format of the spec', async () => {
    const file = await encryptRoomKeyExport(SESSIONS, 'correct horse', ROUNDS);
    const lines = file.trim().split('\n');
    expect(lines[0]).toBe('-----BEGIN MEGOLM SESSION DATA-----');
    expect(lines.at(-1)).toBe('-----END MEGOLM SESSION DATA-----');
    expect(decryptBySpec(file, 'correct horse')).toBe(SESSIONS);
  });

  it('keeps the top bit of the block counter clear', async () => {
    const file = await encryptRoomKeyExport(SESSIONS, 'pass', ROUNDS);
    const body = Buffer.from(file.split('\n').slice(1, -2).join(''), 'base64');
    // eslint-disable-next-line no-bitwise
    expect(defined(body[17 + 8], 'the counter byte') & 0x80).toBe(0);
  });

  it('reads back what it wrote, also with CRLF line ends', async () => {
    const file = await encryptRoomKeyExport(SESSIONS, 'pass', ROUNDS);
    await expect(decryptRoomKeyExport(file, 'pass')).resolves.toBe(SESSIONS);
    await expect(decryptRoomKeyExport(file.replace(/\n/g, '\r\n'), 'pass')).resolves.toBe(SESSIONS);
  });

  it('rejects a wrong passphrase and a tampered file', async () => {
    const file = await encryptRoomKeyExport(SESSIONS, 'pass', ROUNDS);
    await expect(decryptRoomKeyExport(file, 'wrong')).rejects.toEqual(
      new RoomKeyExportError('passphrase')
    );
    const lines = file.split('\n');
    const line = defined(lines[2], 'the first line of the body');
    const flipped = line.startsWith('A') ? `B${line.slice(1)}` : `A${line.slice(1)}`;
    const tampered = [...lines.slice(0, 2), flipped, ...lines.slice(3)].join('\n');
    await expect(decryptRoomKeyExport(tampered, 'pass')).rejects.toBeInstanceOf(RoomKeyExportError);
  });

  it('rejects a file that asks for no rounds or for more than ten million', async () => {
    const file = await encryptRoomKeyExport(SESSIONS, 'pass', ROUNDS);
    const lines = file.trim().split('\n');
    const body = Buffer.from(lines.slice(1, -1).join(''), 'base64');
    const withRounds = (rounds: number) => {
      const copy = Buffer.from(body);
      copy.writeUInt32BE(rounds, 33);
      return [lines[0], copy.toString('base64'), lines[lines.length - 1]].join('\n');
    };
    // Read before the passphrase can be checked: deriving 2^32 - 1 rounds would take hours.
    for (const rounds of [0, 10_000_001, 0xffffffff]) {
      await expect(decryptRoomKeyExport(withRounds(rounds), 'pass')).rejects.toEqual(
        new RoomKeyExportError('format')
      );
    }
  });

  it('rejects text that is not a key export', async () => {
    await expect(decryptRoomKeyExport('hello', 'pass')).rejects.toEqual(
      new RoomKeyExportError('format')
    );
    await expect(
      decryptRoomKeyExport(
        '-----BEGIN MEGOLM SESSION DATA-----\nAgAA\n-----END MEGOLM SESSION DATA-----',
        'pass'
      )
    ).rejects.toEqual(new RoomKeyExportError('format'));
  });
});
