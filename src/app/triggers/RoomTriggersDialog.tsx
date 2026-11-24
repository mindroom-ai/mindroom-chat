import {
  Fragment,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, IconButton, Icons, Text, type IconSrc } from 'folds';
import { localDigits } from '../lib/localDigits';
import { dateTimeFormat } from '../lib/time';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { DialogCloseButton } from '../ui/DialogChrome';
import { revealDirectionControls } from '../ui/directional';
import { Header, Modal } from '../ui/glass/GlassPrimitives';
import { PageScroll } from '../ui/page/PageScroll';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isUserId } from '../matrix/matrix';
import { getMatrixToUser } from '../matrix/matrix-to';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import {
  makeMentionCustomProps,
  renderMatrixMention,
} from '../messages/html/react-custom-html-parser';
import { renderSchedulePrompt } from '../schedules/schedulePrompt';
import * as schedCss from '../schedules/roomSchedules.css';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger, TriggerKind, TriggerThreadMode } from './roomTriggersApi';
import * as css from './roomTriggers.css';

const LONG_PROMPT_CHAR_LIMIT = 180;
const LONG_PROMPT_LINE_LIMIT = 3;
const BTN = { type: 'button', size: '300', radii: '300' } as const;
const COMPACT_BTN = { ...BTN, variant: 'Secondary', className: schedCss.CompactAction } as const;
const ICON_BTN = { ...BTN, fill: 'None', className: schedCss.IconAction } as const;
const CONFIRM_BTN = { ...BTN, className: schedCss.CancelBarButton } as const;

const KIND_ICONS: Record<TriggerKind, IconSrc> = {
  webhook: TriggersIcon,
  room_message: Icons.Eye,
  external_event: Icons.Bell,
  thread_tag: Icons.Bookmark,
};

const DESTINATION_KEYS: Record<TriggerThreadMode, string> = {
  room: 'roomTriggers.destinationRoom',
  thread: 'roomTriggers.destinationThread',
  new_thread: 'roomTriggers.destinationNewThread',
  origin: 'roomTriggers.destinationOrigin',
};

const isLongPrompt = (prompt: string) =>
  prompt.length > LONG_PROMPT_CHAR_LIMIT || prompt.split('\n').length > LONG_PROMPT_LINE_LIMIT;

const MetaRow = ({
  label,
  children,
  wrap,
}: {
  label: string;
  children: ReactNode;
  wrap?: boolean;
}) => (
  <>
    <Text as="dt" size="T200" className={schedCss.MetaLabel}>
      {label}
    </Text>
    <Text as="dd" size="T200" className={wrap ? schedCss.Wrap : undefined}>
      {children}
    </Text>
  </>
);

type TriggerRowProps = {
  roomId: string;
  trigger: RoomTrigger;
  highlighted: boolean;
  formatter: Intl.DateTimeFormat;
  renderOwner: (userId: string) => ReactNode;
  targetRoomLabel: (targetRoomId: string) => string;
  articleRef?: (node: HTMLElement | null) => void;
  onOpenThread: (threadId: string, targetRoomId?: string) => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
};

function TriggerRow({
  roomId,
  trigger,
  highlighted,
  formatter,
  renderOwner,
  targetRoomLabel,
  articleRef,
  onOpenThread,
  onToggleTrigger,
  onDeleteTrigger,
}: TriggerRowProps) {
  const { t } = useTranslation();
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const relativeLastFired = useRelativeTime(trigger.lastFiredAt ?? undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => setPromptExpanded(false), [trigger.prompt]);
  useEffect(() => {
    if (!trigger.canManage) setConfirmingDelete(false);
  }, [trigger.canManage]);
  useEffect(() => {
    if (confirmingDelete) keepButtonRef.current?.focus();
  }, [confirmingDelete]);

  const kindLabel = t(`roomTriggers.kind.${trigger.kind}`);
  const trimmedDescription = trigger.description.trim();
  const hasDescription = trimmedDescription.length > 0;
  const title = hasDescription ? revealDirectionControls(trimmedDescription) : kindLabel;
  const promptText = trigger.prompt?.trim() ? trigger.prompt : undefined;
  const longPrompt = promptText !== undefined && isLongPrompt(promptText);
  const busy = toggling || deleting;
  const showDeleteBar = trigger.canManage && (confirmingDelete || deleting || deleteError);

  const disabledReasonNode: ReactNode =
    !trigger.enabled && trigger.disabledReason && trigger.disabledReason !== 'manual'
      ? trigger.disabledReason === 'expired'
        ? t('roomTriggers.disabledExpired')
        : trigger.disabledReason === 'once_consumed'
          ? t('roomTriggers.disabledOnceConsumed')
          : <bdi>{revealDirectionControls(trigger.disabledReason)}</bdi>
      : undefined;

  const lastFiredNode: ReactNode =
    trigger.lastFiredAt !== null ? (
      <time
        dateTime={new Date(trigger.lastFiredAt).toISOString()}
        title={formatter.format(trigger.lastFiredAt)}
      >
        {t('roomTriggers.lastFired', { time: relativeLastFired })}
      </time>
    ) : (
      t('roomTriggers.neverFired')
    );

  const subtitleParts: ReactNode[] = [
    hasDescription ? kindLabel : undefined,
    trigger.relation === 'watch' ? t('roomTriggers.watchingRoom') : undefined,
    t(DESTINATION_KEYS[trigger.threadMode]),
    disabledReasonNode,
    lastFiredNode,
  ].filter(Boolean);

  const handleToggle = async () => {
    if (!trigger.canManage || busy) return;
    setToggling(true);
    setToggleError(false);
    try {
      await onToggleTrigger(trigger.triggerId, !trigger.enabled);
    } catch {
      if (mountedRef.current) setToggleError(true);
    } finally {
      if (mountedRef.current) setToggling(false);
    }
  };

  const handleKeepDelete = () => {
    if (deleting) return;
    setConfirmingDelete(false);
    setDeleteError(false);
    deleteButtonRef.current?.focus();
  };

  const handleConfirmDelete = async () => {
    if (!trigger.canManage || busy) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDeleteTrigger(trigger.triggerId);
      if (mountedRef.current) setConfirmingDelete(false);
    } catch {
      if (mountedRef.current) setDeleteError(true);
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  };

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className={classNames(schedCss.Item, css.TriggerCard)}
      data-trigger-id={trigger.triggerId}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      <div className={css.CardHeader}>
        <span
          className={trigger.enabled ? schedCss.IconTile.primary : css.IconTileNeutral}
          aria-hidden="true"
        >
          <Icon size="100" src={KIND_ICONS[trigger.kind]} />
        </span>
        <span className={schedCss.RowBody}>
          <span className={schedCss.RowTopLine}>
            <Text
              as="h3"
              size="H5"
              className={classNames(schedCss.RowTitle, schedCss.Wrap)}
              dir="auto"
            >
              {title}
            </Text>
            <span className={trigger.enabled ? schedCss.StatusPill.success : css.StatusPillNeutral}>
              {t(trigger.enabled ? 'roomTriggers.stateOn' : 'roomTriggers.stateOff')}
            </span>
          </span>
          <span className={schedCss.RowSubtitle}>
            {subtitleParts.map((node, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <span className={schedCss.SubtitleDot} aria-hidden="true">
                    ·
                  </span>
                )}
                <Text as="span" size="T200" className={schedCss.Wrap}>
                  {node}
                </Text>
              </Fragment>
            ))}
          </span>
        </span>
      </div>

      <div className={css.CardBody}>
        {promptText !== undefined && (
          <div className={schedCss.PromptWell} role="region" aria-label={t('roomTriggers.prompt')}>
            <Text
              id={`${id}-prompt`}
              as="p"
              size="T300"
              className={classNames(
                schedCss.Prompt,
                longPrompt && !promptExpanded && schedCss.PromptClamped
              )}
              dir="auto"
            >
              {renderSchedulePrompt(promptText)}
            </Text>
            {longPrompt && (
              <button
                type="button"
                className={schedCss.PromptToggle}
                aria-controls={`${id}-prompt`}
                aria-expanded={promptExpanded}
                onClick={() => setPromptExpanded((value) => !value)}
              >
                <Text as="span" size="T200">
                  {t(promptExpanded ? 'roomTriggers.showLessPrompt' : 'roomTriggers.showFullPrompt')}
                </Text>
              </button>
            )}
          </div>
        )}

        <div className={schedCss.ActionsRow}>
          <div className={schedCss.ActionsPrimary}>
            {trigger.targetThreadId && (
              <Button
                {...COMPACT_BTN}
                fill="Soft"
                outlined
                onClick={() =>
                  onOpenThread(trigger.targetThreadId!, trigger.targetRoomId ?? undefined)
                }
              >
                <Icon size="100" src={Icons.Thread} />
                <Text size="T200">{t('roomTriggers.openThread')}</Text>
              </Button>
            )}
            <Button
              {...COMPACT_BTN}
              fill="None"
              aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? `${id}-details` : undefined}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              <Text size="T200">
                {t(detailsOpen ? 'roomTriggers.hideDetails' : 'roomTriggers.details')}
              </Text>
            </Button>
          </div>

          {trigger.canManage && (
            <div className={schedCss.ActionsSecondary}>
              <Button
                {...COMPACT_BTN}
                fill="Soft"
                aria-disabled={busy || undefined}
                onClick={() => void handleToggle()}
              >
                <Text size="T200">
                  {t(
                    toggling
                      ? 'roomTriggers.updating'
                      : trigger.enabled
                        ? 'roomTriggers.disable'
                        : 'roomTriggers.enable'
                  )}
                </Text>
              </Button>
              <IconButton
                ref={deleteButtonRef}
                {...ICON_BTN}
                variant="Critical"
                aria-label={t('roomTriggers.delete')}
                title={t('roomTriggers.delete')}
                aria-expanded={showDeleteBar}
                aria-controls={showDeleteBar ? `${id}-confirm` : undefined}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  if (showDeleteBar) handleKeepDelete();
                  else setConfirmingDelete(true);
                }}
              >
                <Icon
                  size="100"
                  src={Icons.Delete}
                  className={busy ? schedCss.IconMuted : undefined}
                />
              </IconButton>
            </div>
          )}
        </div>

        {toggleError && (
          <Text size="T200" role="alert" className={schedCss.CancelError}>
            {t('roomTriggers.toggleError')}
          </Text>
        )}

        {showDeleteBar && (
          <div
            id={`${id}-confirm`}
            role="group"
            aria-labelledby={`${id}-confirm-q`}
            className={schedCss.CancelBar}
          >
            <Text id={`${id}-confirm-q`} size="T200">
              {t('roomTriggers.deleteConfirm')}
            </Text>
            {deleteError && (
              <Text size="T200" role="alert" className={schedCss.CancelError}>
                {t('roomTriggers.deleteError')}
              </Text>
            )}
            <div className={schedCss.CancelBarActions}>
              <Button
                ref={keepButtonRef}
                {...CONFIRM_BTN}
                variant="Secondary"
                fill="Soft"
                aria-describedby={`${id}-confirm-q`}
                aria-disabled={deleting || undefined}
                onClick={handleKeepDelete}
              >
                <Text size="T200">{t('roomTriggers.keep')}</Text>
              </Button>
              <Button
                {...CONFIRM_BTN}
                variant="Critical"
                fill="Solid"
                aria-disabled={deleting || undefined}
                onClick={() => void handleConfirmDelete()}
              >
                <Text size="T200">
                  {t(deleting ? 'roomTriggers.deleting' : 'roomTriggers.deleteTrigger')}
                </Text>
              </Button>
            </div>
          </div>
        )}

        {detailsOpen && (
          <dl id={`${id}-details`} className={schedCss.Metadata}>
            <MetaRow label={t('roomTriggers.triggerId')} wrap>
              <code className={schedCss.TaskId}>
                <bdi>{revealDirectionControls(trigger.triggerId)}</bdi>
              </code>
            </MetaRow>
            {trigger.ownerUserId && (
              <MetaRow label={t('roomTriggers.owner')} wrap>
                <bdi>{renderOwner(trigger.ownerUserId) ?? trigger.ownerUserId}</bdi>
              </MetaRow>
            )}
            {trigger.agent && (
              <MetaRow label={t('roomTriggers.agent')} wrap>
                <bdi>{revealDirectionControls(trigger.agent)}</bdi>
              </MetaRow>
            )}
            {trigger.targetRoomId && trigger.targetRoomId !== roomId && (
              <MetaRow label={t('roomTriggers.targetRoom')} wrap>
                <bdi>{revealDirectionControls(targetRoomLabel(trigger.targetRoomId))}</bdi>
              </MetaRow>
            )}
            {trigger.once && (
              <MetaRow label={t('roomTriggers.once')}>{t('roomTriggers.stateOn')}</MetaRow>
            )}
            {trigger.expiresAt !== null && (
              <MetaRow label={t('roomTriggers.expiresAt')}>
                <time dateTime={new Date(trigger.expiresAt).toISOString()}>
                  {formatter.format(trigger.expiresAt)}
                </time>
              </MetaRow>
            )}
            {trigger.lastFiredAt !== null && (
              <MetaRow label={t('roomTriggers.lastFiredLabel')}>
                <time dateTime={new Date(trigger.lastFiredAt).toISOString()}>
                  {formatter.format(trigger.lastFiredAt)}
                </time>
              </MetaRow>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}

export type RoomTriggersDialogProps = {
  roomId: string;
  triggers: readonly RoomTrigger[];
  loading?: boolean;
  highlightTriggerId?: string;
  /** Distinct object per open request so re-opening for the same trigger re-focuses it. */
  highlightRequest?: object;
  onClose: () => void;
  onOpenThread: (threadId: string, targetRoomId?: string) => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
};

export const RoomTriggersDialog = forwardRef<HTMLDivElement, RoomTriggersDialogProps>(
  function RoomTriggersDialog(
    {
      roomId,
      triggers,
      loading = false,
      highlightTriggerId,
      highlightRequest,
      onClose,
      onOpenThread,
      onToggleTrigger,
      onDeleteTrigger,
    },
    ref
  ) {
    const { t, i18n } = useTranslation();
    const mx = useMatrixClient();
    const mentionClickHandler = useMentionClickHandler(roomId);
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const highlightedNodeRef = useRef<HTMLElement | null>(null);
    const [deletedHighlightId, setDeletedHighlightId] = useState<string>();

    const setModalRef = useCallback(
      (node: HTMLDivElement | null) => {
        dialogRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    useEffect(() => {
      setDeletedHighlightId(undefined);
    }, [highlightRequest, highlightTriggerId]);

    const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const formatter = useMemo(
      () => dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      [locale]
    );

    const matchedHighlighted = Boolean(
      highlightTriggerId && triggers.some((row) => row.triggerId === highlightTriggerId)
    );
    const missingHighlighted = Boolean(
      highlightTriggerId &&
        !loading &&
        !matchedHighlighted &&
        deletedHighlightId !== highlightTriggerId
    );

    // Focus and scroll the row linked from a wake pill once present.
    useLayoutEffect(() => {
      if (!matchedHighlighted) return;
      const node = highlightedNodeRef.current;
      if (!node) return;
      node.scrollIntoView?.({ block: 'nearest' });
      node.focus({ preventScroll: true });
    }, [highlightRequest, highlightTriggerId, matchedHighlighted]);

    // Recover focus inside the dialog if a deleted row or control leaves focus on document.body.
    useLayoutEffect(() => {
      const modal = dialogRef.current;
      if (!modal) return;
      const active = modal.ownerDocument.activeElement;
      if (active && active !== modal.ownerDocument.body) return;
      const fallback =
        (matchedHighlighted ? highlightedNodeRef.current : null) ??
        modal.querySelector<HTMLElement>('article[data-trigger-id]');
      (fallback ?? closeButtonRef.current)?.focus({ preventScroll: true });
    }, [matchedHighlighted, triggers.length]);

    const handleDelete = useCallback(
      async (triggerId: string) => {
        await onDeleteTrigger(triggerId);
        if (triggerId === highlightTriggerId) setDeletedHighlightId(triggerId);
      },
      [highlightTriggerId, onDeleteTrigger]
    );

    const renderOwner = (userId: string) =>
      isUserId(userId)
        ? renderMatrixMention(mx, roomId, getMatrixToUser(userId), {
            ...makeMentionCustomProps(mentionClickHandler),
            title: userId,
          })
        : undefined;

    const targetRoomLabel = (targetRoomId: string) =>
      mx.getRoom(targetRoomId)?.name || targetRoomId;

    return (
      <Modal
        ref={setModalRef}
        size="400"
        flexHeight
        className={schedCss.Dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <PageScroll
          header={
            <Header size="500" className={schedCss.Header}>
              <Box grow="Yes" alignItems="Center" gap="200">
                <Icon size="200" src={TriggersIcon} />
                <Text as="h2" id={titleId} size="H4">
                  {t('roomTriggers.title')}
                </Text>
                <span className={schedCss.HeaderCount}>
                  {localDigits(String(triggers.length), locale)}
                </span>
              </Box>
              <DialogCloseButton
                ref={closeButtonRef}
                label={t('roomTriggers.close')}
                onClick={onClose}
              />
            </Header>
          }
        >
          <Box direction="Column" gap="300" className={schedCss.Content}>
            {missingHighlighted && highlightTriggerId && (
              <div role="status" className={schedCss.NoticeBar} data-trigger-missing="">
                <Text size="T200">
                  {t('roomTriggers.missingTrigger', {
                    id: revealDirectionControls(highlightTriggerId),
                  })}
                </Text>
              </div>
            )}

            {triggers.length === 0 ? (
              <Box direction="Column" gap="200" className={schedCss.Empty}>
                <Text size="T400">{t('roomTriggers.empty')}</Text>
                <Text size="T300" priority="300">
                  {t('roomTriggers.emptyHint')}
                </Text>
              </Box>
            ) : (
              <Box direction="Column" gap="200">
                {triggers.map((trigger) => {
                  const highlighted = trigger.triggerId === highlightTriggerId;
                  return (
                    <TriggerRow
                      key={trigger.triggerId}
                      roomId={roomId}
                      trigger={trigger}
                      highlighted={highlighted}
                      formatter={formatter}
                      renderOwner={renderOwner}
                      targetRoomLabel={targetRoomLabel}
                      articleRef={
                        highlighted
                          ? (node) => {
                              highlightedNodeRef.current = node;
                            }
                          : undefined
                      }
                      onOpenThread={onOpenThread}
                      onToggleTrigger={onToggleTrigger}
                      onDeleteTrigger={handleDelete}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        </PageScroll>
      </Modal>
    );
  }
);
