import type { ReactNode } from 'react';
import { readSnoozeEndedNote } from '../matrix/protocol/threadSnooze';
import { readSkillReviewNotice } from '../matrix/protocol/skillReview';
import { readCompactionNotice } from '../matrix/protocol/compactions';
import { getLongTextSource } from '../matrix/protocol/longText';
import { readTriggerWake } from '../matrix/protocol/triggerWake';
import { SnoozeEndedMarker } from './SnoozeEndedMarker';
import { SkillReviewMarker } from './SkillReviewMarker';
import { CompactionNoticeSeam } from './agent-run/CompactionSeam';
import { TriggerWakeMarker } from './TriggerWakeMarker';

/**
 * The quiet line of a MindRoom agent's snooze-ended, skill review, compaction or trigger wake
 * notice, or null for other content. A compaction or trigger wake uses when it was sent
 * (`originTs`). The caller checks that an agent sent it.
 */
export const readAgentNoticeMarker = (
  content: Record<string, unknown>,
  originTs: number | undefined,
  roomId?: string
): ReactNode | null => {
  const snoozeEndedNote = readSnoozeEndedNote(content);
  if (snoozeEndedNote !== null) return <SnoozeEndedMarker note={snoozeEndedNote} />;
  const skillReview = readSkillReviewNotice(content);
  if (skillReview) return <SkillReviewMarker review={skillReview} />;
  const triggerWake = getLongTextSource(content) ? null : readTriggerWake(content);
  if (triggerWake) return <TriggerWakeMarker wake={triggerWake} ts={originTs} roomId={roomId} />;
  const compaction = readCompactionNotice(content, originTs);
  return compaction ? <CompactionNoticeSeam compaction={compaction} /> : null;
};
