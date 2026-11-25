import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import type { ThreadWorkflowTab } from '../event-store/threads/threadWorkflow';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import type { ThreadSummaryWriter } from '../event-store/threads/threadSummaryState';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import type { RoomViewMode } from '../navigation/roomViewMode';
import type {
  ThreadFilterState,
  ThreadSortFreezeState,
} from '../event-store/threads/roomThreadOverviewModel';
import type { RoomRowsPlace } from './roomTimelineScroll';
import { ThreadTimeline } from './ThreadTimeline';
import { RoomSurface } from './RoomSurface';

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** Show a permalinked thread root in the room instead of opening its thread. */
  focusEventInRoom?: boolean;
  /** The router's key of the history entry whose address names `eventId`. */
  entryKey?: string;
  /** Whether the router pushed that entry (a link followed), not replaced or returned to it. */
  entryPushed?: boolean;
  /** Whether the app's Back put that entry in a thread's place (`RETURN_TO_ROOM_STATE`). */
  entryReturned?: boolean;
  summaryMap: ReadonlyMap<string, ThreadSummaryInfo>;
  onStoreThreadSummary: ThreadSummaryWriter;
  threadFilterState: ThreadFilterState;
  /** The filter bar's sort lock: the room's thread order as it was when the reader locked it. */
  threadSortFreezeState?: ThreadSortFreezeState | null;
  setThreadSortFreezeState?: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  /** Without agents the filter bar keeps only its search and sort. */
  hasMindroomAgents?: boolean;
  /** The filter bar's controls; the room view keeps the state they change. */
  onSortDirectionChange?: () => void;
  onToggleThreadSortFreeze?: () => void;
  onToggleUnresolvedOnly?: () => void;
  onToggleForMe?: () => void;
  onTogglePerson?: (userId: string) => void;
  onClearPeople?: () => void;
  onReset?: () => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onClearTags?: () => void;
  onSelectTab?: (tab: ThreadWorkflowTab) => void;
  onShowSnoozed?: () => void;
  onSearchQueryChange?: (query: string) => void;
  /** Compact shows its cards in sections (Needs you, Working, Later, Done). */
  threadSections?: boolean;
  /** The Compact filter bar's switch for `threadSections`. */
  onToggleThreadSections?: () => void;
  viewMode: RoomViewMode;
  compactRoomScrollStateRef?: MutableRefObject<ScrollAnchorMemory>;
  /** Where the room's rows were when a thread opened over them (`useThreadReturnPlace`). */
  threadReturnPlaceRef?: MutableRefObject<RoomRowsPlace | undefined>;
  editor: Editor;
  /** Called when the open thread's root cannot be loaded at all. */
  onThreadLoadError?: (threadId: string) => void;
  /** Shown above an open thread's rows, inside its scroll area. */
  threadHeader?: ReactNode;
  /** No room header above the thread: its header keeps a gap above it (`ThreadTimelineHeader`). */
  threadHeaderGapAbove?: boolean;
  /**
   * A fork draft's fork point: when it is one of the open thread's own messages, the thread shows
   * up to it, read-only as the fork will show it, with the "Forking" divider under it.
   */
  forkAt?: string;
  /** In a cross-room fork draft, the destination room that "Fork from here" and the divider target. */
  forkTargetRoom?: Room;
  /** Whether the user can send messages in the destination room; suppresses draft compose prompts when false. */
  canCompose?: boolean;
};

/**
 * Public timeline entry point: dispatches open threads to `ThreadTimeline` and room views
 * (Compact cards, Threads, and Classic) to `RoomSurface`.
 */
export function RoomTimeline(props: RoomTimelineProps) {
  if (props.threadId) {
    return <ThreadTimeline {...props} threadId={props.threadId} />;
  }
  return <RoomSurface {...props} />;
}
