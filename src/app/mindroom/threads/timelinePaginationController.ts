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































};

export const useTimelinePagination = (



  limit: number,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>













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













        recalibrateTimelinePagination(
          setTimeline,
          lTimelines,
          timelinesEventsCount,
































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
