import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { ForkIcon } from '../../messages/ForkIcon';
import * as toolbarCss from '../../messages/styles.css';
import { revealDirectionControls } from '../../ui/directional';
import { ExpandIcon, ShrinkIcon } from '../../ui/panels/panelIcons';
import { ThreadBannerBackButton } from '../ThreadBannerChrome';
import * as bannerCss from '../ThreadContextBanner.css';
import { targetHasUnsharedAgents } from './ForkToRoomDialog';

function CrossRoomAgentWarning({ sourceRoom, targetRoom }: { sourceRoom: Room; targetRoom: Room }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const sourceMembers = useRoomMembers(client, sourceRoom.roomId);
  const targetMembers = useRoomMembers(client, targetRoom.roomId);
  const showAgentWarning = useMemo(
    () => targetHasUnsharedAgents(sourceMembers, targetMembers),
    [sourceMembers, targetMembers]
  );
  if (!showAgentWarning) return null;
  const sourceRoomName = revealDirectionControls(sourceRoom.name || sourceRoom.roomId);
  return (
    <Box alignItems="Center" gap="200" data-cross-room-fork-agent-warning="true">
      <Icon size="50" src={Icons.Warning} aria-hidden="true" />
      <Text size="T200">{t('threadFork.forkDraftAgentWarning', { room: sourceRoomName })}</Text>
    </Box>
  );
}

/**
 * Read-only draft header banner shown over an unsent same-room or cross-room fork draft: marks the
 * draft state, explains that sending creates the thread when composing is allowed, offers Back and
 * column layout controls, and warns across rooms when target agents cannot see the source room.
 */
export function CrossRoomForkDraftBanner({
  sourceRoom,
  targetRoom,
  canCompose = true,
  onBack,
  onShowBeside,
  onShowFull,
}: {
  sourceRoom: Room;
  targetRoom: Room;
  canCompose?: boolean;
  onBack?: () => void;
  onShowBeside?: () => void;
  onShowFull?: () => void;
}) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const isCrossRoom = sourceRoom.roomId !== targetRoom.roomId;
  const sourceRoomName = revealDirectionControls(sourceRoom.name || sourceRoom.roomId);
  const targetRoomName = revealDirectionControls(targetRoom.name || targetRoom.roomId);
  const layoutAction = onShowBeside
    ? { label: t('thread.showBeside'), icon: ShrinkIcon, onClick: onShowBeside }
    : onShowFull
      ? { label: t('thread.showFull'), icon: ExpandIcon, onClick: onShowFull }
      : undefined;

  return (
    <div
      className={bannerCss.BannerForkDraft}
      data-fork-draft-banner="true"
      data-cross-room-fork-banner={isCrossRoom ? 'true' : undefined}
    >
      <Box direction="Column" gap="100">
        <Box alignItems="Center" gap="200" style={{ minWidth: 0 }}>
          {onBack && (
            <ThreadBannerBackButton phone={phone} shortcut="leaveThread" onBack={onBack} />
          )}
          <Icon size="100" src={ForkIcon} aria-hidden="true" />
          <Text size="H5" truncate style={{ minWidth: 0 }}>
            {isCrossRoom
              ? t('threadFork.forkingFromRoom', { room: sourceRoomName })
              : t('threadFork.forkingThread')}
          </Text>
          <span className={bannerCss.ForkDraftBadge}>{t('threadFork.draftBadge')}</span>
          {layoutAction && (
            <IconButton
              className={toolbarCss.MessageOptionsButton}
              variant="Warning"
              fill="None"
              aria-label={layoutAction.label}
              onClick={layoutAction.onClick}
              style={{ marginInlineStart: 'auto' }}
            >
              <Icon size="100" src={layoutAction.icon} />
            </IconButton>
          )}
        </Box>
        {canCompose && (
          <Text size="T200" className={bannerCss.ForkDraftHint}>
            {isCrossRoom
              ? t('threadFork.forkDraftHintInRoom', { room: targetRoomName })
              : t('threadFork.forkDraftHint')}
          </Text>
        )}
        {isCrossRoom && <CrossRoomAgentWarning sourceRoom={sourceRoom} targetRoom={targetRoom} />}
      </Box>
    </div>
  );
}
