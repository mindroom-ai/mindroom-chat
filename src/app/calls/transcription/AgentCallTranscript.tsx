import { useEffect } from 'react';
import { useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { clientSessions } from '../../computer/clientSessions';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import { callHomeRoomId, useActiveCall, useCallState, type ActiveCall } from '../callStore';
import { TranscriptionClient } from './api';
import { pollLiveCall } from './liveCallPoll';
import { dismissTranscriptPanel } from './transcriptPanel';
import { applyLiveUpdate, callTranscriptionAtom, liveTranscriptAtom } from './transcriptionState';

/** The pace of a room call transcriber's reads. */
const READ_MS = 2_000;

/**
 * Reads the agent call this device is in while it is connected: `transcribing` once MindRoom has
 * the call, `unavailable` while MindRoom cannot be reached, and the lines it has. MindRoom
 * transcribes both sides itself, so nothing is joined or sent. A room MindRoom does not transcribe
 * (a MindRoom that does not transcribe agent calls) shows none.
 */
function AgentCallReads({ active }: { active: ActiveCall }) {
  const mx = useMatrixClient();
  const store = useStore();
  const { call } = active;
  const { roomId } = call.room;
  const server = useRoomMindroomServer(mx, roomId);
  const { phase } = useCallState(call);
  const connected = phase === 'connected' || phase === 'reconnecting';
  const apiUrl = connected ? server.apiUrl : undefined;

  useEffect(() => {
    if (!apiUrl) return undefined;
    const stop = new AbortController();
    void pollLiveCall(
      new TranscriptionClient(clientSessions(mx, apiUrl)),
      roomId,
      READ_MS,
      stop.signal,
      (live) => {
        // Until the agent's MindRoom has the call there is nothing to show.
        store.set(
          callTranscriptionAtom,
          live.call ? { roomId, status: 'transcribing' } : undefined
        );
        store.set(liveTranscriptAtom, (shown) =>
          applyLiveUpdate(shown, roomId, { type: 'live', live })
        );
      },
      () => store.set(callTranscriptionAtom, { roomId, status: 'unavailable' })
    ).then((outcome) => {
      if (outcome === 'not-transcribed') store.set(callTranscriptionAtom, undefined);
    });
    return () => {
      stop.abort();
      store.set(callTranscriptionAtom, undefined);
      store.set(liveTranscriptAtom, undefined);
    };
  }, [apiUrl, mx, roomId, store]);

  // Once the call is over here, ended or failed, its transcript leaves the conversation's side
  // panel, as its call panel does: the panel would go on reading that room's own call.
  const homeRoomId = callHomeRoomId(active);
  useEffect(() => {
    if (!connected) return undefined;
    return () => dismissTranscriptPanel(store, homeRoomId);
  }, [connected, homeRoomId, store]);
  return null;
}

/**
 * The live transcript of the agent call this device is in, read from MindRoom for the call's
 * controls, its window and the side panel. Room calls are `CallTranscription`'s.
 */
export function AgentCallTranscript() {
  const active = useActiveCall();
  if (active?.kind !== 'agent') return null;
  return <AgentCallReads active={active} />;
}
