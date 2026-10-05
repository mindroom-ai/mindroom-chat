import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const unavailable = !livekitSupported || !rtcSupported || !!callEmbed;
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
    if (loading || unavailable) return false;
    setLoading(true);
    setError(undefined);

    let roomId: string | undefined;
    let callStarted = false;
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
      if (!mountedRef.current) {
        await cleanupCreatedAgentCall(mx, roomId, agent.userId);
        return false;
      }
      setLoading(false);
      startCall(room, { microphone: true, video: false, sound: true });
      callStarted = true;
      return true;
    } catch (callError) {
      if (roomId && !callStarted) await cleanupCreatedAgentCall(mx, roomId, agent.userId);
      if (!mountedRef.current) return false;
      setError(callError instanceof Error ? callError.message : 'Failed to start the call.');
      setLoading(false);
      return false;
    }
  };

  return { startAgentCall, loading, error, unavailableReason };
}
