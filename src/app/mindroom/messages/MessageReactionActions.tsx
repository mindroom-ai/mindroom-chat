import React, { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Relations, Room } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import { Box, Icon, IconButton, Icons, Overlay, OverlayBackdrop, OverlayCenter, Text } from 'folds';
import { MenuItem, Modal } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRelevantImagePacks } from '../../hooks/useImagePacks';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageUsage } from '../../plugins/custom-emoji';
import { getRecentEmojis } from '../../plugins/recent-emoji';
import { useRecentEmoji } from '../../hooks/useRecentEmoji';
import { ReactionViewer } from '../../features/room/reaction-viewer';
import * as css from '../../features/room/message/styles.css';

const QUICK_REACTION_COUNT = 4;

/** Called with the reaction key (Unicode emoji or mxc URL) and a custom emoji's shortcode. */
export type ReactionHandler = (key: string, shortcode?: string) => void;

type QuickReactionProps = {
  label: string;
  onSelect: () => void;
  children: ReactNode;
};

function QuickReaction({ label, onSelect, children }: QuickReactionProps) {
  return (
    <IconButton
      className={css.MessageQuickReaction}
      size="300"
      radii="300"
      variant="SurfaceVariant"
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      {children}
    </IconButton>
  );
}

type RecentEmoji = ReturnType<typeof getRecentEmojis>[number];

const isCustomEmoji = (emoji: RecentEmoji): emoji is Extract<RecentEmoji, { url: string }> =>
  typeof (emoji as { url?: unknown }).url === 'string';

const unicodeEmojiName = (emoji: RecentEmoji): string => {
  const { label, shortcode, unicode } = emoji as {
    label?: string;
    shortcode?: string;
    unicode?: string;
  };
  return label ?? shortcode ?? unicode ?? '';
};

/** The user's most used emoji, Unicode and custom, as one-tap reactions. */
export function MessageQuickReactions({
  imagePackRooms,
  onReaction,
}: {







  const packs = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms);
  const recent = useRecentEmoji(mx, QUICK_REACTION_COUNT, packs);

  if (recent.length === 0) return null;

  return (
    <Box alignItems="Center" justifyContent="Center" gap="200" style={{ padding: '0.25rem' }}>
      {recent.map((emoji) => {
        if (isCustomEmoji(emoji)) {
          const src =
            mx.mxcUrlToHttp(
              emoji.url,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              useAuthentication
            ) ?? emoji.url;
          return (
            <QuickReaction
              key={emoji.url}
              label={emoji.shortcode}
              onSelect={() => onReaction(emoji.url, emoji.shortcode)}
            >
              <img
                src={src}
                alt={emoji.shortcode}
                style={{ width: '1.25rem', height: '1.25rem', objectFit: 'contain' }}
              />
            </QuickReaction>
          );
        }
        return (
          <QuickReaction
            key={(emoji as { unicode: string }).unicode}
            label={unicodeEmojiName(emoji)}
            onSelect={() => onReaction((emoji as { unicode: string }).unicode)}
          >
            <Text as="span" size="T400">
              {(emoji as { unicode: string }).unicode}
            </Text>
          </QuickReaction>
        );
      })}
    </Box>
  );
}

type ReactionsDialogProps = {
  room: Room;
  relations: Relations;
  open: boolean;
  onDismiss: () => void;
};

/** The modal reaction list. Focus stays where the menu put it when the dialog closes. */
function ReactionsDialog({ room, relations, open, onDismiss }: ReactionsDialogProps) {
  const trapOptions = {
    onDeactivate: onDismiss,
    initialFocus: false as const,
    escapeDeactivates: true,
    clickOutsideDeactivates: true,
    returnFocusOnDeactivate: false,
  };
  return (
    <Overlay backdrop={<OverlayBackdrop />} open={open}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={trapOptions}>
          <Modal size="300" variant="Surface">
            <ReactionViewer requestClose={onDismiss} relations={relations} room={room} />
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** "View reactions": every reaction on the message and who sent it. */
export function MessageAllReactionItem({
  room,
  relations,
  onClose,
}: {
  room: Room;
  relations: Relations;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState(false);

  // Leaving the viewer also closes the message menu it was opened from.
  const stopViewing = () => {
    setViewing(false);
    onClose?.();
  };

  return (
    <>
      <ReactionsDialog room={room} relations={relations} open={viewing} onDismiss={stopViewing} />
      <MenuItem
        aria-haspopup="dialog"
        aria-pressed={viewing}
        after={<Icon size="100" src={Icons.Smile} />}
        onClick={() => setViewing(true)}
        size="300"
        radii="300"
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          {t('mindroomUi.messages.messageReactionActions.viewReactions')}
        </Text>
      </MenuItem>
    </>
  );
}
