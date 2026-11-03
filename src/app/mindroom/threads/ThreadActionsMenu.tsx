import React, { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Text,
  type RectCords,
} from 'folds';
import {
  getThreadSummaryActionError,
  requestThreadSummary,
  saveThreadSummary,
  SUMMARY_MAX_LENGTH,
} from './threadSummaryActions';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import { ThreadTagPicker } from './ThreadTagPicker';
import { ThreadTagPill } from './ThreadTagPill';
import { useThreadPinning } from './useThreadPinning';
import { useMutateThreadTags } from './useMutateThreadTags';
import { useThreadTags } from './useThreadTags';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { getViaServers } from '../../plugins/via-servers';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { copyToClipboard } from '../../utils/dom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';

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
};

type ActionDialog = 'tags' | 'editSummary' | 'regenerate';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const dialogStyle: React.CSSProperties = {
  width: 'min(28rem, calc(100vw - 2rem))',
  padding: '1rem',
};

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

type ActionDialogFrameProps = {
  label: string;
  onClose: () => void;
  /** While a request runs Escape and outside clicks do nothing. */
  busy: boolean;
  children: React.ReactNode;
};

function ActionDialogFrame({ label, onClose, busy, children }: ActionDialogFrameProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // focus-trap reads its options once; the callbacks read the latest props through refs.
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  const requestClose = () => {
    if (latest.current.busy) return false;
    latest.current.onClose();
    return true;
  };
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            clickOutsideDeactivates: requestClose,
            escapeDeactivates: requestClose,
            // With every control disabled the dialog itself keeps focus.
            fallbackFocus: () => dialogRef.current ?? document.body,
          }}
        >
          <Dialog
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            style={dialogStyle}
          >
            <Box direction="Column" gap="300">
              <Text size="H4">{label}</Text>
              {children}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** Thread options: open, tags, resolve, pin, edit or regenerate the summary, copy a link. */
export function ThreadActionsMenu({
  room,
  rootId,
  summaryText,
  anchor,
  onClose,
  onOpenThread,
  onHideDetails,
}: ThreadActionsMenuProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const tags = useThreadTags(room, rootId);
  const mutations = useMutateThreadTags(room);
  const pinning = useThreadPinning(room);
  const members = useRoomMembers(mx, room.roomId);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dialog, setDialog] = useState<ActionDialog>();
  const [draft, setDraft] = useState(summaryText ?? '');
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string>();
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

  const openDialog = (next: ActionDialog) => {
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
      setRequestError(errorText(error));
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
      <ActionDialogFrame label={label} onClose={closeDialog} busy={false}>
        <Box wrap="Wrap" gap="200" alignItems="Center">
          {tags.displayTags.map((tagName) => (
            <ThreadTagPill
              key={tagName}
              name={tagName}
              onRemove={
                tagsEditable && !tagsUpdating
                  ? () => mutations.removeTag(rootId, tagName)
                  : undefined
              }
            />
          ))}
          {tagsEditable && (
            <ThreadTagPicker
              availableTags={tags.availableTags}
              onAddTag={(tagName) => mutations.addTag(rootId, tagName)}
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
      </ActionDialogFrame>
    );
  }

  if (dialog === 'editSummary') {
    const length = Array.from(draft.trim()).length;
    return (
      <ActionDialogFrame label={t('threadActions.editSummary')} onClose={closeDialog} busy={busy}>
        <form onSubmit={handleSaveSummary}>
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
                {requestError}
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
      </ActionDialogFrame>
    );
  }

  if (dialog === 'regenerate' && requested) {
    return (
      <ActionDialogFrame label={t('threadActions.regenerate')} onClose={closeDialog} busy={false}>
        <Text role="status" size="T300">
          {t('threadActions.requested')}
        </Text>
        <Box justifyContent="End">
          <Button ref={doneRef} type="button" size="300" variant="Primary" onClick={closeDialog}>
            <Text size="B300">{t('threadActions.done')}</Text>
          </Button>
        </Box>
      </ActionDialogFrame>
    );
  }

  if (dialog === 'regenerate') {
    return (
      <ActionDialogFrame label={t('threadActions.regenerate')} onClose={closeDialog} busy={busy}>
        <form onSubmit={handleRegenerate}>
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
                {requestError}
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
      </ActionDialogFrame>
    );
  }

  // Escape and outside clicks wait for a resolve or pin save, so its result shows in the menu.
  const closeMenu = () => {
    if (savingRef.current) return false;
    onCloseRef.current();
    return true;
  };

  const items: Array<{
    action: string;
    label: string;
    onSelect: () => void;
    /** Resolve and pin wait for the previous save. */
    mutates?: boolean;
  }> = [];
  if (onOpenThread) {
    items.push({ action: 'open', label: t('threadActions.open'), onSelect: onOpenThread });
  }
  if (showTags) {
    items.push({
      action: 'tags',
      label: tagsEditable ? t('threadActions.tags') : t('thread.stats.tags'),
      onSelect: () => openDialog('tags'),
    });
  }
  if (tags.canEdit && rootLoaded && !pinned) {
    items.push({
      action: 'resolve',
      mutates: true,
      label: tags.isResolved ? t('threadActions.reopen') : t('thread.resolve'),
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
      onSelect: () => {
        void pinning.setPinned(rootId, !pinned);
      },
    });
  }
  if (canSummarize) {
    items.push(
      {
        action: 'editSummary',
        label: t('threadActions.editSummary'),
        onSelect: () => openDialog('editSummary'),
      },
      {
        action: 'regenerate',
        label: t('threadActions.regenerate'),
        onSelect: () => openDialog('regenerate'),
      }
    );
  }
  items.push({ action: 'copy', label: t('threadActions.copy'), onSelect: handleCopyLink });
  if (onHideDetails) {
    items.push({
      action: 'hideDetails',
      label: t('thread.hideDetails'),
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
          <Menu role="menu" aria-label={t('threadActions.more')} style={{ minWidth: '12rem' }}>
            <Box direction="Column" style={{ padding: '0.25rem' }}>
              {items.map((item) => (
                <MenuItem
                  key={item.action}
                  role="menuitem"
                  size="300"
                  radii="300"
                  data-thread-action={item.action}
                  disabled={item.mutates && saving}
                  aria-busy={item.mutates && saving ? true : undefined}
                  onClick={() => item.onSelect()}
                >
                  <Text size="T300">{item.label}</Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
