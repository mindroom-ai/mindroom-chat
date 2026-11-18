import type { ReactNode } from 'react';
import { readSnoozeEndedNote } from '../matrix/protocol/threadSnooze';
import { readSkillReviewNotice } from '../matrix/protocol/skillReview';
import { readCompactionNotice } from '../matrix/protocol/compactions';
import { SnoozeEndedMarker } from './SnoozeEndedMarker';
import { SkillReviewMarker } from './SkillReviewMarker';
import { CompactionNoticeSeam } from './agent-run/CompactionSeam';

/**
 * The quiet line of a MindRoom agent's snooze-ended, skill review or compaction notice, or null
 * for other content. A compaction notice started when it was sent (`originTs`). The caller checks
 * that an agent sent it.
 */
export const readAgentNoticeMarker = (
  content: Record<string, unknown>,
  originTs: number | undefined
): ReactNode | null => {
  const snoozeEndedNote = readSnoozeEndedNote(content);
  if (snoozeEndedNote !== null) return <SnoozeEndedMarker note={snoozeEndedNote} />;
  const skillReview = readSkillReviewNotice(content);
  if (skillReview) return <SkillReviewMarker review={skillReview} />;
  const compaction = readCompactionNotice(content, originTs);
  return compaction ? <CompactionNoticeSeam compaction={compaction} /> : null;
};
