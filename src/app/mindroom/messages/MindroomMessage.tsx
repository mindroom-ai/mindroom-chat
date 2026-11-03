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
import { Trans, useTranslation } from 'react-i18next';
import { useFocusWithin, useHover } from 'react-aria';
import FocusTrap from 'focus-trap-react';
import type { MatrixEvent, Relations, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Text,
  color,
  config,
  type RectCords,
} from 'folds';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { EmojiBoard } from '../../components/emoji-board';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
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
import { getSenderNameTone } from './senderNameTone';
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
import * as copyCss from './MessageCopyActions.css';

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

type InlineEditorProps = {
  room: Room;
  mEvent: MatrixEvent;
  /** What the row shows now; the edit starts from its body. */
  content: Record<string, unknown>;
  /** Closes the editor, after a saved edit or on cancel. */
  onDone: () => void;
};

/** Edits a text message in place and sends the edit as an `m.replace` event. */
function MessageInlineEditor({ room, mEvent, content, onDone }: InlineEditorProps) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const [text, setText] = useState(typeof content.body === 'string' ? content.body : '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const eventId = mEvent.getId();
  const save = async () => {
    const body = text.trim();
    if (!eventId || !body) return;
    setBusy(true);
    setFailed(false);
    const msgtype = typeof content.msgtype === 'string' ? content.msgtype : 'm.text';
    try {
      await mx.sendMessage(room.roomId, mEvent.threadRootId ?? null, {
        msgtype,
        body: `* ${body}`,
        'm.new_content': { msgtype, body },
        'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
      } as never);
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <Box direction="Column" gap="200">
      <textarea
        aria-label={t('mindroomUi.messages.mindroomMessage.editMessage')}
        placeholder={t('featureUi.room.message.messageEditor.editMessage')}
        value={text}
        disabled={busy}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        style={{ width: '100%', font: 'inherit', resize: 'vertical' }}
        onChange={(evt) => setText(evt.target.value)}
        onKeyDown={(evt) => {
          if (evt.key === 'Escape') onDone();
          if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            void save();
          }
        }}
      />
      {failed && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('threadActions.failed')}
        </Text>
      )}
      <Box gap="200">
        <Button
          type="button"
          size="300"
          variant="Primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <Text size="B300">{t('featureUi.room.message.messageEditor.save')}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          variant="Secondary"
          fill="Soft"
          disabled={busy}
          onClick={onDone}
        >
          <Text size="B300">{t('featureUi.room.message.messageEditor.cancel')}</Text>
        </Button>
      </Box>
    </Box>
  );
}

/** A small modal for the message actions that need a confirmation or a reason. */
function MessageActionDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  reasonLabel,
  error,
  done,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  reasonLabel?: string;
  error?: string;
  done?: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            escapeDeactivates: () => {
              if (!busy) onClose();
              return !busy;
            },
            clickOutsideDeactivates: () => {
              if (!busy) onClose();
              return !busy;
            },
          }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={{ padding: '1rem', width: 'min(26rem, calc(100vw - 2rem))' }}
          >
            <Box direction="Column" gap="300">
              <Text size="H4">{title}</Text>
              <Text size="T300">{description}</Text>
              {reasonLabel && (
                <input
                  aria-label={reasonLabel}
                  placeholder={reasonLabel}
                  value={reason}
                  disabled={busy}
                  onChange={(evt) => setReason(evt.target.value)}
                />
              )}
              {error && (
                <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                  {error}
                </Text>
              )}
              {done && (
                <Text role="status" size="T200" style={{ color: color.Success.Main }}>
                  {done}
                </Text>
              )}
              <Box justifyContent="End" gap="200">
                <Button
                  type="button"
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  disabled={busy}
                  onClick={onClose}
                >
                  <Text size="B300">{t('threadActions.cancel')}</Text>
                </Button>
                {!done && (
                  <Button
                    type="button"
                    size="300"
                    variant="Critical"
                    disabled={busy}
                    onClick={() => onConfirm(reason.trim())}
                  >
                    <Text size="B300">{busy ? busyLabel : confirmLabel}</Text>
                  </Button>
                )}
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

const isCoarsePointer = (): boolean =>
  globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * "Copy Text": the message body, without the tool call markers MindRoom adds. A reply with tool
 * calls also offers its text with each call written out, as an icon beside the item, or as a
 * labelled row of its own on touch screens. While a long text loads, the item waits for it.
 */
export function MessageCopyTextItem({
  content,
  originalContent,
  resolvedContent,
  loading = false,
  onClose,
}: {
  content: Record<string, unknown>;
  originalContent?: Record<string, unknown>;
  resolvedContent?: Record<string, unknown>;
  loading?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const texts = useMemo(() => {
    if (loading) return undefined;
    const source = getMessageCopyTextSource(content, originalContent ?? content, resolvedContent);
    if (!source) return undefined;
    const scan = scanMindroomToolMarkerLines(
      source.body,
      source.formattedBody,
      source.plainBodyFallback
    );
    return getMessageCopyTexts(source, scan);
  }, [content, loading, originalContent, resolvedContent]);
  const handleCopy = async (text: string | undefined) => {
    if (text === undefined) return;
    const copied = await copyToClipboard(text);
    setFailed(!copied);
    if (copied) onClose?.();
  };

  let label = t('mindroomUi.messages.messageCopyActions.copyText');
  if (failed) label = t('threadActions.failed');
  else if (loading) label = t('mindroomUi.messages.messageCopyActions.copyTextLoading');
  const copyText = (
    <MessageMenuAction
      label={label}
      icon={failed ? Icons.Warning : Icons.Text}
      variant={failed ? 'Critical' : undefined}
      disabled={loading}
      onClick={() => void handleCopy(texts?.text)}
    />
  );
  const withToolCalls = texts?.textWithToolCalls;
  if (withToolCalls === undefined) return copyText;

  const withToolCallsLabel = t('mindroomUi.messages.messageCopyActions.copyTextWithToolCalls');
  if (isCoarsePointer()) {
    return (
      <>
        {copyText}
        <MessageMenuAction
          label={withToolCallsLabel}
          icon={Icons.Terminal}
          onClick={() => void handleCopy(withToolCalls)}
        />
      </>
    );
  }
  return (
    <Box alignItems="Center" gap="100">
      <Box grow="Yes" direction="Column">
        {copyText}
      </Box>
      <Line
        className={copyCss.CopyActionDivider}
        direction="Vertical"
        variant="Surface"
        size="300"
      />
      <IconButton
        size="300"
        radii="300"
        variant="Surface"
        aria-label={withToolCallsLabel}
        title={withToolCallsLabel}
        onClick={() => void handleCopy(withToolCalls)}
      >
        <Icon size="100" src={Icons.Terminal} />
      </IconButton>
    </Box>
  );
}

/** "Copy Link": a matrix.to permalink of the message. */
export function MessageCopyLinkItem({
  room,
  eventId,
  onClose,
}: {
  room: Room;
  eventId: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const handleCopy = async () => {
    const copied = await copyToClipboard(
      getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room))
    );
    setFailed(!copied);
    if (copied) onClose?.();
  };
  return (
    <MessageMenuAction
      label={
        failed ? t('threadActions.failed') : t('mindroomUi.messages.messageCopyActions.copyLink')
      }
      icon={failed ? Icons.Warning : Icons.Link}
      variant={failed ? 'Critical' : undefined}
      onClick={() => void handleCopy()}
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
  const [failed, setFailed] = useState(false);
  const eventId = mEvent.getId();
  if (!eventId || !canPin) return null;
  const pinned = pinnedEventIds.includes(eventId);
  const handlePin = async () => {
    const saved = await setPinned(eventId, !pinned);
    setFailed(!saved);
    if (saved) onClose?.();
  };
  let label = pinned
    ? t('mindroomUi.messages.messageModerationActions.unpinMessage')
    : t('mindroomUi.messages.messageModerationActions.pinMessage');
  if (failed) label = t('threadActions.failed');
  return (
    <MessageMenuAction
      label={label}
      icon={failed ? Icons.Warning : Icons.Pin}
      variant={failed ? 'Critical' : undefined}
      disabled={updating}
      onClick={() => void handlePin()}
    />
  );
}

type ActionState = { busy: boolean; error?: string; done?: string };

/** A message menu entry that acts on one event and closes the menu when it is done. */
type EventActionItemProps = {
  room: Room;
  mEvent: MatrixEvent;
  onClose?: () => void;
};

/** "Delete": redacts the message after a confirmation, with an optional reason. */
export function MessageDeleteItem({ room, mEvent, onClose }: EventActionItemProps) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>({ busy: false });
  const eventId = mEvent.getId();
  if (!eventId) return null;
  const close = () => {
    setOpen(false);
    setState({ busy: false });
    onClose?.();
  };
  const handleDelete = async (reason: string) => {
    setState({ busy: true });
    try {
      await mx.redactEvent(room.roomId, eventId, undefined, reason ? { reason } : undefined);
      close();
    } catch {
      setState({
        busy: false,
        error: t(
          'mindroomUi.messages.messageModerationActions.failedToDeleteMessagePleaseTryAgain'
        ),
      });
    }
  };
  return (
    <>
      <MessageMenuAction
        label={t('mindroomUi.messages.messageModerationActions.delete')}
        icon={Icons.Delete}
        variant="Critical"
        onClick={() => setOpen(true)}
      />
      {open && (
        <MessageActionDialog
          title={t('mindroomUi.messages.messageModerationActions.deleteMessage')}
          description={t(
            'mindroomUi.messages.messageModerationActions.thisActionIsIrreversibleAreYouSureThatYouWant'
          )}
          reasonLabel={`${t('mindroomUi.messages.messageModerationActions.reason')} ${t(
            'mindroomUi.messages.messageModerationActions.optional'
          )}`}
          confirmLabel={t('mindroomUi.messages.messageModerationActions.delete')}
          busyLabel={t('mindroomUi.messages.messageModerationActions.deleting')}
          busy={state.busy}
          error={state.error}
          onConfirm={(reason) => void handleDelete(reason)}
          onClose={close}
        />
      )}
    </>
  );
}

/** "Report Message": reports the message to the homeserver with a reason. */
export function MessageReportItem({ room, mEvent, onClose }: EventActionItemProps) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>({ busy: false });
  const eventId = mEvent.getId();
  if (!eventId) return null;
  const close = () => {
    setOpen(false);
    setState({ busy: false });
    onClose?.();
  };
  const handleReport = async (reason: string) => {
    setState({ busy: true });
    try {
      await mx.reportEvent(room.roomId, eventId, -100, reason);
      setState({
        busy: false,
        done: t('mindroomUi.messages.messageModerationActions.messageHasBeenReportedToServer'),
      });
    } catch {
      setState({
        busy: false,
        error: t(
          'mindroomUi.messages.messageModerationActions.failedToReportMessagePleaseTryAgain'
        ),
      });
    }
  };
  return (
    <>
      <MessageMenuAction
        label={t('mindroomUi.messages.messageModerationActions.reportMessage')}
        icon={Icons.Warning}
        variant="Critical"
        onClick={() => setOpen(true)}
      />
      {open && (
        <MessageActionDialog
          title={t('mindroomUi.messages.messageModerationActions.reportMessage')}
          description={t(
            'mindroomUi.messages.messageModerationActions.reportThisMessageToServerWhichMayThenNotifyThe'
          )}
          reasonLabel={t('mindroomUi.messages.messageModerationActions.reason')}
          confirmLabel={t('mindroomUi.messages.messageModerationActions.report')}
          busyLabel={t('mindroomUi.messages.messageModerationActions.reporting')}
          busy={state.busy}
          error={state.error}
          done={state.done}
          onConfirm={(reason) => void handleReport(reason)}
          onClose={close}
        />
      )}
    </>
  );
}

/** The message, its content after edits, and the relations that decorate it. */
type MessageSubject = {
  room: Room;
  mEvent: MatrixEvent;
  /** Content after edits and long-text hydration, used by the controls. */
  resolvedMessageContent?: Record<string, unknown>;
  relations?: Relations;
};

/**
 * What the viewer may do with the message; every flag defaults to off. `canSendReaction` is off
 * for stickers, which take no reactions.
 */
type MessageAbilities = Partial<Record<'canDelete' | 'canPinEvent' | 'canSendReaction', boolean>>;

/** How the row is drawn in the timeline. */
type MessageAppearance = {
  /** Continues the previous sender's group: no avatar or name header. */
  collapse: boolean;
  highlight: boolean;
  messageLayout?: MessageLayout;
  messageSpacing?: MessageSpacing;
  hideReadReceipts?: boolean;
  hour24Clock?: boolean;
  dateFormatString?: string;
};

export type MessageProps = MessageSubject &
  MessageAbilities &
  MessageAppearance & {
    /** Shows the inline editor in place of the body. */
    edit?: boolean;
    onEditId?: (eventId: string | undefined) => void;
    onUserClick?: MouseEventHandler<HTMLButtonElement>;
    onUsernameClick?: MouseEventHandler<HTMLButtonElement>;
    /** Reply to this message, or start (or continue) its thread. */
    onReplyClick?: (eventId: string, startThread?: boolean) => void;
    /** Rooms whose emoji packs the reaction pickers offer. */
    imagePackRooms?: Room[];
    onReactionToggle?: ReactionHandler;
    children?: ReactNode;
    /** The quoted message this one replies to, shown above the body. */
    reply?: ReactNode;
    /** The reaction chips, shown under the body. */
    reactions?: ReactNode;
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
      highlight,
      // Editing and what the viewer may do with the message.
      edit,
      onEditId,
      canDelete = false,
      canSendReaction = false,
      canPinEvent = false,
      imagePackRooms = [],
      relations,
      // Presentation.
      messageLayout = MessageLayout.Modern,
      messageSpacing = '400',
      hideReadReceipts = false,
      hour24Clock = false,
      dateFormatString,
      reply,
      reactions,
      // Clicks on the avatar and the name.
      onUserClick,
      onUsernameClick,
      // Replying and reacting.
      onReplyClick,
      onReactionToggle,
      resolvedMessageContent,
      children,
      ...props
    },
    ref
  ) => {
    const client = useMatrixClient();
    const { t } = useTranslation();
    // Anchors of the context menu and of the emoji board while they are open.
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const [emojiAnchor, setEmojiAnchor] = useState<RectCords>();
    // The hover toolbar shows while the pointer or the keyboard focus is inside the row.
    const [pointerInside, setPointerInside] = useState(false);
    const [focusInside, setFocusInside] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setPointerInside });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusInside });
    const useAuthentication = useMediaAuthentication();
    const baseRef = useRef<HTMLDivElement | null>(null);
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
    const dismissMenu = () => setMenuAnchor(undefined);

    const senderDisplayName =
      getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
    const nameTone = getSenderNameTone(room, senderId);
    const avatarMxc = getMemberAvatarMxc(room, senderId);
    const avatarUrl = avatarMxc
      ? mxcUrlToHttp(client, avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
      : undefined;

    const avatarFallback = () => <Icon filled size="200" src={Icons.User} />;
    const renderAvatar = (withModel: boolean) => {
      const avatar = (
        <Avatar size="300" data-user-id={senderId} onClick={onUserClick as never}>
          <UserAvatar
            alt={senderDisplayName}
            renderFallback={avatarFallback}
            src={avatarUrl}
            userId={senderId}
          />
        </Avatar>
      );
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

    const compactLayout = messageLayout === MessageLayout.Compact;
    const renderBody = (controls?: { open: boolean; openDetails: () => void }) => {
      const openAiRun = () => {
        dismissMenu();
        controls?.openDetails();
      };
      // The name on the left; the reply details button and the time on the right.
      const header = (
        <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
          <Username
            as="button"
            data-user-id={senderId}
            tone={nameTone}
            onClick={onUsernameClick}
          >
            <Text as="span" size="T400" truncate>
              <UsernameBold>{senderDisplayName}</UsernameBold>
            </Text>
          </Username>
          <Box shrink="No" alignItems="Center" gap="100">
            {controls && (
              // Muted like the time beside it.
              <Text as="span" size="T200" priority="300" style={{ display: 'inline-flex' }}>
                <MindroomMessageHeaderExtensions
                  controls={controls as never}
                  onOpenAiRun={openAiRun}
                />
              </Text>
            )}
            <Time
              ts={mEvent.getTs()}
              compact={compactLayout}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          </Box>
        </Box>
      );
      // The quoted reply, then the editor or the content, then the reaction chips.
      const body = (
        <>
          {reply}
          {onEditId && edit ? (
            <MessageInlineEditor
              room={room}
              mEvent={mEvent}
              // The edit starts from the content shown, earlier edits included.
              content={content}
              onDone={() => onEditId(undefined)}
            />
          ) : (
            children
          )}
          {reactions}
        </>
      );
      const menu = menuAnchor && (
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: () => {
              dismissMenu();
              return true;
            },
            escapeDeactivates: () => {
              dismissMenu();
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
                    dismissMenu();
                  }}
                />
              )}
              {confirmed && relations && (
                <MessageAllReactionItem room={room} relations={relations} onClose={dismissMenu} />
              )}
              {confirmed && onReplyClick && (
                <MessageMenuAction
                  label={t('mindroomUi.messages.mindroomMessage.reply')}
                  icon={Icons.ReplyArrow}
                  onClick={() => {
                    onReplyClick(eventId);
                    dismissMenu();
                  }}
                />
              )}
              {confirmed && onReplyClick && (
                <MessageMenuAction
                  label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                  icon={Icons.ThreadPlus}
                  onClick={() => {
                    onReplyClick(eventId, true);
                    dismissMenu();
                  }}
                />
              )}
              {canSendReaction && confirmed && (
                <MessageMenuAction
                  label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                  icon={Icons.SmilePlus}
                  onClick={() => {
                    setEmojiAnchor(menuAnchor);
                    dismissMenu();
                  }}
                />
              )}
              {copyState.visible || isCopyTextMessageContent(content) ? (
                <MessageCopyTextItem
                  content={content}
                  originalContent={mEvent.getContent()}
                  resolvedContent={copyState.resolvedContent}
                  loading={copyState.loading}
                  onClose={dismissMenu}
                />
              ) : null}
              {confirmed && (
                <MessageCopyLinkItem room={room} eventId={eventId} onClose={dismissMenu} />
              )}
              {confirmed && canPinEvent && (
                <MessagePinItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              )}
              <MindroomMessageMenuExtensions
                controls={controls as never}
                state={extensionState}
                onClose={dismissMenu}
                onOpenAiRun={openAiRun}
              />
              {!hideReadReceipts && confirmed && (
                <MessageReadReceiptItem room={room} eventId={eventId} onClose={dismissMenu} />
              )}
              <MessageSourceCodeItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              <MessageBugReportItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              {confirmed && canDelete && (
                <MessageDeleteItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              )}
              {confirmed && senderId !== client.getUserId() && (
                <MessageReportItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              )}
            </Box>
          </Menu>
        </FocusTrap>
      );
      const emojiBoard = emojiAnchor && onReactionToggle && (
        <PopOut
          anchor={emojiAnchor}
          position="Bottom"
          align="End"
          offset={4}
          content={
            <EmojiBoard
              imagePackRooms={imagePackRooms}
              requestClose={() => setEmojiAnchor(undefined)}
              returnFocusOnDeactivate
              onEmojiSelect={(unicode, shortcode) => {
                onReactionToggle(unicode, shortcode);
                setEmojiAnchor(undefined);
              }}
              onCustomEmojiSelect={(mxc, shortcode) => {
                onReactionToggle(mxc, shortcode);
                setEmojiAnchor(undefined);
              }}
            />
          }
        />
      );
      // The inline editor has its own buttons, so the toolbar stays away while it is open.
      const toolbarVisible =
        !edit && (pointerInside || focusInside || !!menuAnchor || !!emojiAnchor);
      const options = (
        <div className={css.MessageOptionsBase}>
          <Menu variant="SurfaceVariant" className={css.MessageOptionsBar}>
            <Box gap="100">
              {canSendReaction && confirmed && onReactionToggle && (
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                  aria-pressed={!!emojiAnchor}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => setEmojiAnchor(getAnchor(evt))}
                >
                  <Icon src={Icons.SmilePlus} size="100" />
                </IconButton>
              )}
              {confirmed && onReplyClick && (
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('mindroomUi.messages.mindroomMessage.reply')}
                  onClick={() => onReplyClick(eventId)}
                >
                  <Icon src={Icons.ReplyArrow} size="100" />
                </IconButton>
              )}
              {confirmed && onReplyClick && (
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                  onClick={() => onReplyClick(eventId, true)}
                >
                  <Icon src={Icons.ThreadPlus} size="100" />
                </IconButton>
              )}
              <PopOut anchor={menuAnchor} position="Bottom" align="End" offset={4} content={menu}>
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
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
          <ModernLayout
            before={collapse && !extensionState.aiRunInfo ? undefined : renderAvatar(true)}
          >
            {!collapse && header}
            {/* The body stops short of the time above it, as the reference timeline does. */}
            <div style={{ paddingInlineEnd: config.space.S200 }}>{body}</div>
          </ModernLayout>
        );

      return (
        <MessageBase
          ref={setBaseRef}
          tabIndex={0}
          highlight={highlight}
          className={css.MessageBase}
          collapse={collapse}
          space={messageSpacing}
          selected={!!menuAnchor || edit}
          {...hoverProps}
          {...focusWithinProps}
          {...props}
        >
          {toolbarVisible && options}
          {emojiBoard}
          {layout}
        </MessageBase>
      );
    };

    return (
      <MindroomMessageExtensionShell state={extensionState} forwardedRef={baseRef}>
        {(controls) => renderBody(controls)}
      </MindroomMessageExtensionShell>
    );
  }
);

/** A state or membership row shares its identity, highlight and slots with a message. */
export type EventProps = Pick<
  MessageProps,
  'room' | 'mEvent' | 'highlight' | 'children' | 'data-message-id'
> & {
  messageSpacing: MessageSpacing;
};

const ROOM_STATE_LINES: Record<string, string> = {
  'm.room.name': 'mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomName',
  'm.room.topic': 'mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomTopic',
  'm.room.avatar': 'mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomAvatar',
};

/** The one-line text of a state event: membership changes, room name, topic, and avatar. */
function StateEventLine({ room, mEvent }: { room: Room; mEvent: MatrixEvent }) {
  const parseMemberEvent = useMemberEventParser();
  const type = mEvent.getType();
  if (type === 'm.room.member') {
    const parsed = parseMemberEvent(mEvent);
    return (
      <Box alignItems="Center" gap="200">
        <Icon size="100" src={parsed.icon} />
        <Text size="T300" priority="300">
          {parsed.body}
        </Text>
      </Box>
    );
  }
  const key = ROOM_STATE_LINES[type];
  if (!key) return null;
  const senderId = mEvent.getSender() ?? '';
  const sender = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
  return (
    <Text size="T300" priority="300">
      <Trans i18nKey={key as never} values={{ sender }} components={{ sender: <b /> }} />
    </Text>
  );
}

/** A state or membership event: a single compact line without a sender header. */
export const Event = forwardRef<HTMLDivElement, EventProps>(
  ({ room, mEvent, highlight, messageSpacing, children, ...props }, ref) => {
    return (
      <MessageBase
        ref={ref}
        className={css.MessageBase}
        highlight={highlight}
        autoCollapse
        space={messageSpacing}
        {...props}
      >
        {children ?? <StateEventLine room={room} mEvent={mEvent} />}
      </MessageBase>
    );
  }
);
