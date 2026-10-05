import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { atom, useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
import { callEmbedAtom } from '../../state/callEmbed';
import { webRTCSupported } from '../../utils/rtc';
import { waitForJoinedRoom } from '../matrix/waitForJoinedRoom';
import { requestMicrophoneAccess } from '../voice/microphoneAccess';
import {
  cleanupCreatedAgentCall,
  createAgentVoiceRoom,
  MindroomAgentCallOrigin,
} from './agentCall';

type AgentCallTarget = { userId: string; displayName?: string };

type StartAgentCall = {
  startAgentCall: (agent: AgentCallTarget, origin?: MindroomAgentCallOrigin) => Promise<boolean>;
  loading: boolean;
  error?: string;
  unavailableReason?: string;
};

// Shared by every entry point, so a second start cannot begin while one is being set up.
const agentCallStartingAtom = atom(false);

/**
 * Creates an ephemeral call room with a MindRoom agent and starts the embedded call.
 * Resolves `true` once the call has started and never navigates; callers decide what to show next.
 */
export function useStartAgentCall(): StartAgentCall {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { createRoom } = useClientConfig();
  const startCall = useCallStart(false);
  const callEmbed = useCallEmbed();
  const livekitSupported = useLivekitSupport();
  const rtcSupported = webRTCSupported();
  const store = useStore();
  const loading = useAtomValue(agentCallStartingAtom);
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const unavailableReason = !livekitSupported
    ? t('mindroomUi.calls.agentCallButton.homeserverUnsupported')
    : !rtcSupported
    ? t('mindroomUi.calls.agentCallButton.browserUnsupported')
    : callEmbed
    ? t('mindroomUi.calls.agentCallButton.endCurrentCall')
    : undefined;

  const startAgentCall = async (
    agent: AgentCallTarget,
    origin?: MindroomAgentCallOrigin
  ): Promise<boolean> => {
    if (store.get(agentCallStartingAtom) || unavailableReason) return false;
    store.set(agentCallStartingAtom, true);
    setError(undefined);

    let roomId: string | undefined;
    try {
      await requestMicrophoneAccess();
      if (!mountedRef.current) return false;

      roomId = await createAgentVoiceRoom(
        mx,
        agent.userId,
        agent.displayName,
        createRoom?.defaultEncryption ?? true,
        origin
      );
      if (!mountedRef.current) {
        await cleanupCreatedAgentCall(mx, roomId, agent.userId);
        return false;
      }
      const room = await waitForJoinedRoom(mx, roomId);
      // A call answered meanwhile must not be replaced by this one.
      if (!mountedRef.current || store.get(callEmbedAtom)) {
        await cleanupCreatedAgentCall(mx, roomId, agent.userId);
        return false;
      }
      startCall(room, { microphone: true, video: false, sound: true });
      return true;
    } catch (callError) {
      if (roomId) await cleanupCreatedAgentCall(mx, roomId, agent.userId);
      if (mountedRef.current) {
        setError(callError instanceof Error ? callError.message : 'Failed to start the call.');
      }
      return false;
    } finally {
      store.set(agentCallStartingAtom, false);
    }
  };

  return { startAgentCall, loading, error, unavailableReason };
}
