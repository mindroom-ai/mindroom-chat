import { useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { registeredPlugins, type RegisteredPlugin } from '../../plugins/registry';
import { shownThreadDetails } from '../../plugins/threadDetails';
import { ThreadDetailsList } from '../../threads/ThreadDetailsList';
import * as css from './threadNav.css';

/**
 * The plugins' details of a sidebar thread, under a rule after the card's own rows, which the card
 * hides while none drew anything. Which details show is read as the card opens and kept until it
 * closes. The card renders outside a room's page, so a detail's room side panel is undefined here.
 */
export function ThreadNavPluginDetails({
  room,
  threadId,
  plugins = registeredPlugins,
}: {
  room: Room;
  threadId: string;
  plugins?: readonly RegisteredPlugin[];
}) {
  const config = useOptionalClientConfig();
  const [details] = useState(() =>
    isConfirmedMatrixEventId(threadId) ? shownThreadDetails(plugins, config, room, threadId) : []
  );
  if (details.length === 0) return null;
  return (
    <div className={css.EntryTooltipPluginDetails}>
      <ThreadDetailsList room={room} threadId={threadId} details={details} />
    </div>
  );
}
