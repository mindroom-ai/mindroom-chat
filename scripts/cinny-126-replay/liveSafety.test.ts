import { describe, expect, it } from 'vitest';

import {
  assertNoIncidentMediaReferences,
  collectIncidentAttachmentIds,
  parseReplacementAttachmentIds,
  rewriteReplayAttachmentIds,
  validateLiveReplayMedia,
} from './liveSafety';

const incidentAudioMxc = 'mxc://mindroom.chat/incident-voice';
const incidentAttachmentIds = ['incident-a', 'incident-b', 'incident-c'];
const replacementAttachmentIds = ['test-a', 'test-b', 'test-c'];

describe('CINNY-126 live replay media safety', () => {
  it.each([
    [undefined],
    ['not-json'],
    ['{}'],
    ['["one","two"]'],
    ['["one","two",3]'],
    ['["one","two",""]'],
    ['["same","same","third"]'],
  ])('rejects malformed replacement attachment input %#', (raw) => {
    expect(() => parseReplacementAttachmentIds(raw)).toThrow('CINNY_126_TEST_ATTACHMENT_IDS');
  });

  it('rejects the verified incident voice MXC', () => {
    expect(() =>
      validateLiveReplayMedia({
        incidentAttachmentIds,
        incidentAudioMxc,
        replacementAttachmentIds,
        testAudioMxc: incidentAudioMxc,
      })
    ).toThrow('incident voice MXC');
  });

  it.each(incidentAttachmentIds)(
    'rejects verified incident attachment ID %s',
    (incidentAttachmentId) => {
      expect(() =>
        validateLiveReplayMedia({
          incidentAttachmentIds,
          incidentAudioMxc,
          replacementAttachmentIds: [incidentAttachmentId, 'test-b', 'test-c'],
          testAudioMxc: 'mxc://mindroom.chat/test-voice',
        })
      ).toThrow('Incident attachment IDs');
    }
  );

  it('rewrites every verified attachment and fails closed for an unknown ID', () => {
    const { attachmentMap } = validateLiveReplayMedia({
      incidentAttachmentIds,
      incidentAudioMxc,
      replacementAttachmentIds,
      testAudioMxc: 'mxc://mindroom.chat/test-voice',
    });

    expect(rewriteReplayAttachmentIds(incidentAttachmentIds, attachmentMap)).toEqual(
      replacementAttachmentIds
    );
    expect(() => rewriteReplayAttachmentIds(['unknown'], attachmentMap)).toThrow(
      'No safe attachment replacement'
    );
  });

  it('detects residual incident media recursively after rewriting', () => {
    const forbidden = new Set([incidentAudioMxc, ...incidentAttachmentIds]);

    expect(() =>
      assertNoIncidentMediaReferences(
        { nested: { attachments: ['test-a', incidentAttachmentIds[1]] } },
        forbidden
      )
    ).toThrow('incident media reference');
    expect(() =>
      assertNoIncidentMediaReferences(
        { nested: { attachments: replacementAttachmentIds } },
        forbidden
      )
    ).not.toThrow();
  });

  it('collects unique attachment IDs from top-level and replacement content', () => {
    expect(
      collectIncidentAttachmentIds([
        { content: { 'com.mindroom.attachment_ids': ['incident-a'] } },
        {
          content: {
            'com.mindroom.attachment_ids': ['incident-a', 'incident-b'],
            'm.new_content': { 'com.mindroom.attachment_ids': ['incident-c'] },
          },
        },
      ])
    ).toEqual(incidentAttachmentIds);
  });
});
