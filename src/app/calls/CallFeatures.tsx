import { useEffect } from 'react';
import { useStore } from 'jotai';
import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { startAgentCall } from './agent/agentCaller';
import { activeCallAtom, dropActiveCall, leaveCallNow, useCallActions } from './callStore';
import {
  forgetCallResume,
  rememberCallForResume,
  takeCallResume,
  whenServerSynced,
  withdrawLeftoverMemberships,
  withdrawOwnMemberships,
  type CallResumeRecord,
} from './callResume';
import { AgentCallFailureNotice } from './agent/AgentCallFailureNotice';
import { IncomingCalls } from './IncomingCalls';
import * as css from './IncomingCalls.css';
import { CallWindowHost } from './window/CallWindowHost';

/**
 * Ends the call with the signed-in session: when the account signs out or switches (the shell
 * unmounts), and as far as the browser allows when the page goes away, so the membership others
 * see does not outlive the tab until it expires. A page that goes away remembers the call, so a
 * reload takes it up again; a page kept in the back/forward cache ends it for good.
 */
function CallLifetime() {
  const mx = useMatrixClient();
  const store = useStore();
  useEffect(() => {
    const pageHide = (event: PageTransitionEvent) => {
      const active = store.get(activeCallAtom);
      if (!active) return;
      if (event.persisted) {
        // The back/forward cache keeps the page but not the call: Back must find no call (not a
        // dead one that answers every new call `busy`), and no reload may take it up again.
        dropActiveCall(store);
        return;
      }
      rememberCallForResume(mx, active);
      leaveCallNow(active);
    };
    // A page back from the cache starts without a call, whatever a page before it remembered.
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) forgetCallResume();
    };
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    // The call itself, with the rest of the account's call state, goes with the account's screens
    // (`shell/accountState.ts`), whose list runs before this cleanup.
    return () => {
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
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
 * Once the first sync from the server is in: takes up the call this tab was in before a reload,
 * and withdraws the memberships this device left in other calls.
 */
function CallResume() {
  const mx = useMatrixClient();
  const store = useStore();
  const { startCall } = useCallActions(mx);

  useEffect(() => {
    // The shell can mount again before the first sync, or the account sign out or switch; the
    // run that gets past the sync takes the record, so a cancelled one leaves it to the next.
    let cancelled = false;
    void (async () => {
      await whenServerSynced(mx);
      if (cancelled) return;
      // Read only now: a shell that went away before acting leaves the record to the next one.
      const record = takeCallResume(mx);
      await withdrawLeftoverMemberships(mx, record?.roomId);
      // Each step waits; an account that signed out or switched meanwhile gets nothing more.
      if (cancelled || !record) return;
      await resumeCall(mx, startCall, record).catch(() => undefined);
      if (cancelled) return;
      const active = store.get(activeCallAtom);
      const inRoom = active?.call.room.roomId === record.roomId;
      if (inRoom && active?.call.getState().phase !== 'failed') return;
      // A call that could not be taken up again leaves no membership behind either.
      const room = mx.getRoom(record.roomId);
      if (room) await withdrawOwnMemberships(mx, [room]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mx, startCall, store]);
  return null;
}

/**
 * Account-wide call features: incoming rings, why an agent call did not start, resuming after a
 * reload, the call's lifetime, and the floating call window.
 */
export function CallFeatures() {
  return (
    <>
      <CallLifetime />
      <CallResume />
      {/* Beside the rings, not inside their fixed corner: the window places itself in the viewport. */}
      <CallWindowHost />
      <div className={css.Host}>
        <IncomingCalls />
        <AgentCallFailureNotice />
      </div>
    </>
  );
}
