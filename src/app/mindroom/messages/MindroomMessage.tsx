import React, {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusWithin, useHover } from 'react-aria';
import FocusTrap from 'focus-trap-react';
import type { MatrixEvent, Relations, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  Text,
  type RectCords,
} from 'folds';
import {
  AvatarBase,
  BubbleLayout,
  CompactLayout,
  MessageBase,
  ModernLayout,
  Time,
  Username,
  UsernameBold,
} from '../../components/message';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { MessageLayout, type MessageSpacing } from '../../state/settings';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { MessageBugReportItem } from '../bug-reports/MessageBugReportItem';
import { useThreadPinning } from '../threads/useThreadPinning';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';
import { MindroomModelBadge } from './MindroomModelBadge';
import {
  getMindroomMessageCopyTextState,
  isCopyTextMessageContent,
  MindroomMessageExtensionShell,
  MindroomMessageHeaderExtensions,
  MindroomMessageMenuExtensions,
  useMindroomMessageExtensionState,
} from './messageExtensions';
import {
  getMessageCopyTexts,
  getMessageCopyTextSource,
  scanMindroomToolMarkerLines,
} from './messageCopyText';
import {
  MessageAllReactionItem,
  MessageQuickReactions,
  type ReactionHandler,
} from './MessageReactionActions';
import { MessageReadReceiptItem, MessageSourceCodeItem } from './MessageInspectionActions';
import * as css from '../../features/room/message/styles.css';

export type { ReactionHandler };
export {
  MessageAllReactionItem,
  MessageQuickReactions,
  MessageReadReceiptItem,
  MessageSourceCodeItem,
};

type MenuItemProps = {
  label: string;
  icon: Parameters<typeof Icon>[0]['src'];
  onClick: () => void;
  variant?: 'Critical';
  disabled?: boolean;
};

function MessageMenuAction({ label, icon, onClick, variant, disabled }: MenuItemProps) {
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={variant}
      disabled={disabled}
      after={<Icon size="100" src={icon} />}
      onClick={onClick}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );
}

/** "Copy Text": the message body, without the tool call markers MindRoom adds. */
export function MessageCopyTextItem({
  content,
  originalContent,
  resolvedContent,
  onClose,
}: {
  content: Record<string, unknown>;
  originalContent?: Record<string, unknown>;
  resolvedContent?: Record<string, unknown>;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const handleCopy = () => {
    const source = getMessageCopyTextSource(content, originalContent ?? content, resolvedContent);
    if (!source) return;
    const scan = scanMindroomToolMarkerLines(
      source.body,
      source.formattedBody,
      !source.formattedBody
    );
    void copyToClipboard(getMessageCopyTexts(source, scan).text);
    onClose?.();
  };
  return (
    <MessageMenuAction
      label={t('sharedUi.message.copyText')}
      icon={Icons.Text}
      onClick={handleCopy}
    />
  );
}

export function MessagePinItem({
  room,
  mEvent,
  onClose,
}: {
  room: Room;
  mEvent: MatrixEvent;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { pinnedEventIds, canPin, setPinned, updating } = useThreadPinning(room);
  const eventId = mEvent.getId();
  if (!eventId || !canPin) return null;
  const pinned = pinnedEventIds.includes(eventId);
  return (
    <MessageMenuAction
      label={pinned ? t('sharedUi.message.unpinMessage') : t('sharedUi.message.pinMessage')}
      icon={Icons.Pin}
      disabled={updating}
      onClick={() => {
        void setPinned(eventId, !pinned);
        onClose?.();
      }}
    />
  );
}

export function MessageDeleteItem({
  room,
  mEvent,
  onClose,
}: {
  room: Room;







  return (
    <MessageMenuAction
      label={t('sharedUi.message.delete')}
      icon={Icons.Delete}
      variant="Critical"
      onClick={() => {
        void mx.redactEvent(room.roomId, eventId);
        onClose?.();
      }}
    />
  );
}

export function MessageReportItem({
  room,
  mEvent,
  onClose,
}: {
  room: Room;







  return (
    <MessageMenuAction
      label={t('sharedUi.message.report')}
      icon={Icons.Warning}
      variant="Critical"
      onClick={() => {
        void mx.reportEvent(room.roomId, eventId, -100, '');
        onClose?.();
      }}
    />
  );
}

















  onReplyClick?: (evt: MouseEvent<HTMLButtonElement>, startThread?: boolean) => void;
  onReactionToggle?: ReactionHandler;






  /** Content after edits and long-text hydration, used by the controls. */
  resolvedMessageContent?: Record<string, unknown>;
  children?: ReactNode;
  'data-message-id'?: string;
};

const getAnchor = (evt: MouseEvent<HTMLElement>): RectCords => {
  const target = (evt.currentTarget.parentElement?.parentElement ??
    evt.currentTarget) as HTMLElement;
  const rect = target.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

/** One message in the timeline: avatar, sender, body, hover toolbar and context menu. */
export const Message = forwardRef<HTMLDivElement, MessageProps>(
  (
    {
      room,
      mEvent,
      collapse,






      imagePackRooms = [],
      relations,











      resolvedMessageContent,
      children,
      ...props
    },
    ref
  ) => {








    const setBaseRef = useCallback(
      (node: HTMLDivElement | null) => {
        baseRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    const eventId = mEvent.getId() ?? '';
    const senderId = mEvent.getSender() ?? '';
    const confirmed = isConfirmedMatrixEventId(eventId);
    const content = useMemo(
      () => resolvedMessageContent ?? (mEvent.getContent() as Record<string, unknown>),
      [mEvent, resolvedMessageContent]
    );
    const extensionState = useMindroomMessageExtensionState(content, !!menuAnchor, mEvent);
    const copyState = getMindroomMessageCopyTextState(extensionState);
    const closeMenu = () => setMenuAnchor(undefined);

    const senderDisplayName =
      getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
    const avatarMxc = getMemberAvatarMxc(room, senderId);
    const avatarUrl = avatarMxc
      ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
      : undefined;

    const renderAvatar = (withModel: boolean) => {
      const avatar = (
        <Avatar size="300" data-user-id={senderId} onClick={onUserClick as never}>
          <UserAvatar







      if (!withModel || !extensionState.aiRunInfo) return <AvatarBase>{avatar}</AvatarBase>;
      return (
        <AvatarBase>
          <div className={css.MessageAvatarWithModel}>
            {avatar}
            <MindroomModelBadge info={extensionState.aiRunInfo} />
          </div>
        </AvatarBase>
      );
    };

    const renderBody = (controls?: { open: boolean; openDetails: () => void }) => {
      const openAiRun = () => {
        closeMenu();
        controls?.openDetails();
      };
      const header = (
        <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
          <Box alignItems="Center" gap="200">
            <Username as="button" data-user-id={senderId} onClick={onUsernameClick}>
              <Text as="span" size="T400" truncate>
                <UsernameBold>{senderDisplayName}</UsernameBold>
              </Text>
            </Username>
            <MindroomMessageHeaderExtensions controls={controls as never} onOpenAiRun={openAiRun} />
          </Box>
          <Time








        <>
          {reply}
          {children}
          {reactions}
        </>
      );
      const menu = menuAnchor && (
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: () => {
              closeMenu();
              return true;
            },
            escapeDeactivates: () => {
              closeMenu();
              return true;
            },
          }}
        >
          <Menu>
            <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
              {canSendReaction && confirmed && onReactionToggle && (
                <MessageQuickReactions
                  imagePackRooms={imagePackRooms}
                  onReaction={(key, shortcode) => {
                    onReactionToggle(key, shortcode);
                    closeMenu();
                  }}
                />
              )}
              {confirmed && relations && (
                <MessageAllReactionItem room={room} relations={relations} onClose={closeMenu} />
              )}
              {confirmed && onReplyClick && (
                <MessageMenuAction
                  label={t('sharedUi.message.reply')}
                  icon={Icons.ReplyArrow}
                  onClick={() => {
                    onReplyClick({ currentTarget: baseRef.current } as never);
                    closeMenu();
                  }}
                />
              )}
              {confirmed && onReplyClick && (
                <MessageMenuAction
                  label={t('sharedUi.message.replyInThread')}
                  icon={Icons.ThreadPlus}
                  onClick={() => {
                    onReplyClick({ currentTarget: baseRef.current } as never, true);
                    closeMenu();
                  }}
                />
              )}
              {canSendReaction && confirmed && (
                <MessageMenuAction
                  label={t('sharedUi.message.addReaction')}
                  icon={Icons.SmilePlus}
                  onClick={closeMenu}
                />
              )}
              {copyState.visible || isCopyTextMessageContent(content) ? (
                <MessageCopyTextItem
                  content={content}
                  originalContent={mEvent.getContent()}
                  resolvedContent={copyState.resolvedContent}
                  onClose={closeMenu}
                />
              ) : null}
              {confirmed && (
                <MessageMenuAction
                  label={t('sharedUi.message.copyLink')}
                  icon={Icons.Link}
                  onClick={() => {
                    void copyToClipboard(
                      getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room))
                    );
                    closeMenu();
                  }}
                />
              )}
              {confirmed && canPinEvent && (
                <MessagePinItem room={room} mEvent={mEvent} onClose={closeMenu} />
              )}
              <MindroomMessageMenuExtensions
                controls={controls as never}
                state={extensionState}
                onClose={closeMenu}
                onOpenAiRun={openAiRun}
              />
              {!hideReadReceipts && confirmed && (




              {confirmed && canDelete && (
                <MessageDeleteItem room={room} mEvent={mEvent} onClose={closeMenu} />
              )}
              {confirmed && senderId !== mx.getUserId() && (
                <MessageReportItem room={room} mEvent={mEvent} onClose={closeMenu} />
              )}
            </Box>
          </Menu>
        </FocusTrap>
      );





                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('sharedUi.message.addReaction')}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => setMenuAnchor(getAnchor(evt))}
                >
                  <Icon src={Icons.SmilePlus} size="100" />
                </IconButton>
              )}
              {confirmed && onReplyClick && (
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('sharedUi.message.reply')}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => onReplyClick(evt)}
                >
                  <Icon src={Icons.ReplyArrow} size="100" />
                </IconButton>
              )}
              {confirmed && onReplyClick && (
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('sharedUi.message.replyInThread')}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => onReplyClick(evt, true)}
                >
                  <Icon src={Icons.ThreadPlus} size="100" />
                </IconButton>
              )}
              <PopOut anchor={menuAnchor} position="Bottom" align="End" offset={4} content={menu}>
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('sharedUi.message.moreOptions')}
                  aria-pressed={!!menuAnchor}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => setMenuAnchor(getAnchor(evt))}
                >
                  <Icon src={Icons.VerticalDots} size="100" />
                </IconButton>
              </PopOut>
            </Box>
          </Menu>
        </div>
      );

      const layout =
        messageLayout === MessageLayout.Compact ? (
          <CompactLayout before={header}>{body}</CompactLayout>
        ) : messageLayout === MessageLayout.Bubble ? (
          <BubbleLayout before={renderAvatar(true)} header={!collapse && header}>
            {body}
          </BubbleLayout>
        ) : (
          <ModernLayout before={collapse ? undefined : renderAvatar(true)}>
            {!collapse && header}
            {body}
          </ModernLayout>
        );

      return (
        <MessageBase
          ref={setBaseRef}
          className={css.MessageBase}
          tabIndex={0}



          selected={!!menuAnchor || edit}
          {...props}




          {layout}
        </MessageBase>
      );
    };

    return (
      <MindroomMessageExtensionShell state={extensionState} forwardedRef={baseRef}>














  children?: ReactNode;
  'data-message-id'?: string;
};

/** A state or membership event: a single compact line without a sender header. */
export const Event = forwardRef<HTMLDivElement, EventProps>(
  (
    {
      room,
      mEvent,






      ...props
    },
    ref
  ) => {
    void room;
    void canDelete;
    void hideReadReceipts;
    void showDeveloperTools;
    return (
      <MessageBase
        ref={ref}
        className={css.MessageBase}
        autoCollapse



        {...props}
      >
        {children}
      </MessageBase>
    );
  }
);
