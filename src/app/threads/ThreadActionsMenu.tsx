import React, { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Icons, Text, config, toRem, type IconSrc, type RectCords } from 'folds';
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
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { getViaServers } from '../matrix/via-servers';
import { getMatrixToRoomEvent } from '../matrix/matrix-to';
import { copyToClipboard } from '../lib/dom';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { ActionDialog } from '../ui/ActionDialog';
import { describeError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';

export type ThreadActionsMenuProps = {
  room: Room;
  rootId: string;
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

type OpenDialog = 'tags' | 'editSummary' | 'regenerate';

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

/** Thread options: open, tags, edit or regenerate the summary, resolve, pin, copy a link. */
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
}: ThreadActionsMenuProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const tags = useThreadTags(room, rootId);
  const mutations = useMutateThreadTags(room);
  const pinning = useThreadPinning(room);
  const members = useRoomMembers(mx, room.roomId);

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
  const canSummarize = getThreadSummaryActionError(mx, room, rootId) === undefined;
  const showTags = tags.canEdit
    ? rootLoaded || tags.displayTags.length > 0
    : tags.displayTags.length > 0;
  const tagsEditable = tags.canEdit && rootLoaded;
  const tagsUpdating = !!mutations.updating;
  // Resolve and pin keep the menu open on their new label; it closes once their save is done.
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
              maxLength={SUMMARY_MAX_LENGTH * 2}
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

  // The thread's own details (tags, title) first, then its state (resolved, pinned), then the link
  // and the banner's Show beside and Hide; each label has its icon at the end of the row.
  const items: Array<{
    action: string;
    label: string;
    icon: IconSrc;
    onSelect: () => void;
    /** Resolve and pin wait for the previous save. */
    mutates?: boolean;
    shortcut?: ShortcutId;
  }> = [];
  if (onOpenThread) {
    items.push({
      action: 'open',
      label: t('threadActions.open'),
      icon: Icons.Thread,
      onSelect: onOpenThread,
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
  items.push({
    action: 'copy',
    label: t('threadActions.copy'),
    icon: Icons.Link,
    onSelect: handleCopyLink,
  });
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
      anchor={anchor}
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
          <Menu role="menu" aria-label={t('threadActions.more')} style={menuStyle}>
            <MenuGroup>
              {items.map((item) => (
                <MenuEntry
                  key={item.action}
                  role="menuitem"
                  label={item.label}
                  icon={item.icon}
                  shortcut={item.shortcut}
                  data-thread-action={item.action}
                  disabled={item.mutates && saving}
                  aria-busy={item.mutates && saving ? true : undefined}
                  onSelect={() => item.onSelect()}
                />
              ))}
            </MenuGroup>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
