import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildEventSourceBundle,
  extractEventSummary,
  isValidTimestampMs,
  safeStringifyJson,
  sanitizeJsonValue,
} from './eventSourceDocuments';

const ROOM = '!greenhouse:example.org';
const SENDER = '@alex:example.org';

const makeEvent = (
  event_id: string,
  type: string,
  content: Record<string, unknown>,
  ts = 1731500000000
) =>
  new MatrixEvent({ event_id, room_id: ROOM, sender: SENDER, type, origin_server_ts: ts, content });

const decryptWith = (ev: MatrixEvent, clearContent: Record<string, unknown>, isRetry = false) =>
  ev.attemptDecryption(
    {
      decryptEvent: async () => ({ clearEvent: { type: 'm.room.message', content: clearContent } }),
    } as never,
    isRetry ? { isRetry: true } : undefined
  );

const failDecryption = (ev: MatrixEvent) =>
  ev.attemptDecryption({ decryptEvent: () => Promise.reject(new Error('withheld key')) } as never);

describe('buildEventSourceBundle', () => {
  it('builds plain unedited and edited bundles with matching rawAll', () => {
    const plain = makeEvent('$evt_1', 'm.room.message', { msgtype: 'm.text', body: 'Temp is 21C' });
    const unedited = buildEventSourceBundle(plain);
    expect(unedited).toMatchObject({ isEdited: false, isEncrypted: false });
    expect(unedited.docs.map((d) => d.kind)).toEqual(['event']);
    expect(unedited.docs[0].data).toEqual(plain.event);
    expect(unedited.rawAll).toBe(unedited.docs[0].rawJson);

    const edit = makeEvent('$evt_edit_1', 'm.room.message', {
      msgtype: 'm.text',
      body: '* Temp is 22C',
      'm.new_content': { msgtype: 'm.text', body: 'Temp is 22C' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_1' },
    });
    plain.makeReplaced(edit);

    const edited = buildEventSourceBundle(plain);
    expect(edited).toMatchObject({ isEdited: true, isEncrypted: false });
    expect(edited.docs.map((d) => d.kind)).toEqual(['original', 'latestEdit']);
    expect(edited.docs[0].data).toEqual(plain.event);
    expect((edited.docs[1]?.data as Record<string, unknown>).event_id).toBe('$evt_edit_1');
    expect(edited.rawAll).toBe(
      `${JSON.stringify(plain.event, null, 2)}\n\n${JSON.stringify(edit.event, null, 2)}`
    );
  });

  it('handles encrypted pending, failed, and decrypted events while keeping the { encrypted, decrypted } rawAll pair', async () => {
    const wireContent = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'locked-cipher' };
    const ev = makeEvent('$evt_enc_1', 'm.room.encrypted', structuredClone(wireContent));
    const wire = structuredClone(ev.event);

    // Pending decryption: single [encrypted] tab, rawAll keeps { encrypted, decrypted } pair.
    const locked = buildEventSourceBundle(ev);
    expect(locked.isEncrypted).toBe(true);
    expect(locked.docs.map((d) => d.kind)).toEqual(['encrypted']);
    expect(JSON.parse(locked.rawAll)).toEqual({ encrypted: wire, decrypted: wire });
    expect(Object.keys(JSON.parse(locked.rawAll) as object)).toEqual(['encrypted', 'decrypted']);

    // Failed decryption: [decryptionError, encrypted], rawAll keeps pair.
    await failDecryption(ev);
    const failed = buildEventSourceBundle(ev);
    expect(failed.docs.map((d) => d.kind)).toEqual(['decryptionError', 'encrypted']);
    expect(JSON.parse(failed.rawAll)).toEqual({
      encrypted: wire,
      decrypted: failed.docs[0].data,
    });

    // Retry succeeds: [decrypted, encrypted].
    await decryptWith(ev, { msgtype: 'm.text', body: 'Vent opened at dawn.' }, true);
    const unlocked = buildEventSourceBundle(ev);
    expect(unlocked.docs.map((d) => d.kind)).toEqual(['decrypted', 'encrypted']);
    expect(JSON.parse(unlocked.rawAll)).toEqual({
      encrypted: wire,
      decrypted: {
        ...wire,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'Vent opened at dawn.' },
      },
    });
  });

  it('keeps pre-edit plaintext and wire-only m.relates_to in Original for edited encrypted thread replies', async () => {
    const threadRelation = {
      rel_type: 'm.thread',
      event_id: '$evt_thread_root',
      is_falling_back: true,
      'm.in_reply_to': { event_id: '$evt_thread_root' },
    };
    const reply = makeEvent('$evt_enc_reply', 'm.room.encrypted', {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'reply-cipher',
      device_id: 'DEVICEDEMO',
      sender_key: 'sender-key-demo',
      session_id: 'session-demo',
      'm.relates_to': threadRelation,
    });
    await decryptWith(reply, { msgtype: 'm.text', body: 'Reply: humidity is 61%' });

    const beforeEdit = buildEventSourceBundle(reply);
    const decryptedData = beforeEdit.docs[0].data as Record<string, unknown>;
    expect(decryptedData.content).toEqual({
      msgtype: 'm.text',
      body: 'Reply: humidity is 61%',
      'm.relates_to': threadRelation,
    });

    const edit = makeEvent('$evt_enc_reply_edit', 'm.room.encrypted', {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'reply-edit-cipher',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_enc_reply' },
    });
    await decryptWith(edit, {
      msgtype: 'm.text',
      body: '* Reply: humidity is 64%',
      'm.new_content': { msgtype: 'm.text', body: 'Reply: humidity is 64%' },
    });
    reply.makeReplaced(edit);

    // matrix-js-sdk replaces getEffectiveEvent().content with m.new_content.
    expect(reply.getEffectiveEvent().content).toMatchObject({ body: 'Reply: humidity is 64%' });

    const afterEdit = buildEventSourceBundle(reply);
    expect(afterEdit).toMatchObject({ isEdited: true, isEncrypted: true });
    expect(afterEdit.docs.map((d) => d.kind)).toEqual(['original', 'latestEdit', 'encrypted']);
    expect(afterEdit.docs[0].data).toEqual(decryptedData);
    expect(afterEdit.docs[0].rawJson).toBe(beforeEdit.docs[0].rawJson);
    expect(afterEdit.docs[0].rawJson).not.toContain('ciphertext');
    expect(afterEdit.docs[0].rawJson).not.toContain('Reply: humidity is 64%');

    const [pairRaw, editRaw] = afterEdit.rawAll.split('\n\n');
    expect(JSON.parse(pairRaw ?? '')).toEqual({
      encrypted: afterEdit.docs[2]?.data,
      decrypted: decryptedData,
    });
    expect(JSON.parse(editRaw ?? '')).toEqual(afterEdit.docs[1]?.data);
  });

  it('never shows ciphertext under Original when a bundled edit arrives before the original decrypts', async () => {
    const pending = makeEvent('$evt_pending_orig', 'm.room.encrypted', {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'pending-cipher',
    });
    const wire = structuredClone(pending.event);
    const edit = makeEvent('$evt_pending_edit', 'm.room.message', {
      msgtype: 'm.text',
      body: '* Drip line flushed twice',
      'm.new_content': { msgtype: 'm.text', body: 'Drip line flushed twice' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_pending_orig' },
    });
    pending.makeReplaced(edit);

    const pendingBundle = buildEventSourceBundle(pending);
    expect(pendingBundle.docs.map((d) => d.kind)).toEqual(['encrypted', 'latestEdit']);
    expect(pendingBundle.docs[0].data).toEqual(wire);

    await failDecryption(pending);
    const failedBundle = buildEventSourceBundle(pending);
    expect(failedBundle.docs.map((d) => d.kind)).toEqual([
      'decryptionError',
      'encrypted',
      'latestEdit',
    ]);
    expect(
      ((failedBundle.docs[0].data as Record<string, unknown>).content as Record<string, unknown>)
        .msgtype
    ).toBe('m.bad.encrypted');
    expect(failedBundle.docs[0].rawJson).not.toContain('Drip line flushed twice');

    await decryptWith(pending, { msgtype: 'm.text', body: 'Drip line flushed once' }, true);
    const decryptedBundle = buildEventSourceBundle(pending);
    expect(decryptedBundle.docs.map((d) => d.kind)).toEqual([
      'original',
      'latestEdit',
      'encrypted',
    ]);
    expect((decryptedBundle.docs[0].data as Record<string, unknown>).content).toEqual({
      msgtype: 'm.text',
      body: 'Drip line flushed once',
    });
  });

  it('preserves __proto__, constructor, and hasOwnProperty with null prototypes across data, rawJson, and rawAll', () => {
    const parsed = JSON.parse(
      '{"event_id":"$evt_proto","type":"m.room.message","content":{"body":"hi","__proto__":{"hidden":"payload"},"constructor":"c","hasOwnProperty":"h"}}'
    ) as Record<string, unknown>;
    const bundle = buildEventSourceBundle({
      event: parsed,
      isEncrypted: () => false,
    } as unknown as MatrixEvent);
    const doc = bundle.docs[0];
    const content = (doc.data as Record<string, unknown>).content as Record<string, unknown>;

    expect(Object.getPrototypeOf(doc.data)).toBeNull();
    expect(Object.getPrototypeOf(content)).toBeNull();
    expect(Object.keys(content)).toEqual(['body', '__proto__', 'constructor', 'hasOwnProperty']);
    expect(content['__proto__']).toEqual({ hidden: 'payload' });
    expect(doc.rawJson).toContain('"__proto__": {\n      "hidden": "payload"\n    }');
    expect(bundle.rawAll).toBe(doc.rawJson);
  });
});

describe('safeStringifyJson and extractEventSummary', () => {
  it('handles cycles, BigInt, shared objects, and sparse arrays without throwing', () => {
    const shared = { sensor: 'north-bed' };
    const cyclic: Record<string, unknown> = {
      a: shared,
      b: shared,
      big: BigInt('90071992547409931234'),
    };
    cyclic.self = cyclic;

    expect(JSON.parse(safeStringifyJson(cyclic))).toEqual({
      a: shared,
      b: shared,
      big: '90071992547409931234',
      self: '[Circular]',
    });

    const readings: unknown[] = [];
    readings[0] = 18;
    readings[3] = 21;
    const sanitized = sanitizeJsonValue({ readings }) as { readings: unknown[] };
    expect(sanitized.readings).toEqual([18, null, null, 21]);
    expect(Object.keys(sanitized.readings)).toEqual(['0', '1', '2', '3']);
  });

  it('extracts valid Matrix metadata, keeps out-of-range finite timestamps, and ignores malformed inputs', () => {
    expect(
      extractEventSummary({
        event_id: '$evt_1',
        type: 'm.room.message',
        sender: SENDER,
        origin_server_ts: 1731500000000,
      })
    ).toEqual({
      eventId: '$evt_1',
      type: 'm.room.message',
      sender: SENDER,
      timestamp: 1731500000000,
    });

    expect(extractEventSummary({ event_id: '$evt_far', origin_server_ts: 9e15 })).toEqual({
      eventId: '$evt_far',
      type: undefined,
      sender: undefined,
      timestamp: 9e15,
    });
    expect(isValidTimestampMs(9e15)).toBe(false);
    expect(isValidTimestampMs(1731500000000)).toBe(true);

    expect(
      extractEventSummary({ event_id: '', type: 123, sender: null, origin_server_ts: -5 })
    ).toEqual({
      eventId: undefined,
      type: undefined,
      sender: undefined,
      timestamp: undefined,
    });
    expect(extractEventSummary(null)).toEqual({});
    expect(extractEventSummary(['not-an-object'])).toEqual({});
  });
});
