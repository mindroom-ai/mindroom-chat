import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { isTimelineRowHidden } from './roomTimelineRows';
import { NO_VOICE_TRANSCRIPTS } from '../messages/voiceTranscripts';

const NONE = new Set<string>();
const hidden = (id: string, replyCardIds?: Set<string>) =>
  isTimelineRowHidden(new MatrixEvent({ event_id: id, type: 'm.room.message' }), {
    messageData: {
      approvalTimeline: { hiddenEventIds: NONE } as never,
      threadSummaryTimeline: { hiddenEventIds: NONE } as never,
      secretRequestTimeline: { hiddenEventIds: NONE },
      voiceTranscripts: NO_VOICE_TRANSCRIPTS,
      replyCards: replyCardIds && { hiddenEventIds: replyCardIds, byReply: new Map() },
    },
    ignoredUsersSet: NONE,
    showHiddenEvents: false,
    isHiddenByPlugin: () => false,
  });

describe('a canvas notice drawn as a card under its reply', () => {
  it('has no row of its own; every other notice keeps its row', () => {
    expect(hidden('$canvas', new Set(['$canvas']))).toBe(true);
    expect(hidden('$other', new Set(['$canvas']))).toBe(false);
    expect(hidden('$canvas')).toBe(false);
  });
});
