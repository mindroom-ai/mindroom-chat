import type { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildEventSourceBundle,
  extractEventSummary,
  safeStringifyJson,
} from './eventSourceDocuments';

const makeMockEvent = (options: {
  event: Record<string, unknown>;
  encrypted?: boolean;
  effectiveEvent?: Record<string, unknown>;
  edit?: MatrixEvent;
}): MatrixEvent =>
  ({
    event: options.event,
    isEncrypted: () => Boolean(options.encrypted),
    getEffectiveEvent: () => options.effectiveEvent,
    replacingEvent: () => options.edit,
  } as unknown as MatrixEvent);

describe('buildEventSourceBundle', () => {
  it('returns a single event document for a plain unedited event', () => {
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
    expect(bundle.docs[0]?.kind).toBe('event');
    expect(bundle.docs[0]?.data).toEqual(raw);
    expect(JSON.parse(bundle.docs[0]?.rawJson ?? '')).toEqual(raw);
  });

  it('returns [decrypted, encrypted] for an encrypted event with a decrypted effective event', () => {
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
    expect(bundle.docs[0]?.data).toEqual(decryptedRaw);
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
  });

  it('returns [original, latestEdit] for a plain edited event', () => {
    const original = {
      event_id: '$evt_orig_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500003000,
      content: { msgtype: 'm.text', body: 'Temp is 21C' },
    };
    const edit = makeMockEvent({
      event: {
        event_id: '$evt_edit_1',
        type: 'm.room.message',
        sender: '@alex:example.org',
        origin_server_ts: 1731500009000,
        content: {
          msgtype: 'm.text',
          body: '* Temp is 22C',
          'm.new_content': { msgtype: 'm.text', body: 'Temp is 22C' },
        },
      },
    });

    const bundle = buildEventSourceBundle(makeMockEvent({ event: original, edit }));

    expect(bundle.isEdited).toBe(true);
    expect(bundle.isEncrypted).toBe(false);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['original', 'latestEdit']);
    expect(bundle.docs[0]?.data).toEqual(original);
    expect((bundle.docs[1]?.data as Record<string, unknown>).event_id).toBe('$evt_edit_1');
  });

  it('returns [original, latestEdit, encrypted] for an encrypted edited event', () => {
    const encryptedOriginal = {
      event_id: '$evt_enc_edit_orig',
      type: 'm.room.encrypted',
      sender: '@alex:example.org',
      origin_server_ts: 1731500010000,
      content: { ciphertext: 'orig-cipher' },
    };
    const decryptedOriginal = {
      event_id: '$evt_enc_edit_orig',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500010000,
      content: { msgtype: 'm.text', body: 'First reading' },
    };
    const decryptedEdit = {
      event_id: '$evt_enc_edit_2',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500020000,
      content: { msgtype: 'm.text', body: '* Revised reading' },
    };
    const edit = makeMockEvent({
      event: { event_id: '$evt_enc_edit_2', type: 'm.room.encrypted', content: {} },
      encrypted: true,
      effectiveEvent: decryptedEdit,
    });

    const bundle = buildEventSourceBundle(
      makeMockEvent({
        event: encryptedOriginal,
        encrypted: true,
        effectiveEvent: decryptedOriginal,
        edit,
      })
    );

    expect(bundle.isEdited).toBe(true);
    expect(bundle.isEncrypted).toBe(true);
    expect(bundle.docs.map((doc) => doc.kind)).toEqual(['original', 'latestEdit', 'encrypted']);
    expect(bundle.docs[0]?.data).toEqual(decryptedOriginal);
    expect(bundle.docs[1]?.data).toEqual(decryptedEdit);
    expect(bundle.docs[2]?.data).toEqual(encryptedOriginal);
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

describe('extractEventSummary', () => {
  it('extracts valid Matrix metadata fields and ignores malformed ones', () => {
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
