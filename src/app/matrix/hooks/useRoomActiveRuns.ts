import {
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMindroomAgentUserIdForViewer } from '../protocol/agentIdentity';
import { isAgentTrustStateEvent, roomTrustedAgents } from '../protocol/agentRoomState';
import {
  createExpiryTimer,
  MINDROOM_ACTIVE_RUNS_EVENT,
  roomActiveRuns,
  type RoomActiveRuns,
} from '../protocol/activeRunsContract';

const toValue = (room: Room | null): RoomActiveRuns => {
  const { runs, threads } = roomActiveRuns(room);
  return { runs, threads };
};

/**
 * Live `io.mindroom.active_runs` for `room`. Keeps expiry in a timer so heartbeats with unchanged
 * runs/threads extend TTL without re-rendering consumers, and skips reads on unrelated renders.
 */
export const useRoomActiveRuns = (room: Room | null): RoomActiveRuns => {
  const [state, setState] = useState(() => ({ room, value: toValue(room) }));
  let { value } = state;
  if (state.room !== room) {
    value = toValue(room);
    setState({ room, value });
  }
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!room) return undefined;
    const sync = () => {
      const { runs, threads, nextExpiryTs } = roomActiveRuns(room);
      expiryTimer.arm(nextExpiryTs);
      if (threads === valueRef.current.threads && runs === valueRef.current.runs) return;
      const next = { runs, threads };
      valueRef.current = next;
      setState({ room, value: next });
    };
    const expiryTimer = createExpiryTimer(sync);
    const onState = (e: MatrixEvent) => {
      const type = e.getType();
      if (type === MINDROOM_ACTIVE_RUNS_EVENT || isAgentTrustStateEvent(type)) sync();
    };
    const onMember = (_e: MatrixEvent, _s: RoomState, m: RoomMember) => {
      if (
        isMindroomAgentUserIdForViewer(m.userId, room.myUserId) ||
        valueRef.current.runs.some((run) => run.agentId === m.userId) ||
        roomTrustedAgents(room).has(m.userId)
      )
        sync();
    };
    room.on(RoomStateEvent.Events, onState);
    room.on(RoomStateEvent.Members, onMember);
    room.on(RoomEvent.CurrentStateUpdated, sync);
    room.on(RoomEvent.Redaction, sync);
    sync();
    return () => {
      expiryTimer.clear();
      room.removeListener(RoomStateEvent.Events, onState);
      room.removeListener(RoomStateEvent.Members, onMember);
      room.removeListener(RoomEvent.CurrentStateUpdated, sync);
      room.removeListener(RoomEvent.Redaction, sync);
    };
  }, [room]);

  return value;
};
