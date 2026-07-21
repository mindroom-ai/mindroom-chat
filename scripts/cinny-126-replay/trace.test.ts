import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  parsePrivateTraceManifest,
  parseVerifiedPrivateTraceManifest,
  validateExactTrace,
  type TraceEvent,
} from './trace';

const fingerprint = { length: 10, sha256: 'a'.repeat(64) };
const validManifest = {
  schemaVersion: 1,
  artifactHashes: {
    'incident-window-all-events.json': 'b'.repeat(64),
    'edit-events-full.json': 'c'.repeat(64),
    'incident-core-events.json': 'd'.repeat(64),
  },
  eventIds: {
    room: '!private-room:example.org',
    threadRoot: '$private-root',
    voice: '$private-voice',
    transcription: '$private-transcription',
    placeholder: '$private-placeholder',
    finalEdit: '$private-final-edit',
    summary: '$private-summary',
    tags: ['$private-tag-1', '$private-tag-2'],
  },
  expectedFingerprints: {
    compactCard: fingerprint,
    effectiveBody: fingerprint,
    globalThreads: fingerprint,
    overviewTags: fingerprint,
    presentation: fingerprint,
  },
  senders: {
    user: '@private-user:example.org',
    router: '@private-router:example.org',
    agent: '@private-agent:example.org',
  },
};

const makeTraceEvent = (
  eventId: string,
  sender: string,
  originServerTs: number,
  content: Record<string, unknown>,
  overrides: Partial<TraceEvent> = {}
): TraceEvent => ({
  content,
  event_id: eventId,
  origin_server_ts: originServerTs,
  room_id: validManifest.eventIds.room,
  sender,
  type: 'm.room.message',
  ...overrides,
});

const makeValidTrace = () => {
  const manifest = parsePrivateTraceManifest(validManifest);
  const threadRelation = {
    event_id: manifest.eventIds.threadRoot,
    rel_type: 'm.thread',
  };
  const transcriptionTs = 1000;
  const placeholderTs = transcriptionTs + 254;
  const editDelays = [
    160, 777, 158, 782, 162, 788, 944, 1983, 166, 164, 164, 1302, 174, 1236, 316, 188,
  ];
  const editTimestamps = [placeholderTs + 14789];
  editDelays.forEach((delay) => {
    editTimestamps.push(editTimestamps.at(-1)! + delay);
  });
  const edits = editTimestamps.map((timestamp, index) => {
    const final = index === editTimestamps.length - 1;
    const body = final ? 'x'.repeat(1466) : `stream-${index + 1}`;
    return makeTraceEvent(
      final ? manifest.eventIds.finalEdit : `$private-edit-${index + 1}`,
      manifest.senders.agent,
      timestamp,
      {
        body: `* ${body}`,
        'm.new_content': {
          body,
          'io.mindroom.stream_status': final ? 'completed' : 'streaming',
          msgtype: final ? 'm.text' : 'm.notice',
        },
        'm.relates_to': {
          event_id: manifest.eventIds.placeholder,
          rel_type: 'm.replace',
        },
        msgtype: final ? 'm.text' : 'm.notice',
      }
    );
  });
  const finalTs = editTimestamps.at(-1)!;
  return {
    artifactDir: '/private-artifacts',
    artifactHashes: manifest.artifactHashes,
    ids: manifest.eventIds,
    senders: manifest.senders,
    expectedFingerprints: manifest.expectedFingerprints,
    voice: makeTraceEvent(manifest.eventIds.voice, manifest.senders.user, 0, {
      body: 'private voice',
      'm.relates_to': threadRelation,
      msgtype: 'm.audio',
    }),
    transcription: makeTraceEvent(
      manifest.eventIds.transcription,
      manifest.senders.router,
      transcriptionTs,
      { body: 'private transcription', 'm.relates_to': threadRelation, msgtype: 'm.text' }
    ),
    placeholder: makeTraceEvent(
      manifest.eventIds.placeholder,
      manifest.senders.agent,
      placeholderTs,
      { body: 'private placeholder', 'm.relates_to': threadRelation, msgtype: 'm.text' }
    ),
    edits,
    tags: manifest.eventIds.tags.map((eventId, index) =>
      makeTraceEvent(
        eventId,
        manifest.senders.agent,
        finalTs + index + 1,
        {},
        {
          state_key: JSON.stringify([manifest.eventIds.threadRoot, `private-tag-${index + 1}`]),
          type: 'com.mindroom.thread.tags',
        }
      )
    ),
    summary: makeTraceEvent(manifest.eventIds.summary, manifest.senders.agent, finalTs + 3, {
      body: 'private summary',
      'm.relates_to': {
        ...threadRelation,
        'm.in_reply_to': { event_id: manifest.eventIds.finalEdit },
      },
      msgtype: 'm.notice',
    }),
  };
};

describe('CINNY-126 private trace manifest', () => {
  it('accepts the strict private manifest shape', () => {
    expect(parsePrivateTraceManifest(validManifest)).toEqual(validManifest);
  });

  it('rejects missing, duplicate, malformed, and unexpected private selectors', () => {
    expect(() =>
      parsePrivateTraceManifest({
        ...validManifest,
        eventIds: { ...validManifest.eventIds, tags: ['$only-one'] },
      })
    ).toThrow('eventIds');
    expect(() =>
      parsePrivateTraceManifest({
        ...validManifest,
        eventIds: {
          ...validManifest.eventIds,
          tags: [validManifest.eventIds.tags[0], validManifest.eventIds.tags[0]],
        },
      })
    ).toThrow('valid and distinct');
    expect(() =>
      parsePrivateTraceManifest({
        ...validManifest,
        eventIds: { ...validManifest.eventIds, placeholder: 'not-an-event-id' },
      })
    ).toThrow('valid and distinct');
    expect(() =>
      parsePrivateTraceManifest({
        ...validManifest,
        senders: { ...validManifest.senders, router: validManifest.senders.user },
      })
    ).toThrow('senders must be distinct');
    expect(() => parsePrivateTraceManifest({ ...validManifest, privateNote: 'nope' })).toThrow(
      'unexpected fields'
    );
  });

  it('requires a trusted manifest digest and rejects any byte change', () => {
    const bytes = Buffer.from(JSON.stringify(validManifest));
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    expect(parseVerifiedPrivateTraceManifest(bytes, sha256)).toEqual(validManifest);
    expect(() =>
      parseVerifiedPrivateTraceManifest(Buffer.concat([bytes, Buffer.from(' ')]), sha256)
    ).toThrow('does not match');
    expect(() => parseVerifiedPrivateTraceManifest(bytes, 'not-a-digest')).toThrow(
      'SHA-256 is invalid'
    );
  });

  it('validates unique same-room replay topology and source kinds', () => {
    expect(validateExactTrace(makeValidTrace()).replayEvents).toHaveLength(23);

    const duplicateEvent = makeValidTrace();
    duplicateEvent.edits[1].event_id = duplicateEvent.edits[0].event_id;
    expect(() => validateExactTrace(duplicateEvent)).toThrow('valid and distinct');

    const wrongRoom = makeValidTrace();
    wrongRoom.summary.room_id = '!other-room:example.org';
    expect(() => validateExactTrace(wrongRoom)).toThrow('room changed');

    const wrongKind = makeValidTrace();
    wrongKind.voice.type = 'com.example.private';
    expect(() => validateExactTrace(wrongKind)).toThrow('voice kind changed');

    const stateEdit = makeValidTrace();
    stateEdit.edits[0].state_key = 'unexpected';
    expect(() => validateExactTrace(stateEdit)).toThrow('edit 1 kind changed');

    const wrongSummarySender = makeValidTrace();
    wrongSummarySender.summary.sender = wrongSummarySender.senders.user;
    expect(() => validateExactTrace(wrongSummarySender)).toThrow('summary sender changed');

    const extraTagSelector = makeValidTrace();
    extraTagSelector.tags[0].state_key = JSON.stringify([
      extraTagSelector.ids.threadRoot,
      'private-tag',
      'extra',
    ]);
    expect(() => validateExactTrace(extraTagSelector)).toThrow('no longer targets');

    const emptyTagSelector = makeValidTrace();
    emptyTagSelector.tags[0].state_key = JSON.stringify([emptyTagSelector.ids.threadRoot, '']);
    expect(() => validateExactTrace(emptyTagSelector)).toThrow('no longer targets');
  });

  it('keeps incident selectors, hashes, and fallback paths out of committed loader source', async () => {
    const source = await readFile(new URL('./trace.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('DEFAULT_ARTIFACT_DIR');
    expect(source).not.toContain('ARTIFACT_HASHES =');
    expect(source).not.toMatch(/\/home\/[^'"\s]+/);
    expect(source).toContain('set CINNY_126_ARTIFACT_DIR');
    expect(source).toContain('set CINNY_126_MANIFEST_SHA256');
  });

  it('keeps arbitrary rejection text out of replay diagnostics', async () => {
    const source = await readFile(new URL('./offline.ts', import.meta.url), 'utf8');

    expect(source).toContain("emitDiagnostic('unhandled-rejection', { occurred: true })");
    expect(source).not.toMatch(/reason instanceof Error|unhandledRejections\.push|\{ message \}/);
  });
});
