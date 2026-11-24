import { useMemo, type MouseEventHandler } from 'react';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { isUserId } from '../../lib/matrixIds';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useSpaceOptionally } from '../../matrix/hooks/useSpace';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../messages/html/react-custom-html-parser';
import { useMentionClickHandler } from '../../messages/useMentionClickHandler';
import { useOpenUserRoomProfile } from '../../navigation/useUserRoomProfileState';
import { shouldShowLinkFavicons } from '../../rich-text/linkFaviconPolicy';

export type RoomMessageRenderers = {
  encrypted: boolean;
  showUrlPreview: boolean;
  handleMentionClick: MouseEventHandler<HTMLElement>;
  linkifyOpts: LinkifyOpts;
  htmlReactParserOptions: HTMLReactParserOptions;
  openSenderProfile: MouseEventHandler<HTMLElement>;
};

type UseRoomMessageRenderersOptions = {
  client: MatrixClient;
  roomId: string;
  mediaAutoLoad: boolean;
  urlPreview: boolean;
  encUrlPreview: boolean;
};

/**
 * Memoized per-room linkify, mention, HTML parser, URL preview, and sender profile handlers for
 * timeline rows. Reused for both the viewed room and any cross-room fork prefix rooms, cached per
 * room ID (and encryption state) while the shared inputs stay stable so cross-room rows do not
 * allocate fresh parser options on every render.
 */
export const useRoomMessageRenderers = ({
  client,
  roomId,
  mediaAutoLoad,
  urlPreview,
  encUrlPreview,
}: UseRoomMessageRenderersOptions): ((targetRoom: Room) => RoomMessageRenderers) => {
  const useAuthentication = useMediaAuthentication();
  // Matrix permalinks in a message open in the app: a person's profile card, or the room and
  // event (its thread, where the room shows threads) instead of matrix.to in a new tab.
  const baseMentionClick = useMentionClickHandler(roomId);
  const openUserProfile = useOpenUserRoomProfile();
  const spaceRoomId = useSpaceOptionally()?.roomId;

  return useMemo(() => {
    const cache = new Map<string, RoomMessageRenderers>();
    return (targetRoom: Room): RoomMessageRenderers => {
      const targetRoomId = targetRoom.roomId;
      // Encrypted rooms preview links only when the user allows it and never fetch site favicons.
      const encrypted = !!targetRoom.hasEncryptionStateEvent?.();
      const cached = cache.get(targetRoomId);
      if (cached && cached.encrypted === encrypted) return cached;

      const showUrlPreview = Boolean(encrypted ? encUrlPreview : urlPreview);
      const showLinkFavicons = shouldShowLinkFavicons({ mediaAutoLoad, urlPreview }, encrypted);
      const handleMentionClick: MouseEventHandler<HTMLElement> =
        targetRoomId === roomId
          ? baseMentionClick
          : (evt) => {
              const mentionId = evt.currentTarget.getAttribute('data-mention-id');
              if (mentionId && isUserId(mentionId)) {
                evt.preventDefault();
                openUserProfile(
                  targetRoomId,
                  spaceRoomId,
                  mentionId,
                  evt.currentTarget.getBoundingClientRect()
                );
                return;
              }
              baseMentionClick(evt);
            };
      const linkifyOpts: LinkifyOpts = {
        ...LINKIFY_OPTS,
        render: factoryRenderLinkifyWithMention(
          (href) =>
            renderMatrixMention(
              client,
              targetRoomId,
              href,
              makeMentionCustomProps(handleMentionClick)
            ),
          showLinkFavicons
        ),
      };
      const htmlReactParserOptions = getReactCustomHtmlParser(client, targetRoomId, {
        linkifyOpts,
        handleMentionClick,
        useAuthentication,
        showLinkFavicons,
      });
      // The avatar or the name of a message opens the sender's profile card beside it.
      const openSenderProfile: MouseEventHandler<HTMLElement> = (evt) => {
        const senderId = evt.currentTarget.getAttribute('data-user-id');
        if (!senderId) return;
        evt.stopPropagation();
        openUserProfile(
          targetRoomId,
          spaceRoomId,
          senderId,
          evt.currentTarget.getBoundingClientRect()
        );
      };

      const built: RoomMessageRenderers = {
        encrypted,
        showUrlPreview,
        handleMentionClick,
        linkifyOpts,
        htmlReactParserOptions,
        openSenderProfile,
      };
      cache.set(targetRoomId, built);
      return built;
    };
  }, [
    baseMentionClick,
    client,
    encUrlPreview,
    mediaAutoLoad,
    openUserProfile,
    roomId,
    spaceRoomId,
    urlPreview,
    useAuthentication,
  ]);
};
