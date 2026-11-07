import { useEffect, useRef } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { requestAudienceOpenIdToken } from '../../matrix/openidAudience';
import { useActiveCall, useCallState } from '../callStore';
import type { RoomCall } from '../RoomCall';
import type { CallTranscriber } from './callTranscriber';
import {
  applyCallEvent,
  callTranscriptionAtom,
  heldInCall,
  liveTranscriptAtom,
  pauseHeldAtom,
} from './transcriptionState';
import { useTranscriptionServer } from './useTranscriptionServer';

/** Transcribes this device's speech while it is connected to `call`. */
function RoomCallTranscription({ call }: { call: RoomCall }) {
  const mx = useMatrixClient();
  const store = useStore();
  const { roomId } = call.room;
  const server = useTranscriptionServer(mx, call.room);
  const state = useCallState(call);
  const connected = state.phase === 'connected' || state.phase === 'reconnecting';
  const apiUrl = connected ? server.apiUrl : undefined;
  const { discovered } = server;
  // A muted microphone sends nothing.
  const track = state.microphone ? state.microphoneTrack : undefined;
  // Holds come from MindRoom's stream (and Pause's answers); this device's own pauses at once.
  const held = useAtomValue(pauseHeldAtom);
  const live = useAtomValue(liveTranscriptAtom);
  const paused = held || heldInCall(live, roomId);

  const transcriberRef = useRef<CallTranscriber>();
  const latest = useRef({ track, paused });
  latest.current = { track, paused };

  useEffect(() => {
    if (!apiUrl) return undefined;
    let current = true;
    let transcriber: CallTranscriber | undefined;
    let unsubscribe: (() => void) | undefined;
    store.set(callTranscriptionAtom, { roomId, status: 'joining' });
    // Loaded on the first call MindRoom may transcribe, with the speech finder and the routes.
    import('./callTranscriber').then(
      ({ CallTranscriber: Transcriber }) => {
        if (!current) return;
        transcriber = new Transcriber({
          roomId,
          userId: mx.getSafeUserId(),
          apiUrl,
          getOpenIdToken: () =>
            requestAudienceOpenIdToken(mx, apiUrl, { requireBinding: discovered }),
          onStatus: (status) => {
            if (!current) return;
            store.set(callTranscriptionAtom, status === 'off' ? undefined : { roomId, status });
          },
          onEvent: (event) => {
            if (!current) return;
            store.set(liveTranscriptAtom, (shown) => applyCallEvent(shown, roomId, event));
          },
          // Shown as not held, which resumes listening.
          onHoldRefused: () => {
            if (current) store.set(pauseHeldAtom, false);
          },
        });
        const made = transcriber;
        transcriberRef.current = made;
        made.setMicrophone(latest.current.track);
        made.setPaused(latest.current.paused);
        // Pause pressed here pauses listening at once and takes the hold; let go, it lets go of
        // it. Followed as the atom changes, not after a render: a page going away has none.
        unsubscribe = store.sub(pauseHeldAtom, () => {
          const held = store.get(pauseHeldAtom);
          made.setPaused(held || heldInCall(store.get(liveTranscriptAtom), roomId));
          made.setHolding(held);
        });
        made.start();
      },
      () => {
        // Without its part (offline after a deployment) the call goes on untranscribed.
        if (current) store.set(callTranscriptionAtom, undefined);
      }
    );
    return () => {
      current = false;
      unsubscribe?.();
      transcriberRef.current = undefined;
      void transcriber?.end();
      store.set(callTranscriptionAtom, undefined);
      store.set(liveTranscriptAtom, undefined);
      // Leaving releases a hold.
      store.set(pauseHeldAtom, false);
    };
  }, [apiUrl, call, discovered, mx, roomId, store]);

  useEffect(() => {
    transcriberRef.current?.setMicrophone(track);
  }, [track]);

  useEffect(() => {
    transcriberRef.current?.setPaused(paused);
  }, [paused]);

  return null;
}

/**
 * Transcribes this device's own speech while it is in a room call MindRoom transcribes. Calls with
 * an agent are left alone: they post their own transcript.
 */
export function CallTranscription() {
  const active = useActiveCall();
  if (active?.kind !== 'room') return null;
  return <RoomCallTranscription call={active.call} />;
}
