import { useCallback, useState } from 'react';
import { Avatar, Box, Icon, Icons, Scroll, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { Header, IconButton, MenuItem } from '../../ui/glass/GlassPrimitives';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRelations } from '../../matrix/hooks/useRelations';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../matrix/matrix';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';

type ReactionViewerProps = {
  room: Room;
  relations: Relations;
  requestClose: () => void;
};

type ReactionGroup = [key: string, events: MatrixEvent[]];

const getReactionGroups = (relations: Relations): ReactionGroup[] =>
  (relations.getSortedAnnotationsByKey() ?? []).map(([key, events]) => [key, [...events]]);

function SenderRow({ room, userId }: { room: Room; userId: string }) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const avatarMxc = getMemberAvatarMxc(room, userId);
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 64, 64, 'crop') ?? undefined
    : undefined;
  const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

  return (
    <Box gap="200" alignItems="Center">
      <Avatar radii="400" size="200">
        <UserAvatar
          alt={name}
          userId={userId}
          src={avatarSrc}
          renderFallback={() => <Icon filled size="50" src={Icons.User} />}
        />
      </Avatar>
      <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
        <Text size="T300" truncate>
          {name}
        </Text>
        {name !== userId && (
          <Text size="T200" priority="300" truncate {...ownDirectionLine}>
            {userId}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/** Who reacted to a message, one reaction at a time. */
export function ReactionViewer({ room, relations, requestClose }: ReactionViewerProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const groups = useRelations(relations, useCallback(getReactionGroups, []));
  const [selectedKey, setSelectedKey] = useState<string>();

  const selected = groups.find(([key]) => key === selectedKey) ?? groups[0];
  // A key or shortcode is any text its sender chose: it shows its direction controls.
  const selectedShortcode = selected
    ? revealDirectionControls(
        (selected[1][0]?.getContent().shortcode as string | undefined) ?? selected[0]
      )
    : undefined;
  const senders = selected
    ? [...new Set(selected[1].map((event) => event.getSender()).filter((id): id is string => !!id))]
    : [];

  const renderKey = (key: string) => {
    const src = key.startsWith('mxc://')
      ? mxcUrlToHttp(client, key, authenticatedMedia)
      : undefined;
    return src ? (
      <img
        src={src}
        alt={revealDirectionControls(key)}
        style={{ width: '1.25em', height: '1.25em', objectFit: 'contain' }}
      />
    ) : (
      <Text as="span" size="Inherit">
        {revealDirectionControls(key)}
      </Text>
    );
  };

  return (
    <Box direction="Column" style={{ maxHeight: '75vh' }}>
      <Header
        size="500"
        style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
      >
        <Box grow="Yes" style={{ minWidth: 0 }}>
          {selectedShortcode && (
            <Text size="H4" truncate>
              {t('featureUi.room.reactionViewer.reactedWith', { shortcode: selectedShortcode })}
            </Text>
          )}
        </Box>
        <IconButton
          size="300"
          radii="300"
          onClick={requestClose}
          aria-label={t('featureUi.room.membersDrawer.close')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      {groups.length > 0 && (
        <Box grow="Yes" style={{ minHeight: 0 }}>
          <Scroll size="300" hideTrack visibility="Hover">
            <Box direction="Column" gap="100" style={{ padding: config.space.S200 }} role="tablist">
              {groups.map(([key, events]) => (
                <MenuItem
                  key={key}
                  size="300"
                  radii="300"
                  variant="Primary"
                  fill={key === selected?.[0] ? 'Soft' : 'None'}
                  role="tab"
                  aria-selected={key === selected?.[0]}
                  onClick={() => setSelectedKey(key)}
                  before={renderKey(key)}
                >
                  <Text as="span" size="T300">
                    {events.length}
                  </Text>
                </MenuItem>
              ))}
            </Box>
          </Scroll>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Scroll size="300" hideTrack visibility="Hover">
              <Box
                direction="Column"
                gap="200"
                style={{ padding: config.space.S300 }}
                role="tabpanel"
              >
                {senders.map((userId) => (
                  <SenderRow key={userId} room={room} userId={userId} />
                ))}
              </Box>
            </Scroll>
          </Box>
        </Box>
      )}
    </Box>
  );
}
