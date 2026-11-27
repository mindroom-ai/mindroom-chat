import React, {
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FocusTrap } from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Icons, Line, Text, config, toRem, type RectCords } from 'folds';
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
import {
  buildThreadActionMenuGroups,
  ThreadActionsMenuContent,
  type ThreadActionMenuItem,
} from './ThreadActionsMenuContent';
import { ActionDialog } from '../ui/ActionDialog';
import { describeError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';
import { useToolCallsShown } from '../messages/toolCallVisibility';
import { isSnoozedAt } from '../event-store/threads/threadSnooze';
import { useSnoozeNow } from './tags/useSnoozeNow';
import { SnoozePicker } from './tags/SnoozePicker';
import { usePluginClientConfig } from '../plugins/pluginConfig';
import { registeredPlugins, type RegisteredPlugin } from '../plugins/registry';
import { shownThreadDetails } from '../plugins/threadDetails';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { ThreadDetailsList } from './ThreadDetailsList';
import { SecondThreadContext } from '../navigation/secondThread';
import * as css from './ThreadActionsMenu.css';
import { latestForkPoint } from '../event-store/threads/threadFork';
import { ForkIcon } from '../messages/ForkIcon';
import { useStartThreadFork } from './fork/useStartThreadFork';
import { ForkToRoomDialog } from './fork/ForkToRoomDialog';

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
  /** The menu of a view the keys do not act on (a second thread's banner): it advertises none. */
  shortcutless?: boolean;
  /**
   * The banner shows no tags (a phone's): the menu starts with them, removable and with the tag
   * picker for an editor, in place of Edit tags.
   */
  tagsAtTop?: boolean;
  /** Opens directly on this dialog instead of the actions menu. */
  initialDialog?: 'snooze';
};

type OpenDialog = 'tags' | 'editSummary' | 'regenerate' | 'snooze' | 'forkToRoom';

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
 * Thread options, grouped as open (card menu), triage (resolve, snooze, pin), details (tags,
 * edit or regenerate the summary), fork & share (fork, fork to room, copy a link), and view
 * (tool calls, layout, hide details).
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
  shortcutless = false,
  tagsAtTop = false,
  initialDialog,
  plugins = registeredPlugins,
}: ThreadActionsMenuProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const tags = useThreadTags(room, rootId);
  const mutations = useMutateThreadTags(room);
  const pinning = useThreadPinning(room);
  const members = useRoomMembers(mx, room.roomId);
  const [toolCallsShown, setToolCallsShown] = useToolCallsShown(room.roomId, rootId);
  const startFork = useStartThreadFork(room);
  // Where agents answer in the room, they answer a fork there too, and it stays empty.
  const forksAnswered = useRoomThreadMode(room.roomId, !onOpenThread) !== 'room';

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Deactivate the focus trap before calling the parent's onClose so it can return focus to the trigger.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (closing) onCloseRef.current();
  }, [closing]);
  const closeFromDetail = useCallback(() => setClosing(true), []);
  const [dialog, setDialog] = useState<OpenDialog | undefined>(initialDialog);
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
  const tagsInMenu = tagsAtTop && showTags;
  // A tag added or removed at the menu's top is saved whether the menu stays or not.
  const [tagWrite, setTagWrite] = useState(false);
  // Resolve, Unsnooze and pin keep the menu open on their new label; it closes once their save is
  // done.
  const saving = tagsUpdating || !!pinning.updating;
  const savingRef = useRef(saving);
  savingRef.current = (tagsUpdating && !tagWrite) || !!pinning.updating;

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

  const clientConfig = usePluginClientConfig();
  // Keep the contributions selected when this opening mounted.
  const [details] = useState(() =>
    isConfirmedMatrixEventId(rootId) ? shownThreadDetails(plugins, clientConfig, room, rootId) : []
  );
  const detailsId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [described, setDescribed] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    // Without details, the menu has no description. (The pop-out places itself again when lazy
    // details resize it.)
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
    return () => mutations.disconnect();
  }, [dialog, details]);

  const tagSectionRef = useRef<HTMLDivElement>(null);
  const writeTag = (write: () => Promise<void>) => {
    setTagWrite(true);
    void write().finally(() => setTagWrite(false));
  };
  // A ✕ pressed with the focus goes as its tag does (at once, before the save is done): the focus
  // waits on the tags section, from where Tab reaches the first ✕.
  const removeTag = (tagName: string) => {
    const section = tagSectionRef.current;
    if (section?.contains(section.ownerDocument.activeElement)) section.focus();
    writeTag(() => mutations.removeTag(rootId, tagName));
  };

  // The thread's tags, removable and with the tag picker for an editor; a save shows its failure
  // here. At the menu's top, the tags wrap onto rows set apart for their ✕es' touch areas, and a
  // ✕ waiting for a save stays where it is.
  const tagEditor = (inMenu: boolean) => (
    <>
      <Box
        wrap="Wrap"
        gap="200"
        alignItems="Center"
        style={inMenu ? { columnGap: '0.5rem', rowGap: '0.75rem' } : undefined}
      >
        {tags.displayTags.map((tagName) => {
          let onRemove: (() => void) | undefined;
          if (inMenu && tagsEditable) onRemove = () => removeTag(tagName);
          else if (tagsEditable && !tagsUpdating) {
            onRemove = () => void mutations.removeTag(rootId, tagName);
          }
          return (
            <ThreadTagPill
              key={tagName}
              name={tagName}
              onRemove={onRemove}
              removeBusy={inMenu && tagsUpdating}
            />
          );
        })}
        {tagsEditable && (
          <ThreadTagPicker
            availableTags={tags.availableTags}
            onAddTag={(tagName) =>
              inMenu
                ? writeTag(() => mutations.addTag(rootId, tagName))
                : void mutations.addTag(rootId, tagName)
            }
            disabled={tagsUpdating}
          />
        )}
      </Box>
      {mutations.error && (
        <Text role="alert" size="T200">
          {t('threadActions.failed')}
        </Text>
      )}
    </>
  );

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
        {tagEditor(false)}
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

  if (dialog === 'forkToRoom') {
    const latestPoint = latestForkPoint(room, rootId);
    if (latestPoint) {
      return (
        <ForkToRoomDialog
          sourceRoom={room}
          onSelect={(targetRoomId) => {
            startFork(latestPoint, targetRoomId);
            onClose();
          }}
          onClose={onClose}
        />
      );
    }
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

  // Grouped with open (card menu) and triage (resolve, snooze, pin) unlabelled on top, followed by
  // Details (tags, summary), Fork & Share / Share (fork, link), and View (tool calls, layout,
  // hide details); each label has its icon at the end of the row.
  const openItems: ThreadActionMenuItem[] = [];
  if (onOpenThread) {
    openItems.push({
      action: 'open',
      label: t('threadActions.open'),
      icon: Icons.Thread,
      onSelect: onOpenThread,
    });
  }
  const secondThread = use(SecondThreadContext);
  if (secondThread?.offers(room.roomId, rootId)) {
    openItems.push({
      action: 'openBeside',
      label: t('threadActions.openBeside'),
      icon: Icons.ThreadPlus,
      onSelect: () => {
        secondThread.open(room.roomId, rootId);
        onClose();
      },
    });
  }

  // The copy of the open thread (the card's has Open instead): a fork at its latest message.
  const latestPoint = onOpenThread ? undefined : latestForkPoint(room, rootId);
  const forkItems: ThreadActionMenuItem[] = [];
  if (latestPoint && forksAnswered) {
    forkItems.push({
      action: 'fork',
      label: t('threadFork.forkThread'),
      icon: ForkIcon,
      onSelect: () => {
        startFork(latestPoint);
        onClose();
      },
    });
  }
  if (latestPoint) {
    forkItems.push({
      action: 'forkToRoom',
      label: t('threadFork.forkToRoom'),
      icon: ForkIcon,
      onSelect: () => openDialog('forkToRoom'),
    });
  }

  const viewItems: ThreadActionMenuItem[] = [];
  if (onShowBeside) {
    viewItems.push({
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
    viewItems.push({
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
    viewItems.push({
      action: 'hideDetails',
      label: t('thread.hideDetails'),
      icon: Icons.ChevronTop,
      onSelect: () => {
        onHideDetails();
        onClose();
      },
    });
  }

  const groups = buildThreadActionMenuGroups({
    t,
    openItems,
    showTags: showTags && !tagsAtTop,
    tagsEditable,
    canSummarize,
    canEditState: tags.canEdit && rootLoaded,
    canPin: pinning.canPin && rootLoaded,
    pinned,
    isResolved: tags.isResolved,
    snoozed,
    // The shortcut resolves the open thread, whose menu has no Open.
    resolveShortcut: onOpenThread || shortcutless ? undefined : 'resolveThread',
    forkItems,
    // Agents' replies list the tools they ran; this thread's choice, over its room's. Invited
    // agents count, as in the room menu.
    showToolCalls: hasActiveMindroomAgent(members) ? toolCallsShown : undefined,
    viewItems,
    onTags: () => openDialog('tags'),
    onEditSummary: () => openDialog('editSummary'),
    onRegenerate: () => openDialog('regenerate'),
    onResolve: () => {
      void mutations.setResolved(rootId, !tags.isResolved);
    },
    onSnooze: () => {
      if (snoozed) void mutations.unsnooze(rootId);
      else openDialog('snooze');
    },
    onPin: () => {
      void pinning.setPinned(rootId, !pinned);
    },
    onCopy: handleCopyLink,
    onToggleToolCalls: () => setToolCallsShown(!toolCallsShown),
  });

  // The menu opens under its trigger, its end edge on the trigger's end edge.
  return (
    <PopOut
      anchor={anchor}
      offset={4}
      align="End"
      position="Bottom"
      content={
        <FocusTrap
          active={!closing}
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: closeMenu,
            escapeDeactivates: closeMenu,
          }}
        >
          <ThreadActionsMenuContent
            ref={surfaceRef}
            label={t('threadActions.more')}
            groups={groups}
            saving={saving}
            ariaDescribedBy={described ? detailsId : undefined}
            before={
              <>
                {/* The tag buttons are reached with Tab; arrow keys move across the menu items in details and rows. */}
                {tagsInMenu && (
                  <div
                    ref={tagSectionRef}
                    role="group"
                    tabIndex={-1}
                    className={css.ThreadMenuTags}
                    aria-label={t('thread.stats.tags')}
                    data-thread-menu-tags=""
                  >
                    <Box
                      direction="Column"
                      gap="200"
                      style={{ maxWidth: toRem(320), padding: config.space.S300 }}
                    >
                      {tagEditor(true)}
                    </Box>
                    <Line variant="Surface" size="300" />
                  </div>
                )}
                {details.length > 0 && (
                  <div className={css.ThreadMenuDetails}>
                    <div
                      id={detailsId}
                      data-thread-details=""
                      style={{ maxWidth: toRem(320), padding: config.space.S300 }}
                    >
                      <ThreadDetailsList
                        room={room}
                        threadId={rootId}
                        details={details}
                        onClose={closeFromDetail}
                      />
                    </div>
                    <Line variant="Surface" size="300" />
                  </div>
                )}
              </>
            }
          />
        </FocusTrap>
      }
    />
  );
}
