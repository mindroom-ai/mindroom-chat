import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, color, Icon, Icons, Spinner, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { webRTCSupported } from '../../utils/rtc';
import { useCloseUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  cleanupCreatedAgentCall,
  createAgentVoiceRoom,
  hasMindroomVoiceCallsPresence,
  waitForJoinedRoom,
} from './agentCall';
import { requestMicrophoneAccess } from '../voice/microphoneAccess';

type AgentCallButtonProps = {
  userId: string;
  displayName?: string;
  presenceStatus?: string;
};

export function AgentCallButton({ userId, displayName, presenceStatus }: AgentCallButtonProps) {
  const mx = useMatrixClient();
  const { createRoom } = useClientConfig();
  const startCall = useCallStart(false);
  const callEmbed = useCallEmbed();
  const livekitSupported = useLivekitSupport();
  const rtcSupported = webRTCSupported();
  const { navigateRoom } = useRoomNavigate();
  const closeUserRoomProfile = useCloseUserRoomProfile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (
    !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined) ||
    !hasMindroomVoiceCallsPresence(presenceStatus)
  ) {
    return null;
  }

  const unavailable = !livekitSupported || !rtcSupported || !!callEmbed;
  const unavailableReason = !livekitSupported
    ? 'Your homeserver does not support calling.'
    : !rtcSupported
    ? 'Your browser does not support WebRTC.'
    : callEmbed
    ? 'End your current call first.'
    : undefined;

  const handleCall = async () => {
    if (loading || unavailable) return;
    setLoading(true);
    setError(undefined);

    let roomId: string | undefined;
    try {
      await requestMicrophoneAccess();
      if (!mountedRef.current) return;

      roomId = await createAgentVoiceRoom(
        mx,
        userId,
        displayName,
        createRoom?.defaultEncryption ?? true
      );
      if (!mountedRef.current) {
        await cleanupCreatedAgentCall(mx, roomId, userId);
        return;
      }
      const room = await waitForJoinedRoom(mx, roomId);
      if (!mountedRef.current) {
        await cleanupCreatedAgentCall(mx, roomId, userId);
        return;
      }
      setLoading(false);
      startCall(room, { microphone: true, video: false, sound: true });
      navigateRoom(roomId);
      closeUserRoomProfile();
    } catch (callError) {
      if (roomId) await cleanupCreatedAgentCall(mx, roomId, userId);
      if (!mountedRef.current) return;
      setError(callError instanceof Error ? callError.message : 'Failed to start the call.');
      setLoading(false);
    }
  };

  return (
    <Box direction="Column" gap="100" shrink="No">
      <Button
        size="300"
        variant="Primary"
        fill="Soft"
        radii="300"
        before={
          loading ? (
            <Spinner variant="Primary" fill="Soft" size="100" />
          ) : (
            <Icon size="50" src={Icons.Phone} filled />
          )
        }
        onClick={handleCall}
        disabled={loading || unavailable}
        title={unavailableReason}
      >
        <Text size="B300">Call</Text>
      </Button>
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {error}
        </Text>
      )}
    </Box>
  );
}
