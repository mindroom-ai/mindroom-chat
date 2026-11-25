import type { ReactNode } from 'react';
import { readSnoozeEndedNote } from '../matrix/protocol/threadSnooze';
import { readSkillReviewNotice } from '../matrix/protocol/skillReview';
import { readCompactionNotice } from '../matrix/protocol/compactions';
import { getLongTextSource } from '../matrix/protocol/longText';
import { readTriggerWake } from '../matrix/protocol/triggerWake';
import { readTodoPoke } from '../matrix/protocol/todoPoke';
import { SnoozeEndedMarker } from './SnoozeEndedMarker';
import { SkillReviewMarker } from './SkillReviewMarker';
import { CompactionNoticeSeam } from './agent-run/CompactionSeam';
import { TriggerWakeMarker } from './TriggerWakeMarker';
import { TodoPokeMarker } from './TodoPokeMarker';

/**
 * The quiet line of a MindRoom agent's snooze-ended, skill review, compaction, trigger wake or
 * todo wake notice, or null for other content. A compaction, trigger wake or todo wake uses when
 * it was sent (`originTs`). The caller checks that an agent sent it.
 */
export const readAgentNoticeMarker = (
  content: Record<string, unknown>,
  originTs: number | undefined,
  roomId?: string,
  senderDisplayName?: string
): ReactNode | null => {
  const snoozeEndedNote = readSnoozeEndedNote(content);
  if (snoozeEndedNote !== null) return <SnoozeEndedMarker note={snoozeEndedNote} />;
  const skillReview = readSkillReviewNotice(content);
  if (skillReview) return <SkillReviewMarker review={skillReview} />;
  const hasLongText = getLongTextSource(content) !== undefined;
  const triggerWake = hasLongText ? null : readTriggerWake(content);
  if (triggerWake) return <TriggerWakeMarker wake={triggerWake} ts={originTs} roomId={roomId} />;
  const todoPoke = hasLongText ? null : readTodoPoke(content);
  if (todoPoke) {
    return <TodoPokeMarker poke={todoPoke} ts={originTs} senderDisplayName={senderDisplayName} />;
  }
  const compaction = readCompactionNotice(content, originTs);
  return compaction ? <CompactionNoticeSeam compaction={compaction} /> : null;
};
