import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Relations, Room } from 'matrix-js-sdk';
import { Box, IconButton, Icons, Text } from 'folds';
import { Modal } from '../../ui/glass/GlassPrimitives';
import { MenuEntry } from '../../ui/MenuEntry';
import { ModalLayer } from '../../ui/ModalLayer';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRelevantImagePacks } from '../../emoji/useImagePacks';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { ImageUsage } from '../../emoji/custom/types';
import { type RecentEmoji, useRecentEmoji } from '../../emoji/useRecentEmoji';
import { ReactionViewer } from './reaction-viewer/ReactionViewer';
import * as css from '../styles.css';

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
  imagePackRooms: Room[];
  /** Called with the chosen emoji; custom emoji come from the packs of `imagePackRooms`. */
  onReaction: ReactionHandler;
}) {
  const client = useMatrixClient();
  // Custom emoji load through authenticated media when the server supports it.
  const authenticatedMedia = useMediaAuthentication();
  const packs = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms);
  const recent = useRecentEmoji(client, QUICK_REACTION_COUNT, packs);

  if (recent.length === 0) return null;

  return (
    <Box alignItems="Center" justifyContent="Center" gap="200" style={{ padding: '0.25rem' }}>
      {recent.map((emoji) => {
        if (isCustomEmoji(emoji)) {
          const src =
            client.mxcUrlToHttp(
              emoji.url,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              authenticatedMedia
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
  return (
    <ModalLayer
      open={open}
      onClose={onDismiss}
      focus={{ initialFocus: false, returnFocusOnDeactivate: false }}
    >
      <Modal size="300" variant="Surface">
        <ReactionViewer requestClose={onDismiss} relations={relations} room={room} />
      </Modal>
    </ModalLayer>
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
      <MenuEntry
        label={t('mindroomUi.messages.messageReactionActions.viewReactions')}
        icon={Icons.Smile}
        aria-haspopup="dialog"
        aria-pressed={viewing}
        onSelect={() => setViewing(true)}
      />
    </>
  );
}
