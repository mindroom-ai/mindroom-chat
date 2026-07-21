import React, { useCallback, useState } from 'react';
import { Box, Button, color, Icon, Icons, Spinner, Text } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import * as css from './styles.css';
import { ChatButton, ControlDivider, MicrophoneButton, SoundButton, VideoButton } from './Controls';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import {
  CALL_ROOM_RETIRED_USER_MESSAGE,
  attemptCallStart,
  useCallEmbed,
  useCallJoined,
  useCallStart,
} from '../../hooks/useCallEmbed';
import { isCallRoomRetired } from '../../plugins/call';
import { useCallPreferences } from '../../state/hooks/callPreferences';

type PrescreenControlsProps = {
  canJoin?: boolean;
};
export function PrescreenControls({ canJoin }: PrescreenControlsProps) {
  const room = useRoom();
  const callEmbed = useCallEmbed();
  const callJoined = useCallJoined(callEmbed);
  const direct = useIsDirectRoom();
  const [startRefusal, setStartRefusal] = useState<string>();

  const inOtherCall = callEmbed && callEmbed.roomId !== room.roomId;
  // A retired room's post-call teardown already started; joining can never
  // succeed there, so refuse proactively instead of only failing on click.
  const retired = isCallRoomRetired(room.roomId);

  const startCall = useCallStart(direct);
  const joining = callEmbed?.roomId === room.roomId && !callJoined;

  const disabled = inOtherCall || !canJoin || retired;
  const refusalMessage = startRefusal ?? (retired ? CALL_ROOM_RETIRED_USER_MESSAGE : undefined);

  const { microphone, video, sound, toggleMicrophone, toggleVideo, toggleSound } =
    useCallPreferences();

  const handleMicrophoneToggle = useCallback(async () => toggleMicrophone(), [toggleMicrophone]);
  const handleVideoToggle = useCallback(async () => toggleVideo(), [toggleVideo]);

  const handleJoin = useCallback(() => {
    // The room can be retired between render and click; the click handler
    // must consume the refusal and tell the user why nothing started.
    setStartRefusal(attemptCallStart(() => startCall(room, { microphone, video, sound })));
  }, [startCall, room, microphone, video, sound]);

  return (
    <SequenceCard
      className={css.ControlCard}
      variant="SurfaceVariant"
      gap="400"
      radii="500"
      alignItems="Center"
      justifyContent="SpaceBetween"
      wrap="Wrap"
    >
      <Box shrink="No" alignItems="Inherit" justifyContent="SpaceBetween" gap="200">
        <MicrophoneButton enabled={microphone} onToggle={handleMicrophoneToggle} />
        <SoundButton enabled={sound} onToggle={toggleSound} />
      </Box>
      <ControlDivider />
      <Box shrink="No" alignItems="Inherit" justifyContent="SpaceBetween" gap="200">
        <VideoButton enabled={video} onToggle={handleVideoToggle} />
        <ChatButton />
      </Box>
      <Box grow="Yes" direction="Column" gap="100">
        <Button
          variant={disabled ? 'Secondary' : 'Success'}
          fill={disabled ? 'Soft' : 'Solid'}
          onClick={handleJoin}
          disabled={disabled || joining}
          before={
            joining ? (
              <Spinner variant="Success" fill="Solid" size="200" />
            ) : (
              <Icon src={Icons.Phone} size="200" filled />
            )
          }
        >
          <Text size="B400">Join</Text>
        </Button>
        {refusalMessage && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {refusalMessage}
          </Text>
        )}
      </Box>
    </SequenceCard>
  );
}
