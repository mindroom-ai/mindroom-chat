import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildEventSourceBundle,
  extractEventSummary,
  isValidTimestampMs,
  safeStringifyJson,
} from './eventSourceDocuments';

const makeMockEvent = (options: {
  event: Record<string, unknown>;
  encrypted?: boolean;
  effectiveEvent?: Record<string, unknown>;
  originalContent?: Record<string, unknown>;
  decryptionFailure?: boolean;
  edit?: MatrixEvent;
}): MatrixEvent =>
  ({
    event: options.event,
    isEncrypted: () => Boolean(options.encrypted),
    isDecryptionFailure: () => Boolean(options.decryptionFailure),
    getEffectiveEvent: () => options.effectiveEvent,
    ...(options.originalContent !== undefined
      ? { getOriginalContent: () => options.originalContent }
      : {}),
    replacingEvent: () => options.edit,
  } as unknown as MatrixEvent);

describe('buildEventSourceBundle', () => {
  it('returns a single event document for a plain unedited event with matching rawAll', () => {
    const raw = {
      event_id: '$evt_demo_1',
      room_id: '!garden:example.org',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500000000,
      content: { msgtype: 'm.text', body: 'Greenhouse soil moisture is 58%.' },
    };

    const bundle = buildEventSourceBundle(makeMockEvent({ event: raw }));

    expect(bundle.isEdited).toBe(false);
    expect(bundle.isEncrypted).toBe(false);
    expect(bundle.docs).toHaveLength(1);
    expect(bundle.docs[0].kind).toBe('event');
    expect(bundle.docs[0].data).toEqual(raw);
    expect(JSON.parse(bundle.docs[0].rawJson)).toEqual(raw);
    expect(bundle.rawAll).toBe(bundle.docs[0].rawJson);
  });

  it('returns [decrypted, encrypted] for an encrypted event with origin/main rawAll parity', () => {
    const encryptedRaw = {
      event_id: '$evt_enc_1',
      type: 'm.room.encrypted',
      sender: '@alex:example.org',
      origin_server_ts: 1731500001000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'AwgAEk...' },
    };
    const decryptedRaw = {
      event_id: '$evt_enc_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500001000,
      content: { msgtype: 'm.text', body: 'Pump cycle started.' },
    };

    const bundle = buildEventSourceBundle(
      makeMockEvent({
        event: encryptedRaw,
        encrypted: true,
        effectiveEvent: decryptedRaw,
      })
    );

    expect(bundle.isEncrypted).toBe(true);
    expect(bundle.isEdited).toBe(false);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['decrypted', 'encrypted']);
    expect(bundle.docs[0].data).toEqual(decryptedRaw);
    expect(bundle.docs[1]?.data).toEqual(encryptedRaw);
    expect(JSON.parse(bundle.rawAll)).toEqual({
      encrypted: encryptedRaw,
      decrypted: decryptedRaw,
    });
  });

  it('labels failed decryption honestly as decryptionError instead of decrypted', () => {
    const encryptedRaw = {
      event_id: '$evt_bad_dec_1',
      type: 'm.room.encrypted',
      sender: '@alex:example.org',
      origin_server_ts: 1731500001500,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'Unreadable...' },
    };
    const badDecrypted = {
      event_id: '$evt_bad_dec_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500001500,
      content: {
        msgtype: 'm.bad.encrypted',
        body: '** Unable to decrypt: The sender has not sent us the key **',
      },
    };

    const bundle = buildEventSourceBundle(
      makeMockEvent({
        event: encryptedRaw,
        encrypted: true,
        decryptionFailure: true,
        effectiveEvent: badDecrypted,
      })
    );

    expect(bundle.isEncrypted).toBe(true);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['decryptionError', 'encrypted']);
    expect(bundle.docs[0].data).toEqual(badDecrypted);
    expect(bundle.docs[1]?.data).toEqual(encryptedRaw);
  });

  it('returns only [encrypted] when an encrypted event has no distinct decrypted payload', () => {
    const encryptedRaw = {
      event_id: '$evt_enc_2',
      type: 'm.room.encrypted',
      sender: '@alex:example.org',
      origin_server_ts: 1731500002000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'Locked...' },
    };

    const bundle = buildEventSourceBundle(
      makeMockEvent({
        event: encryptedRaw,
        encrypted: true,
        effectiveEvent: { ...encryptedRaw },
      })
    );

    expect(bundle.isEncrypted).toBe(true);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['encrypted']);
    expect(bundle.rawAll).toBe(bundle.docs[0].rawJson);
  });

  it('returns [original, latestEdit] for a plain edited event with combined rawAll', () => {
    const original = {
      event_id: '$evt_orig_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500003000,
      content: { msgtype: 'm.text', body: 'Temp is 21C' },
    };
    const editRaw = {
      event_id: '$evt_edit_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500009000,
      content: {
        msgtype: 'm.text',
        body: '* Temp is 22C',
        'm.new_content': { msgtype: 'm.text', body: 'Temp is 22C' },
      },
    };
    const edit = makeMockEvent({ event: editRaw });

    const bundle = buildEventSourceBundle(makeMockEvent({ event: original, edit }));

    expect(bundle.isEdited).toBe(true);
    expect(bundle.isEncrypted).toBe(false);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['original', 'latestEdit']);
    expect(bundle.docs[0].data).toEqual(original);
    expect((bundle.docs[1]?.data as Record<string, unknown>).event_id).toBe('$evt_edit_1');
    expect(bundle.rawAll).toBe(
      `${JSON.stringify(original, null, 2)}\n\n${JSON.stringify(editRaw, null, 2)}`
    );
  });

  it('keeps the true original decrypted plaintext on real MatrixEvent instances after makeReplaced()', async () => {
    const originalEvent = new MatrixEvent({
      event_id: '$evt_real_enc_orig',
      room_id: '!greenhouse:example.org',
      sender: '@alex:example.org',
      type: 'm.room.encrypted',
      origin_server_ts: 1731500010000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'orig-cipher-payload' },
    });
    await originalEvent.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: {
          type: 'm.room.message',
          content: { msgtype: 'm.text', body: 'Original valve reading: 18C' },
        },
      }),
    } as never);

    const editEvent = new MatrixEvent({
      event_id: '$evt_real_enc_edit',
      room_id: '!greenhouse:example.org',
      sender: '@alex:example.org',
      type: 'm.room.encrypted',
      origin_server_ts: 1731500020000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'edit-cipher-payload' },
    });
    await editEvent.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: {
          type: 'm.room.message',
          content: {
            msgtype: 'm.text',
            body: '* Revised valve reading: 24C',
            'm.new_content': { msgtype: 'm.text', body: 'Revised valve reading: 24C' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_real_enc_orig' },
          },
        },
      }),
    } as never);

    originalEvent.makeReplaced(editEvent);

    // Confirm matrix-js-sdk itself replaces getEffectiveEvent().content with the edited text.
    expect(originalEvent.getEffectiveEvent().content).toMatchObject({
      body: 'Revised valve reading: 24C',
    });

    const bundle = buildEventSourceBundle(originalEvent);
    expect(bundle.isEdited).toBe(true);
    expect(bundle.isEncrypted).toBe(true);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['original', 'latestEdit', 'encrypted']);

    const originalDocData = bundle.docs[0].data as Record<string, unknown>;
    const editDocData = bundle.docs[1]?.data as Record<string, unknown>;
    const encryptedDocData = bundle.docs[2]?.data as Record<string, unknown>;

    expect(originalDocData.event_id).toBe('$evt_real_enc_orig');
    expect(originalDocData.type).toBe('m.room.message');
    expect(originalDocData.content).toEqual({
      msgtype: 'm.text',
      body: 'Original valve reading: 18C',
    });
    expect(editDocData.event_id).toBe('$evt_real_enc_edit');
    expect((editDocData.content as Record<string, unknown>).body).toBe(
      '* Revised valve reading: 24C'
    );
    expect(encryptedDocData.type).toBe('m.room.encrypted');

    const [encryptedPairRaw, editRawPart] = bundle.rawAll.split('\n\n');
    expect(JSON.parse(encryptedPairRaw ?? '')).toEqual({
      encrypted: encryptedDocData,
      decrypted: originalDocData,
    });
    expect(JSON.parse(editRawPart ?? '')).toEqual(editDocData);
  });

  it('preserves __proto__, constructor, and hasOwnProperty keys identically in data, rawJson, and rawAll', () => {
    const parsed = JSON.parse(
      '{"event_id":"$evt_proto_1","type":"m.room.message","content":{"body":"hi","__proto__":{"hidden":"payload"},"constructor":"c","hasOwnProperty":"h"}}'
    ) as Record<string, unknown>;

    const bundle = buildEventSourceBundle(makeMockEvent({ event: parsed }));
    const doc = bundle.docs[0];
    const content = (doc.data as Record<string, unknown>).content as Record<string, unknown>;

    expect(Object.getPrototypeOf(doc.data)).toBeNull();
    expect(Object.getPrototypeOf(content)).toBeNull();
    expect(Object.keys(content)).toEqual(['body', '__proto__', 'constructor', 'hasOwnProperty']);
    expect(content['__proto__']).toEqual({ hidden: 'payload' });
    expect(content['constructor']).toBe('c');
    expect(content['hasOwnProperty']).toBe('h');

    expect(doc.rawJson).toContain('"__proto__": {\n      "hidden": "payload"\n    }');
    expect(doc.rawJson).toContain('"constructor": "c"');
    expect(doc.rawJson).toContain('"hasOwnProperty": "h"');
    expect(bundle.rawAll).toBe(doc.rawJson);
  });
});

describe('safeStringifyJson', () => {
  it('handles circular references, BigInt values, and shared non-circular objects without throwing', () => {
    const shared = { sensor: 'north-bed' };
    const cyclic: Record<string, unknown> = {
      a: shared,
      b: shared,
      big: BigInt('90071992547409931234'),
    };
    cyclic.self = cyclic;

    const json = safeStringifyJson(cyclic);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.a).toEqual(shared);
    expect(parsed.b).toEqual(shared);
    expect(parsed.big).toBe('90071992547409931234');
    expect(parsed.self).toBe('[Circular]');
  });
});

describe('extractEventSummary and isValidTimestampMs', () => {
  it('extracts valid Matrix metadata fields, keeps out-of-range finite timestamps, and ignores malformed ones', () => {
    expect(
      extractEventSummary({
        event_id: '$evt_demo_1',
        type: 'm.room.message',
        sender: '@alex:example.org',
        origin_server_ts: 1731500000000,
      })
    ).toEqual({
      eventId: '$evt_demo_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      timestamp: 1731500000000,
    });

    expect(
      extractEventSummary({
        event_id: '$evt_far_future',
        origin_server_ts: 9e15,
      })
    ).toEqual({
      eventId: '$evt_far_future',
      type: undefined,
      sender: undefined,
      timestamp: 9e15,
    });
    expect(isValidTimestampMs(9e15)).toBe(false);
    expect(isValidTimestampMs(1731500000000)).toBe(true);

    expect(
      extractEventSummary({
        event_id: '',
        type: 123,
        sender: null,
        origin_server_ts: -5,
      })
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
