import React, {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  Icons,
  Line,
  Text,
  config,
  toRem,
  type IconSrc,
  type RectCords,
} from 'folds';
import { PopOut } from '../ui/directional';
import {
  getThreadSummaryActionError,
  requestThreadSummary,
  saveThreadSummary,
  SUMMARY_MAX_LENGTH,
} from './summary/threadSummaryActions';
import { getResolvableThreadRootEvent } from '../event-store/threads/threadResolvableRoot';
import { ThreadTagPicker } from './tags/ThreadTagPicker';
import { ThreadTagPill } from './tags/ThreadTagPill';
import { useThreadPinning } from '../event-store/threads/useThreadPinning';
import { useMutateThreadTags } from './tags/useMutateThreadTags';
import { useThreadTags } from './tags/useThreadTags';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { getViaServers } from '../matrix/via-servers';
import { getMatrixToRoomEvent } from '../matrix/matrix-to';
import { copyToClipboard } from '../lib/dom';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomThreadMode } from '../matrix/hooks/useRoomThreadMode';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { ActionDialog } from '../ui/ActionDialog';
import { describeError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';
import { useToolCallsShown } from '../messages/toolCallVisibility';
import { isSnoozedAt } from '../event-store/threads/threadSnooze';
import { useSnoozeNow } from './tags/useSnoozeNow';
import { SnoozePicker } from './tags/SnoozePicker';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { registeredPlugins, type RegisteredPlugin } from '../plugins/registry';
import { shownThreadDetails } from '../plugins/threadDetails';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { ThreadDetailsList } from './ThreadDetailsList';
import { SecondThreadContext } from '../navigation/secondThread';
import * as css from './ThreadActionsMenu.css';
import { latestForkPoint } from '../event-store/threads/threadFork';
import { ForkIcon } from '../messages/ForkIcon';
import { useStartThreadFork } from './fork/useStartThreadFork';

export type ThreadActionsMenuProps = {
  room: Room;
  rootId: string;
  plugins?: readonly RegisteredPlugin[];
  /** Current thread title, the starting text of Edit summary. */
  summaryText?: string;
  anchor: RectCords;
  onClose: () => void;
  /** Omitted for the thread that is already open. */
  onOpenThread?: () => void;
  /** Offered from the thread banner only. */
  onHideDetails?: () => void;
  /** Offered from the banner of a thread filling the page where it may show beside the messages. */
  onShowBeside?: () => void;
  /** Offered from the banner of a thread beside the messages, to fill the page with it. */
  onShowFull?: () => void;
};

type OpenDialog = 'tags' | 'editSummary' | 'regenerate' | 'snooze';

// As the original's thread menu measures: at least 220px wide, with the banner's 12px corners.
const menuStyle: React.CSSProperties = { minWidth: toRem(220), borderRadius: config.radii.R500 };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  padding: '0.5rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
};

/**
 * Thread options: open, tags, edit or regenerate the summary, resolve, snooze, pin, fork (the copy),
 * copy a link.
 */
export function ThreadActionsMenu({
  room,
  rootId,
  summaryText,
  anchor,
  onClose,
  onOpenThread,
  onHideDetails,
  onShowBeside,
  onShowFull,
  plugins = registeredPlugins,
}: ThreadActionsMenuProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const tags = useThreadTags(room, rootId);
  const secondThread = useContext(SecondThreadContext);
  const mutations = useMutateThreadTags(room);
  const pinning = useThreadPinning(room);
  const members = useRoomMembers(mx, room.roomId);
  const [toolCallsShown, setToolCallsShown] = useToolCallsShown(room.roomId, rootId);
  const startFork = useStartThreadFork(room);
  // Where agents answer in the room, they answer a fork there too, and it stays empty.
  const forksAnswered = useRoomThreadMode(room.roomId, !onOpenThread) !== 'room';

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dialog, setDialog] = useState<OpenDialog>();
  const [draft, setDraft] = useState(summaryText ?? '');
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<{ error: unknown }>();
  // A regeneration request was sent: the dialog says so until Done.
  const [requested, setRequested] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (requested) doneRef.current?.focus();
  }, [requested]);

  const agents = useMemo(
    () =>
      members.filter(
        (member) => member.membership === 'join' && isMindroomAgentUserId(member.userId)
      ),
    [members]
  );
  const [agentId, setAgentId] = useState<string>();
  const selectedAgentId = agentId ?? agents[0]?.userId;

  const rootLoaded = !!getResolvableThreadRootEvent(room, rootId);
  const pinned = pinning.pinnedEventIds.includes(rootId);
  const snoozeNow = useSnoozeNow([tags.snoozedUntilTs]);
  const snoozed = isSnoozedAt(tags.snoozedUntilTs, snoozeNow);
  const canSummarize = getThreadSummaryActionError(mx, room, rootId) === undefined;
  const showTags = tags.canEdit
    ? rootLoaded || tags.displayTags.length > 0
    : tags.displayTags.length > 0;
  const tagsEditable = tags.canEdit && rootLoaded;
  const tagsUpdating = !!mutations.updating;
  // Resolve, Unsnooze and pin keep the menu open on their new label; it closes once their save is
  // done.
  const saving = tagsUpdating || !!pinning.updating;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  const openDialog = (next: OpenDialog) => {
    setRequestError(undefined);
    setRequested(false);
    if (next === 'editSummary') setDraft(summaryText ?? '');
    setDialog(next);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialog(undefined);
    onClose();
  };

  /** Runs a dialog's request; `onDone` follows a success, an error stays in the dialog. */
  const runRequest = async (request: () => Promise<void>, onDone: () => void) => {
    setBusy(true);
    setRequestError(undefined);
    try {
      await request();
      setBusy(false);
      onDone();
    } catch (error) {
      setBusy(false);
      setRequestError({ error });
    }
  };

  const handleSaveSummary = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    return runRequest(
      () => saveThreadSummary(mx, room, rootId, draft),
      () => {
        setDialog(undefined);
        onClose();
      }
    );
  };

  // The agent answers in the thread later, so the dialog stays to say the request went out.
  const handleRegenerate = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!selectedAgentId) return undefined;
    return runRequest(
      () => requestThreadSummary(mx, room, rootId, selectedAgentId),
      () => setRequested(true)
    );
  };

  const handleCopyLink = () => {
    void copyToClipboard(getMatrixToRoomEvent(room.roomId, rootId, getViaServers(room)));
    onClose();
  };

  const clientConfig = useOptionalClientConfig();
  // Keep the contributions selected when this opening mounted.
  const [details] = useState(() =>
    isConfirmedMatrixEventId(rootId) ? shownThreadDetails(plugins, clientConfig, room, rootId) : []
  );
  const detailsId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState({ anchor, copy: anchor });
  const menuAnchor = placed.anchor === anchor ? placed.copy : anchor;
  const [described, setDescribed] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    // Without details, the menu neither resizes late nor has a description.
    if (!surface || details.length === 0) return undefined;
    // Details that render nothing (empty, loading or failed) describe nothing.
    const measure = () =>
      setDescribed(surface.querySelector('[data-thread-detail]:not(:empty)') !== null);
    measure();
    // A height-capped menu need not resize when its details become empty or appear.
    const mutations = new MutationObserver(measure);
    const detailsSurface = surface.querySelector('[data-thread-details]');
    if (detailsSurface) {
      mutations.observe(detailsSurface, { childList: true, subtree: true, characterData: true });
    }
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            // Folds repositions when its anchor changes; lazy details can resize without a window resize.
            // The trigger's DOMRect keeps its fields on its prototype, where a spread finds none.
            const { x, y, width, height } = anchor;
            setPlaced({ anchor, copy: { x, y, width, height } });
          });
    observer?.observe(surface);
    return () => {
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [anchor, dialog, details]);

  if (dialog === 'snooze') {
    return (
      <SnoozePicker
        anchor={anchor}
        // The picker stays until the snooze is saved, so a failure shows in it instead of the
        // thread coming back without a word.
        onPick={async (until) => {
          const written = await mutations.snooze(rootId, until);
          if (written) {
            setDialog(undefined);
            onClose();
          }
          return written;
        }}
        onClose={closeDialog}
      />
    );
  }

  if (dialog === 'tags') {
    const label = tagsEditable ? t('threadActions.tags') : t('thread.stats.tags');
    return (
      <ActionDialog label={label} onClose={closeDialog} busy={false}>
        <Box wrap="Wrap" gap="200" alignItems="Center">
          {tags.displayTags.map((tagName) => (
            <ThreadTagPill
              key={tagName}
              name={tagName}
              onRemove={
                tagsEditable && !tagsUpdating
                  ? () => void mutations.removeTag(rootId, tagName)
                  : undefined
              }
            />
          ))}
          {tagsEditable && (
            <ThreadTagPicker
              availableTags={tags.availableTags}
              onAddTag={(tagName) => void mutations.addTag(rootId, tagName)}
              disabled={tagsUpdating}
            />
          )}
        </Box>
        {mutations.error && (
          <Text role="alert" size="T200">
            {t('threadActions.failed')}
          </Text>
        )}
        <Box justifyContent="End">
          <Button
            type="button"
            size="300"
            variant="Secondary"
            disabled={tagsUpdating}
            onClick={closeDialog}
          >
            <Text size="B300">{t('threadActions.done')}</Text>
          </Button>
        </Box>
      </ActionDialog>
    );
  }

  if (dialog === 'editSummary') {
    const length = Array.from(draft.trim()).length;
    return (
      <ActionDialog label={t('threadActions.editSummary')} onClose={closeDialog} busy={busy}>
        <form onSubmit={(evt) => void handleSaveSummary(evt)}>
          <Box direction="Column" gap="300">
            <textarea
              aria-label={t('threadActions.summary')}
              style={{ ...fieldStyle, minHeight: '5rem', resize: 'vertical' }}
              value={draft}
              disabled={busy}
              onChange={(evt) => setDraft(evt.target.value)}
            />
            <Box justifyContent="SpaceBetween" gap="300">
              <Text size="T200" priority="300">
                {t('threadActions.summaryHint')}
              </Text>
              <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
                {t('threadActions.length', { count: length, max: SUMMARY_MAX_LENGTH })}
              </Text>
            </Box>
            {requestError && (
              <Text role="alert" size="T200">
                {describeError(t, requestError.error)}
                <ErrorDetail error={requestError.error} />
              </Text>
            )}
            <Box justifyContent="End" gap="200">
              <Button
                type="button"
                size="300"
                variant="Secondary"
                disabled={busy}
                onClick={closeDialog}
              >
                <Text size="B300">{t('threadActions.cancel')}</Text>
              </Button>
              <Button
                type="submit"
                size="300"
                variant="Primary"
                disabled={busy || length === 0 || length > SUMMARY_MAX_LENGTH}
              >
                <Text size="B300">
                  {busy ? t('threadActions.saving') : t('threadActions.save')}
                </Text>
              </Button>
            </Box>
          </Box>
        </form>
      </ActionDialog>
    );
  }

  if (dialog === 'regenerate' && requested) {
    return (
      <ActionDialog label={t('threadActions.regenerate')} onClose={closeDialog} busy={false}>
        <Text role="status" size="T300">
          {t('threadActions.requested')}
        </Text>
        <Box justifyContent="End">
          <Button ref={doneRef} type="button" size="300" variant="Primary" onClick={closeDialog}>
            <Text size="B300">{t('threadActions.done')}</Text>
          </Button>
        </Box>
      </ActionDialog>
    );
  }

  if (dialog === 'regenerate') {
    return (
      <ActionDialog label={t('threadActions.regenerate')} onClose={closeDialog} busy={busy}>
        <form onSubmit={(evt) => void handleRegenerate(evt)}>
          <Box direction="Column" gap="300">
            <Text size="T200" priority="300">
              {t('threadActions.regenerateHint')}
            </Text>
            {agents.length > 0 ? (
              <select
                aria-label={t('threadActions.agent')}
                style={fieldStyle}
                value={selectedAgentId}
                disabled={busy}
                onChange={(evt) => setAgentId(evt.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.userId} value={agent.userId}>
                    {agent.name || agent.userId}
                  </option>
                ))}
              </select>
            ) : (
              <Text size="T300">{t('threadActions.noAgents')}</Text>
            )}
            {requestError && (
              <Text role="alert" size="T200">
                {describeError(t, requestError.error)}
                <ErrorDetail error={requestError.error} />
              </Text>
            )}
            <Box justifyContent="End" gap="200">
              <Button
                type="button"
                size="300"
                variant="Secondary"
                disabled={busy}
                onClick={closeDialog}
              >
                <Text size="B300">{t('threadActions.cancel')}</Text>
              </Button>
              <Button
                type="submit"
                size="300"
                variant="Primary"
                disabled={busy || !selectedAgentId}
              >
                <Text size="B300">
                  {busy ? t('threadActions.saving') : t('threadActions.sendRequest')}
                </Text>
              </Button>
            </Box>
          </Box>
        </form>
      </ActionDialog>
    );
  }

  // Escape and outside clicks wait for a resolve or pin save, so its result shows in the menu.
  // The menu closes once the trap has let go of focus, which the caller may then hand back to
  // the trigger; while the trap still holds, it would pull that focus back into the menu.
  const closeMenu = () => {
    if (savingRef.current) return false;
    queueMicrotask(() => onCloseRef.current());
    return true;
  };

  // The thread's own details (tags, title) first, then its state (resolved, snoozed, pinned), then
  // its copy, the link, whether it shows tool calls, and the banner's Show beside and Hide; each
  // label has its icon at the end of the row.
  const items: Array<{
    action: string;
    label: string;
    icon: IconSrc;
    onSelect: () => void;
    /** Resolve, snooze and pin wait for the previous save. */
    mutates?: boolean;
    shortcut?: ShortcutId;
    /** A switch: checked while on. */
    checked?: boolean;
  }> = [];
  if (onOpenThread) {
    items.push({
      action: 'open',
      label: t('threadActions.open'),
      icon: Icons.Thread,
      onSelect: onOpenThread,
    });
  }
  if (secondThread?.offers(rootId)) {
    items.push({
      action: 'openBeside',
      label: t('threadActions.openBeside'),
      icon: Icons.ThreadPlus,
      onSelect: () => {
        secondThread.open(rootId);
        onClose();
      },
    });
  }
  if (showTags) {
    items.push({
      action: 'tags',
      label: tagsEditable ? t('threadActions.tags') : t('thread.stats.tags'),
      icon: Icons.Bookmark,
      onSelect: () => openDialog('tags'),
    });
  }
  if (canSummarize) {
    items.push(
      {
        action: 'editSummary',
        label: t('threadActions.editSummary'),
        icon: Icons.Pencil,
        onSelect: () => openDialog('editSummary'),
      },
      {
        action: 'regenerate',
        label: t('threadActions.regenerate'),
        icon: Icons.Bulb,
        onSelect: () => openDialog('regenerate'),
      }
    );
  }
  if (tags.canEdit && rootLoaded && !pinned) {
    items.push({
      action: 'resolve',
      mutates: true,
      label: tags.isResolved ? t('threadActions.reopen') : t('thread.resolve'),
      icon: tags.isResolved ? Icons.Reload : Icons.CheckTwice,
      // The shortcut resolves the open thread, whose menu has no Open.
      shortcut: onOpenThread ? undefined : 'resolveThread',
      onSelect: () => {
        void mutations.setResolved(rootId, !tags.isResolved);
      },
    });
  }
  // A resolved thread shows as resolved whether snoozed or not, so it offers neither. A pinned
  // thread takes no new snooze, but one set before the pin can still be lifted.
  if (tags.canEdit && rootLoaded && !tags.isResolved && (snoozed || !pinned)) {
    items.push({
      action: 'snooze',
      mutates: true,
      label: snoozed ? t('thread.unsnooze') : t('thread.snooze'),
      icon: Icons.Clock,
      onSelect: () => {
        if (snoozed) void mutations.unsnooze(rootId);
        else openDialog('snooze');
      },
    });
  }
  if (pinning.canPin && rootLoaded) {
    items.push({
      action: 'pin',
      mutates: true,
      label: pinned ? t('threadNav.unpin') : t('threadNav.pin'),
      icon: Icons.Pin,
      onSelect: () => {
        void pinning.setPinned(rootId, !pinned);
      },
    });
  }
  // The copy of the open thread (the card's has Open instead): a fork at its latest message.
  const forkPoint = onOpenThread || !forksAnswered ? undefined : latestForkPoint(room, rootId);
  if (forkPoint) {
    items.push({
      action: 'fork',
      label: t('threadFork.forkThread'),
      icon: ForkIcon,
      onSelect: () => {
        startFork(forkPoint);
        onClose();
      },
    });
  }
  items.push({
    action: 'copy',
    label: t('threadActions.copy'),
    icon: Icons.Link,
    onSelect: handleCopyLink,
  });
  // Agents' replies list the tools they ran; this thread's choice, over its room's. Invited agents
  // count, as in the room menu.
  if (hasActiveMindroomAgent(members)) {
    items.push({
      action: 'toolCalls',
      label: t('mindroomUi.messages.showToolCalls'),
      icon: Icons.Terminal,
      checked: toolCallsShown,
      onSelect: () => {
        setToolCallsShown(!toolCallsShown);
        onClose();
      },
    });
  }
  if (onShowBeside) {
    items.push({
      action: 'showBeside',
      label: t('thread.showBeside'),
      icon: ShrinkIcon,
      onSelect: () => {
        onShowBeside();
        onClose();
      },
    });
  }
  if (onShowFull) {
    items.push({
      action: 'showFull',
      label: t('thread.showFull'),
      icon: ExpandIcon,
      onSelect: () => {
        onShowFull();
        onClose();
      },
    });
  }
  if (onHideDetails) {
    items.push({
      action: 'hideDetails',
      label: t('thread.hideDetails'),
      icon: Icons.ChevronTop,
      onSelect: () => {
        onHideDetails();
        onClose();
      },
    });
  }

  // The menu opens under its trigger, its end edge on the trigger's end edge.
  return (
    <PopOut
      anchor={menuAnchor}
      offset={4}
      align="End"
      position="Bottom"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: closeMenu,
            escapeDeactivates: closeMenu,
          }}
        >
          <Menu
            ref={surfaceRef}
            role="menu"
            aria-label={t('threadActions.more')}
            aria-describedby={described ? detailsId : undefined}
            className={css.ThreadMenu}
            style={menuStyle}
          >
            <div className={css.ThreadMenuRows}>
              {details.length > 0 && (
                <div className={css.ThreadMenuDetails}>
                  <div
                    id={detailsId}
                    data-thread-details=""
                    style={{ maxWidth: toRem(320), padding: config.space.S300 }}
                  >
                    <ThreadDetailsList room={room} threadId={rootId} details={details} />
                  </div>
                  <Line variant="Surface" size="300" />
                </div>
              )}
              <MenuGroup>
                {items.map((item) => (
                  <MenuEntry
                    key={item.action}
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={item.checked}
                    label={item.label}
                    icon={item.icon}
                    after={item.checked ? <Icon size="100" src={Icons.Check} /> : undefined}
                    shortcut={item.shortcut}
                    data-thread-action={item.action}
                    disabled={item.mutates && saving}
                    aria-busy={item.mutates && saving ? true : undefined}
                    onSelect={() => item.onSelect()}
                  />
                ))}
              </MenuGroup>
            </div>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
