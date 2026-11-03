import { useCallback, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Direction, type EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { useAlive } from '../../hooks/useAlive';
import { decryptAllTimelineEvent } from '../../utils/room';
import {
  getEventIdAbsoluteIndex,
  getLinkedTimelines,
  getTimelinesEventsCount,
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import { getRenderableEvents } from './roomTimelineEvents';

/**
 * Fetches the timeline around an event. `onLoad` gets the linked chain and the event's index
 * in it once the slice is decrypted; `onError` runs when the event cannot be found.
 */
export const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], absoluteIndex: number) => void,
  onError: () => void
): ((eventId: string) => Promise<void>) => {
  // The newest handlers run when a fetch lands, so the loader itself stays stable.
  const handlersRef = useRef({ onLoad, onError });
  handlersRef.current = { onLoad, onError };
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const timelineSet = room.getUnfilteredTimelineSet();
      const [, eventTimeline] = await to(mx.getEventTimeline(timelineSet, eventId));

      const chain = eventTimeline ? getLinkedTimelines(eventTimeline) : [];
      const absoluteIndex =
        eventTimeline ? getEventIdAbsoluteIndex(chain, eventTimeline, eventId) : undefined;
      if (!eventTimeline || absoluteIndex === undefined) return handlersRef.current.onError();

      await to(decryptAllTimelineEvent(mx, eventTimeline));
      handlersRef.current.onLoad(eventId, chain, absoluteIndex);
    },
    [mx, room]
  );

  return loadEventTimeline;
};

export const useTimelinePagination = (



  limit: number,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>
): ((backwards: boolean) => Promise<void>) => {









      const lTimelines = timelineRef.current.linkedTimelines;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);
      const fOpts = filterOptsRef.current ?? undefined;
      const timelinesRenderableCounts = fOpts
        ? lTimelines.map(
            (tl) =>
              getRenderableEvents(
                [tl],
                fOpts.room,
                fOpts.threadId,
                fOpts.ignoredUsersSet,
                fOpts.showHiddenEvents,
                fOpts.hideMembershipEvents,
                fOpts.hideNickAvatarEvents
              ).length
          )
        : undefined;

      const edgeTimeline = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!edgeTimeline) return;

      const direction = backwards ? Direction.Backward : Direction.Forward;
      if (!edgeTimeline.getPaginationToken(direction)) {
        // Nothing is left to fetch past this edge, but the SDK may have joined another
        // timeline to it (an earlier page reached history it already held). Take that
        // timeline into the window; with the chain unchanged there is nothing to load.
        const chainGrew =
          getLinkedTimelines(edgeTimeline).length !== lTimelines.length;
        if (!chainGrew) return;
        recalibrateTimelinePagination(
          setTimeline,
          lTimelines,
          timelinesEventsCount,
          backwards,
          fOpts,
          timelinesRenderableCounts
        );
        return;
      }

      fetching = true;
      try {
        const eventsBefore = getTimelinesEventsCount(getLinkedTimelines(edgeTimeline));
        const [error] = await to(
          mx.paginateEventTimeline(edgeTimeline, {
            backwards,
            limit,
          })
        );
        // A failed page leaves the window as it is; reaching the edge again retries it.
        if (error) return;
        const pagedTimelines = getLinkedTimelines(edgeTimeline);
        if (getTimelinesEventsCount(pagedTimelines) === eventsBefore) return;
        // Rows are counted from decrypted content (a readable reaction or edit is hidden),
        // so decrypt what the page brought before the window moves. A page that joined the
        // chain to a neighbouring timeline brings that timeline's events too.
        const grown = backwards
          ? pagedTimelines.slice(0, pagedTimelines.indexOf(edgeTimeline) + 1)
          : pagedTimelines.slice(pagedTimelines.indexOf(edgeTimeline));

        await Promise.all(
          grown.map((pagedTimeline) => to(decryptAllTimelineEvent(mx, pagedTimeline)))
        );

        if (alive()) {
          recalibrateTimelinePagination(
            setTimeline,
            lTimelines,
            timelinesEventsCount,
            backwards,
            fOpts,
            timelinesRenderableCounts
          );
        }
      } finally {
        fetching = false;
      }
    };
  }, [mx, alive, setTimeline, limit, filterOptsRef]);
  return handleTimelinePagination;
};
