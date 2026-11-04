import React, { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { startAgentCall } from '../../mindroom/calls/agentCaller';
import { activeCallAtom, callPanelRoomAtom, useCallActions } from './callStore';
import {
  rememberCallForResume,
  takeCallResume,
  withdrawLeftoverMemberships,
  withdrawOwnMemberships,
  type CallResumeRecord,
} from './callResume';
import { AgentCallFailureNotice } from '../../mindroom/calls/AgentCallFailureNotice';
import { IncomingCalls } from './IncomingCalls';
import * as css from './IncomingCalls.css';

/**
 * Ends the call with the signed-in session: when the account signs out or switches (the shell
 * unmounts), and as far as the browser allows when the page goes away, so the membership others
 * see does not outlive the tab until it expires. A page that goes away remembers the call, so a
 * reload takes it up again.
 */
function CallLifetime() {
  const mx = useMatrixClient();
  const store = useStore();
  useEffect(() => {
    const leave = () => {
      const active = store.get(activeCallAtom);
      if (!active) return;
      active.call.leave().catch(() => undefined);
      active.onEnded?.().catch(() => undefined);
    };
    const pageHide = () => {
      const active = store.get(activeCallAtom);
      if (active) rememberCallForResume(mx, active);
      leave();
    };
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('pagehide', pageHide);
      leave();
      store.set(activeCallAtom, undefined);
      // The next account would otherwise find this account's call panel open in a shared room.
      store.set(callPanelRoomAtom, undefined);
    };
  }, [mx, store]);
  return null;
}

/** Joins the remembered call again, in the room it ran in or with the agent it called. */
const resumeCall = async (
  mx: MatrixClient,
  startCall: ReturnType<typeof useCallActions>['startCall'],
  record: CallResumeRecord
): Promise<void> => {
  const room = mx.getRoom(record.roomId);
  if (room?.getMyMembership() !== KnownMembership.Join) return;
  const { microphone, devices } = record;
  if (record.kind === 'agent' && record.agentUserId && record.origin) {
    await startAgentCall(mx, startCall, {
      room,
      agentUserId: record.agentUserId,
      origin: record.origin,
      microphone,
      devices,
    });
    return;
  }
  await startCall({ room, kind: 'room', microphone, video: record.camera, devices });
};

/**
 * Once the first sync is done: takes up the call this tab was in before a reload, and withdraws
 * the memberships this device left in other calls.
 */
function CallResume() {
  const mx = useMatrixClient();
  const store = useStore();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const { startCall } = useCallActions(mx);
  const done = useRef(false);

  useEffect(() => {
    if (!hasCompletedInitialSync || done.current) return;
    done.current = true;
    const record = takeCallResume(mx);
    (async () => {
      await withdrawLeftoverMemberships(mx, record?.roomId);
      if (!record) return;
      await resumeCall(mx, startCall, record).catch(() => undefined);
      const active = store.get(activeCallAtom);
      const inRoom = active?.call.room.roomId === record.roomId;
      if (inRoom && active?.call.getState().phase !== 'failed') return;
      // A call that could not be taken up again leaves no membership behind either.
      const room = mx.getRoom(record.roomId);
      if (room) await withdrawOwnMemberships(mx, [room]);
    })();
  }, [hasCompletedInitialSync, mx, startCall, store]);
  return null;
}

/**
 * Account-wide call features: incoming rings, why an agent call did not start, resuming after a
 * reload, and the call's lifetime.
 */
export function CallFeatures() {
  return (
    <>
      <CallLifetime />
      <CallResume />
      <div className={css.Host}>
        <IncomingCalls />
        <AgentCallFailureNotice />
      </div>
    </>
  );
}
