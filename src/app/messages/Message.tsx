import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
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
  Text,
  color,
  type IconSrc,
  type RectCords,
} from 'folds';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import { ActionDialog } from '../ui/ActionDialog';
import { MenuEntry } from '../ui/MenuEntry';
import { IconTooltip } from '../ui/IconTooltip';
import { EmojiBoard } from '../emoji/board/LazyEmojiBoard';
import { useMemberEventParser } from './useMemberEventParser';
import { describeRoomStateChange, RoomStateSentence } from './roomStateChange';
import { Time } from './Time';
import { LONG_PRESS_SLOP, useLongPress } from '../lib/hooks/useLongPress';
import {
  AvatarBase,
  BubbleLayout,
  CompactLayout,
  MessageBase,
  ModernLayout,
  Username,
  UsernameBold,
} from './layout/layout';
import { UserAvatar } from '../avatars/UserAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { MessageLayout, type MessageSpacing } from '../preferences/settings';
import { canEditEvent, getMemberAvatarMxc, getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { copyToClipboard, selectableTextNear } from '../lib/dom';
import { getMatrixToRoomEvent } from '../matrix/matrix-to';
import { getViaServers } from '../matrix/via-servers';
import { MessageEditor } from './edit/MessageEditor';
import { MessageBugReportItem } from '../bug-reports/MessageBugReportItem';
import { useThreadPinning } from '../event-store/threads/useThreadPinning';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { AvatarModelMark, ModelBadge } from './agent-run/ModelBadge';
import { isKeyboardFocus, useToolbarClearance } from './hoverToolbarPlacement';
import { getSenderNameTone } from './senderNameTone';
import {
  AiRunControls,
  AiRunInfoButton,
  AiRunMenuItem,
  DownloadOriginalMenuItem,
  useMessageControls,
} from './MessageControls';
import {
  getMessageCopyTexts,
  getMessageCopyTextSource,
  isCopyTextMessageContent,
  scanToolMarkerLines,
} from './messageCopyText';
import {
  MessageAllReactionItem,
  MessageQuickReactions,
  type ReactionHandler,
} from './reactions/MessageReactionActions';
import { MessageReadReceiptItem, MessageSourceCodeItem } from './MessageInspectionActions';
import * as css from './styles.css';
import * as copyCss from './MessageCopyActions.css';
import * as stateCss from './roomStateChange.css';

export type { ReactionHandler };
export {
  MessageAllReactionItem,
  MessageQuickReactions,
  MessageReadReceiptItem,
  MessageSourceCodeItem,
};

type ToolbarActionProps = {
  label: string;
  icon: IconSrc;
  onClick: MouseEventHandler<HTMLButtonElement>;
  /** For buttons that open something: whether it is open. */
  pressed?: boolean;
  /** The icon points along the reading direction, so right-to-left languages mirror it. */
  directional?: boolean;
  /** Moves a glyph that is drawn off-centre in its box back to the middle of the button. */
  iconClassName?: string;
};

/** An icon button of the hover toolbar, which shows its name in a tooltip above it. */
function ToolbarAction({
  label,
  icon,
  onClick,
  pressed,
  directional,
  iconClassName,
}: ToolbarActionProps) {
  return (
    <IconTooltip label={label} position="Top">
      {(tooltipRef) => (
        <IconButton
          ref={tooltipRef}
          className={css.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          <Icon
            src={icon}
            size="100"
            className={iconClassName}
            data-directional={directional || undefined}
          />
        </IconButton>
      )}
    </IconTooltip>
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
    <ActionDialog label={title} onClose={onClose} busy={busy} initialFocus={false}>
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
    </ActionDialog>
  );
}

const isCoarsePointer = (): boolean =>
  globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

/** Whether the primary pointer hovers. A touch screen's emulated mouse after a tap does not. */
const canHover = (): boolean => globalThis.matchMedia?.('(hover: hover)').matches ?? true;

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
    const scan = scanToolMarkerLines(source.body, source.formattedBody, source.plainBodyFallback);
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
    <MenuEntry
      label={label}
      icon={failed ? Icons.Warning : Icons.Text}
      critical={failed}
      disabled={loading}
      onSelect={() => void handleCopy(texts?.text)}
    />
  );
  const withToolCalls = texts?.textWithToolCalls;
  if (withToolCalls === undefined) return copyText;

  const withToolCallsLabel = t('mindroomUi.messages.messageCopyActions.copyTextWithToolCalls');
  if (isCoarsePointer()) {
    return (
      <>
        {copyText}
        <MenuEntry
          label={withToolCallsLabel}
          icon={Icons.Terminal}
          onSelect={() => void handleCopy(withToolCalls)}
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
        // The second action of the row, a row of the message menu of its own.
        role="menuitem"
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
function MessageCopyLinkItem({
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
    <MenuEntry
      label={
        failed ? t('threadActions.failed') : t('mindroomUi.messages.messageCopyActions.copyLink')
      }
      icon={failed ? Icons.Warning : Icons.Link}
      critical={failed}
      onSelect={() => void handleCopy()}
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
    <MenuEntry
      label={label}
      icon={failed ? Icons.Warning : Icons.Pin}
      critical={failed}
      disabled={updating}
      onSelect={() => void handlePin()}
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
      <MenuEntry
        label={t('mindroomUi.messages.messageModerationActions.delete')}
        icon={Icons.Delete}
        critical
        onSelect={() => setOpen(true)}
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
      <MenuEntry
        label={t('mindroomUi.messages.messageModerationActions.reportMessage')}
        icon={Icons.Warning}
        critical
        onSelect={() => setOpen(true)}
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
  const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
  const rect = target.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

const hasSelectedText = (): boolean => (document.getSelection()?.toString() ?? '') !== '';

// Links, fields and selected text keep the browser's own menu, to open a link or copy a selection.
// `readerSelected` says whether the reader selected text before the click (by default: whether
// any text is selected now).
const wantsBrowserMenu = (target: EventTarget, readerSelected = hasSelectedText()): boolean =>
  !!(target as Element).closest('a, input, textarea, [contenteditable="true"]') || readerSelected;

/**
 * The side of `anchor` a pop-out opens on: above it in the lower half of the window, where the
 * newest messages are. folds puts a pop-out that does not fit below its anchor beside it instead,
 * over the member list or past the window's edge.
 */
const popOutSide = (anchor: RectCords): 'Top' | 'Bottom' =>
  typeof window !== 'undefined' && anchor.y + anchor.height / 2 > window.innerHeight / 2
    ? 'Top'
    : 'Bottom';

/** A zero-size anchor at one viewport point, so a pop-out opens next to the pointer. */
const pointRect = (left: number, top: number): RectCords => ({
  x: left,
  y: top,
  width: 0,
  height: 0,
});

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
    // The hover toolbar shows while the pointer or the focus is inside the row. A mouse click
    // also focuses the row, but that focus does not keep the toolbar once the pointer leaves;
    // a tap does, since touch screens have no hover. Where the pointer cannot hover, the row
    // takes no hover at all: WebKit hovers the row that lands under the finger after a tap with
    // its emulated mouse, and never ends that hover, so the toolbar stayed there.
    const [pointerInside, setPointerInside] = useState(false);
    const [focusInside, setFocusInside] = useState(false);
    const { hoverProps } = useHover({
      onHoverChange: (hovered: boolean) => setPointerInside(hovered && canHover()),
    });
    const { focusWithinProps } = useFocusWithin({
      onFocusWithinChange: (inside: boolean) => {
        if (!inside) setFocusInside(false);
      },
    });
    // The kind of pointer that pressed in the row, until the focus that press gives arrives.
    const pressedPointer = useRef<string>();
    // Whether text was selected when a press that opens a context menu (a right click, or a
    // Control click on macOS) went down, until its contextmenu event. Safari selects the word
    // under the pointer between the two; that word is the click's, not the reader's selection.
    const selectedAtMenuPress = useRef<boolean>();
    const noteRowPointer = (evt: PointerEvent<HTMLDivElement>) => {
      pressedPointer.current = evt.pointerType;
      const opensMenu = evt.button === 2 || (evt.button === 0 && evt.ctrlKey);
      selectedAtMenuPress.current = opensMenu ? hasSelectedText() : undefined;
    };
    const toolbarRef = useRef<HTMLDivElement>(null);
    // Focus from the keyboard, or from a tap on the message itself, shows the toolbar. A tap on one
    // of the row's controls, such as a streaming reply's Stop, does not: the focus stayed in the
    // row and kept the toolbar open over the message above it. A tap on one of the toolbar's own
    // buttons keeps it: Chromium focuses the button on the tap's mousedown, and a toolbar hidden
    // then is gone before the click, so Reply did nothing.
    const noteRowFocus = (evt: FocusEvent<HTMLDivElement>) => {
      const pointer = pressedPointer.current;
      pressedPointer.current = undefined;
      const tapped = evt.target === evt.currentTarget || !!toolbarRef.current?.contains(evt.target);
      setFocusInside(
        isKeyboardFocus(evt.target) || pointer === undefined || (pointer !== 'mouse' && tapped)
      );
    };
    // The inline editor has its own buttons, so the toolbar stays away while it is open.
    const toolbarVisible = !edit && (pointerInside || focusInside || !!menuAnchor || !!emojiAnchor);
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

    const toolbarClearance = useToolbarClearance(baseRef, toolbarRef, toolbarVisible);

    const eventId = mEvent.getId() ?? '';
    const senderId = mEvent.getSender() ?? '';
    const confirmed = isConfirmedMatrixEventId(eventId);
    const content = useMemo(
      () => resolvedMessageContent ?? mEvent.getContent<Record<string, unknown>>(),
      [mEvent, resolvedMessageContent]
    );
    // An agent reply's run details, and for a long reply the file with its whole text, which
    // loads while the menu is open so that Copy Text copies all of it.
    const { aiRunInfo, longTextSource, resolvedLongTextContent, longTextLoading } =
      useMessageControls(content, !!menuAnchor, mEvent);
    // The sender edits their own confirmed text messages, long texts included.
    const canEdit = !!onEditId && confirmed && canEditEvent(client, mEvent);
    const startEdit = () => onEditId?.(eventId);
    const dismissMenu = () => setMenuAnchor(undefined);
    // A right click opens the message's menu where the pointer is. A menu key has no press before
    // it, so text selected then is the reader's. Right clicks inside the row's own pop-outs and
    // the dialogs their entries open, which React passes up through their portals, are not the
    // row's: they keep the browser's menu.
    const openMenuAtPointer = (evt: MouseEvent<HTMLDivElement>) => {
      const selectedBefore = selectedAtMenuPress.current ?? true;
      selectedAtMenuPress.current = undefined;
      if (
        edit ||
        !evt.currentTarget.contains(evt.target as Node) ||
        wantsBrowserMenu(evt.target, selectedBefore && hasSelectedText())
      )
        return;
      evt.preventDefault();
      // The word the click selected would stay highlighted under the menu.
      if (hasSelectedText()) document.getSelection()?.removeAllRanges();
      setMenuAnchor(pointRect(evt.clientX, evt.clientY));
    };
    // A long press opens it where the finger rests, on touch screens whose browser fires no
    // contextmenu for one (iOS Safari). Touches inside the row's own pop-outs, which React passes
    // up through their portals, are not the row's. A long press on the message's text is the
    // platform's: it selects the word under the finger, with its handles and Copy bar. A tap
    // shows the toolbar, whose More Options opens the menu there too. Text selected before does
    // not hold a press off the text back; the menu clears it when it opens.
    const longPress = useLongPress(
      (x, y) => setMenuAnchor(pointRect(x, y)),
      (evt) => {
        const touch = evt.touches[0];
        return (
          !edit &&
          evt.currentTarget.contains(evt.target as Node) &&
          !wantsBrowserMenu(evt.target, false) &&
          !(touch && selectableTextNear(evt.target, touch.clientX, touch.clientY, LONG_PRESS_SLOP))
        );
      }
    );

    const senderDisplayName =
      getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
    const nameTone = getSenderNameTone(room, senderId);
    const avatarMxc = getMemberAvatarMxc(room, senderId);
    // The spec's 96 px crop: sharp at twice the 36 px avatar, and the thumbnail other lists share.
    const avatarUrl = avatarMxc
      ? mxcUrlToHttp(client, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
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
      if (!withModel || !aiRunInfo) return <AvatarBase>{avatar}</AvatarBase>;
      return (
        <AvatarBase>
          <div className={css.MessageAvatarWithModel}>
            <AvatarModelMark info={aiRunInfo}>{avatar}</AvatarModelMark>
            <ModelBadge info={aiRunInfo} />
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
        <Box
          className={css.SenderLine}
          gap="300"
          justifyContent="SpaceBetween"
          alignItems="Center"
          grow="Yes"
        >
          <Username as="button" data-user-id={senderId} tone={nameTone} onClick={onUsernameClick}>
            <Text as="span" size="T400" truncate>
              <UsernameBold>{senderDisplayName}</UsernameBold>
            </Text>
          </Username>
          <Box shrink="No" alignItems="Center" gap="100">
            {controls && <AiRunInfoButton open={controls.open} onOpen={openAiRun} />}
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
            <MessageEditor room={room} mEvent={mEvent} onDone={() => onEditId(undefined)} />
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
                <MenuEntry
                  label={t('mindroomUi.messages.mindroomMessage.reply')}
                  icon={Icons.ReplyArrow}
                  directional
                  onSelect={() => {
                    onReplyClick(eventId);
                    dismissMenu();
                  }}
                />
              )}
              {confirmed && onReplyClick && (
                <MenuEntry
                  label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                  icon={Icons.ThreadPlus}
                  onSelect={() => {
                    onReplyClick(eventId, true);
                    dismissMenu();
                  }}
                />
              )}
              {canEdit && (
                <MenuEntry
                  label={t('mindroomUi.messages.mindroomMessage.editMessage')}
                  icon={Icons.Pencil}
                  onSelect={() => {
                    startEdit();
                    dismissMenu();
                  }}
                />
              )}
              {canSendReaction && confirmed && (
                <MenuEntry
                  label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                  icon={Icons.SmilePlus}
                  onSelect={() => {
                    setEmojiAnchor(menuAnchor);
                    dismissMenu();
                  }}
                />
              )}
              {longTextSource || isCopyTextMessageContent(content) ? (
                <MessageCopyTextItem
                  content={content}
                  originalContent={mEvent.getContent()}
                  resolvedContent={resolvedLongTextContent}
                  loading={longTextLoading}
                  onClose={dismissMenu}
                />
              ) : null}
              {confirmed && (
                <MessageCopyLinkItem room={room} eventId={eventId} onClose={dismissMenu} />
              )}
              {confirmed && canPinEvent && (
                <MessagePinItem room={room} mEvent={mEvent} onClose={dismissMenu} />
              )}
              {controls && <AiRunMenuItem onOpen={openAiRun} />}
              {longTextSource && (
                <DownloadOriginalMenuItem source={longTextSource} onClose={dismissMenu} />
              )}
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
          position={popOutSide(emojiAnchor)}
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
              onTextReaction={(text) => {
                onReactionToggle(text);
                setEmojiAnchor(undefined);
              }}
            />
          }
        />
      );
      const options = (
        <div
          ref={toolbarRef}
          className={css.MessageOptionsBase}
          style={
            toolbarClearance === undefined
              ? undefined
              : { insetBlockStart: `${toolbarClearance}px` }
          }
        >
          <Menu role="none" variant="SurfaceVariant" className={css.MessageOptionsBar}>
            <Box className={css.MessageOptionsRow}>
              {canSendReaction && confirmed && onReactionToggle && (
                <ToolbarAction
                  label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                  icon={Icons.SmilePlus}
                  pressed={!!emojiAnchor}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => setEmojiAnchor(getAnchor(evt))}
                />
              )}
              {confirmed && onReplyClick && (
                <ToolbarAction
                  label={t('mindroomUi.messages.mindroomMessage.reply')}
                  icon={Icons.ReplyArrow}
                  directional
                  iconClassName={css.MessageOptionsReplyIcon}
                  onClick={() => onReplyClick(eventId)}
                />
              )}
              {confirmed && onReplyClick && (
                <ToolbarAction
                  label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                  icon={Icons.ThreadPlus}
                  onClick={() => onReplyClick(eventId, true)}
                />
              )}
              {canEdit && (
                <ToolbarAction
                  label={t('mindroomUi.messages.mindroomMessage.editMessage')}
                  icon={Icons.Pencil}
                  onClick={startEdit}
                />
              )}
              <PopOut
                anchor={menuAnchor}
                position={menuAnchor ? popOutSide(menuAnchor) : 'Bottom'}
                align="End"
                offset={4}
                content={menu}
              >
                <ToolbarAction
                  label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
                  icon={Icons.VerticalDots}
                  pressed={!!menuAnchor}
                  onClick={(evt: MouseEvent<HTMLButtonElement>) => setMenuAnchor(getAnchor(evt))}
                />
              </PopOut>
            </Box>
          </Menu>
        </div>
      );

      const layout =
        messageLayout === MessageLayout.Compact ? (
          <CompactLayout before={header}>{body}</CompactLayout>
        ) : messageLayout === MessageLayout.Bubble ? (
          <BubbleLayout
            before={renderAvatar(true)}
            header={!collapse && header}
            own={senderId === client.getUserId()}
          >
            {body}
          </BubbleLayout>
        ) : (
          <ModernLayout before={collapse && !aiRunInfo ? undefined : renderAvatar(true)}>
            {!collapse && header}
            {body}
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
          onContextMenu={openMenuAtPointer}
          {...longPress}
          onPointerDownCapture={noteRowPointer}
          onFocusCapture={noteRowFocus}
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

    // An agent reply owns its Reply details dialog, which its header and menu open. Every message
    // renders through the controls, so a streaming reply whose run details arrive with a later
    // edit keeps its row and the state inside it, such as an open tool-call list.
    return (
      <AiRunControls info={aiRunInfo} eventId={eventId} forwardedRef={baseRef}>
        {renderBody}
      </AiRunControls>
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

const ROOM_STATE_ICONS: Record<string, IconSrc> = {
  'm.room.name': Icons.Hash,
  'm.room.topic': Icons.Text,
  'm.room.avatar': Icons.Photo,
};

/**
 * A state row's icon and line, the icon in the column the membership rows keep theirs. A line
 * with a `title` (a new name or topic) stays on one line, its quoted value cut with an ellipsis,
 * and shows the whole value on hover.
 */
function StateLine({
  icon,
  title,
  children,
}: {
  icon: IconSrc;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Box alignItems="Center" gap="200">
      <Icon size="100" src={icon} />
      <Text
        size="T300"
        priority="300"
        title={title}
        className={title === undefined ? undefined : stateCss.OneLine}
      >
        {children}
      </Text>
    </Box>
  );
}

/** The one-line text of a state event: membership changes, room name, topic, and avatar. */
function StateEventLine({ room, mEvent }: { room: Room; mEvent: MatrixEvent }) {
  const parseMemberEvent = useMemberEventParser();
  const type = mEvent.getType();
  if (type === 'm.room.member') {
    const parsed = parseMemberEvent(mEvent, room);
    return <StateLine icon={parsed.icon}>{parsed.body}</StateLine>;
  }
  const icon = ROOM_STATE_ICONS[type];
  const change = describeRoomStateChange(mEvent);
  if (!icon || !change) return null;
  const senderId = mEvent.getSender() ?? '';
  const sender = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
  return (
    <StateLine icon={icon} title={change.value}>
      <RoomStateSentence change={change} sender={sender} />
    </StateLine>
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
