import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import type { VisibleThreadRootData } from '../../event-store/threads/roomThreadOverviewModel';
import {
  buildThreadRecordMap,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import type { ThreadOverviewCachedMetadataSnapshot } from './threadOverviewCacheMetadata';
import type { ThreadScheduledStatus } from '../../event-store/threads/threadScheduledStatus';
import type { ThreadRecord } from '../../event-store/threads/types';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags: Record<string, unknown> | null;
};

export type BuildThreadIndexRecordMapsOptions = {
  threadId: string | undefined;
  compactViewRequested: boolean;
  room: Room;
  visibleThreadRootData: VisibleThreadRootData;
  compactThreadRootData: VisibleThreadRootData;
  visibleThreadRootEventMap: ReadonlyMap<string, MatrixEvent>;
  compactThreadRootEventMap: ReadonlyMap<string, MatrixEvent>;
  compactThreadRootBodyMap: ReadonlyMap<string, string>;
  summaryMap: ReadonlyMap<string, ThreadSummaryInfo>;
  fallbackSummaryMap: ReadonlyMap<string, ThreadSummaryInfo>;
  fallbackReplyCountMap: ReadonlyMap<string, number>;
  cachedMetadata: Pick<
    ThreadOverviewCachedMetadataSnapshot,
    | 'latestReplyPreviewMap'
    | 'latestReplyTsMap'
    | 'lastSenderIdMap'
    | 'messageCountMap'
    | 'lastActivityTsMap'
    | 'coverageMap'
  >;
  fallbackParticipantMap: ReadonlyMap<string, string[]>;
  threadResolutionMap: ReadonlyMap<string, ThreadResolutionLike>;
  currentUserId: string | undefined;
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>;
  /** The maps of the build before, whose records are kept for the threads without a change. */
  previous?: ThreadIndexRecordMaps;
  changes: ThreadRecordChanges;
};

export type ThreadIndexRecordMaps = {
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
};

export const buildThreadIndexRecordMaps = ({
  threadId,
  compactViewRequested,
  room,
  visibleThreadRootData,
  compactThreadRootData,
  visibleThreadRootEventMap,
  compactThreadRootEventMap,
  compactThreadRootBodyMap,
  summaryMap,
  fallbackSummaryMap,
  fallbackReplyCountMap,
  cachedMetadata,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  scheduledStatusMap,
  previous,
  changes,
}: BuildThreadIndexRecordMapsOptions): ThreadIndexRecordMaps => {
  const emptyThreadRecordMap = new Map<string, ThreadRecord>();
  if (threadId) {
    return {
      normalThreadRecordMap: emptyThreadRecordMap,
      compactThreadRecordMap: emptyThreadRecordMap,
    };
  }

  const sharedRecordOptions = {
    room,
    summaryMap,
    fallbackSummaryMap,
    fallbackReplyCountMap,
    fallbackLatestReplyPreviewMap: cachedMetadata.latestReplyPreviewMap,
    fallbackLatestReplyTsMap: cachedMetadata.latestReplyTsMap,
    fallbackLastSenderIdMap: cachedMetadata.lastSenderIdMap,
    fallbackMessageCountMap: cachedMetadata.messageCountMap,
    fallbackLastActivityTsMap: cachedMetadata.lastActivityTsMap,
    fallbackParticipantMap,
    threadResolutionMap,
    currentUserId,
    scheduledStatusMap,
    cacheCoverageMap: cachedMetadata.coverageMap,
  };

  const normalThreadRecordMap = buildThreadRecordMap({
    ...sharedRecordOptions,
    threadRootIds: visibleThreadRootData.ids,
    threadRootEventMap: visibleThreadRootEventMap,
    rootPreviewTextMap: visibleThreadRootData.bodyMap,
    absoluteIndexMap: visibleThreadRootData.indexMap,
    reuse: { previous: previous?.normalThreadRecordMap, changes },
  });
  const compactThreadRecordMap = compactViewRequested
    ? buildThreadRecordMap({
        ...sharedRecordOptions,
        threadRootIds: compactThreadRootData.ids,
        threadRootEventMap: compactThreadRootEventMap,
        rootPreviewTextMap: compactThreadRootBodyMap,
        absoluteIndexMap: compactThreadRootData.indexMap,
        reuse: { previous: previous?.compactThreadRecordMap, changes },
      })
    : normalThreadRecordMap;

  return {
    normalThreadRecordMap,
    compactThreadRecordMap,
  };
};
