import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Button, Icon, IconButton, Icons, Text, type IconSrc } from 'folds';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { revealDirectionControls } from '../ui/directional';
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

const DESTINATION_KEYS = {
  room: 'roomTriggers.destinationRoom',
  thread: 'roomTriggers.destinationThread',
  new_thread: 'roomTriggers.destinationNewThread',
  origin: 'roomTriggers.destinationOrigin',
} as const satisfies Record<TriggerThreadMode, string>;

const isLongPrompt = (p: string) =>
  p.length > LONG_PROMPT_CHAR_LIMIT || p.split('\n').length > LONG_PROMPT_LINE_LIMIT;

const formatTime = (ts: number, formatter: Intl.DateTimeFormat) => (
  <time dateTime={new Date(ts).toISOString()}>{formatter.format(ts)}</time>
);

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

export type RoomTriggerRowProps = {
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

export function RoomTriggerRow({
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
}: RoomTriggerRowProps) {
  const { t } = useTranslation();
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [pending, setPending] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState<'toggle' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (!trigger.canManage) setConfirmDelete(false);
  }, [trigger.canManage]);
  useEffect(() => {
    if (confirmDelete) keepButtonRef.current?.focus();
  }, [confirmDelete]);

  const kindLabel = t(`roomTriggers.kind.${trigger.kind}`);
  const desc = trigger.description.trim();
  const title = desc ? revealDirectionControls(desc) : kindLabel;
  const promptText = trigger.prompt?.trim() ? trigger.prompt : undefined;
  const longPrompt = promptText !== undefined && isLongPrompt(promptText);
  const busy = pending !== null;
  const showDeleteBar =
    trigger.canManage && (confirmDelete || pending === 'delete' || error === 'delete');

  const disabledReasonNode: ReactNode =
    !trigger.enabled && trigger.disabledReason && trigger.disabledReason !== 'manual' ? (
      trigger.disabledReason === 'expired' ? (
        t('roomTriggers.disabledExpired')
      ) : trigger.disabledReason === 'once_consumed' ? (
        t('roomTriggers.disabledOnceConsumed')
      ) : (
        <bdi>{revealDirectionControls(trigger.disabledReason)}</bdi>
      )
    ) : undefined;

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

  const rawSubtitle: ReactNode[] = [
    desc ? kindLabel : undefined,
    trigger.relation === 'watch' ? t('roomTriggers.watchingRoom') : undefined,
    t(DESTINATION_KEYS[trigger.threadMode]),
    disabledReasonNode,
    lastFiredNode,
  ];
  const subtitleParts = rawSubtitle.filter(Boolean);

  const runAction = async (kind: 'toggle' | 'delete', fn: () => Promise<void>) => {
    if (!trigger.canManage || busy) return;
    setPending(kind);
    setError(null);
    try {
      await fn();
      if (mountedRef.current && kind === 'delete') setConfirmDelete(false);
    } catch {
      if (mountedRef.current) setError(kind);
    } finally {
      if (mountedRef.current) setPending(null);
    }
  };

  const cancelDeleteConfirm = () => {
    if (pending === 'delete') return;
    setConfirmDelete(false);
    setError((prev) => (prev === 'delete' ? null : prev));
    deleteButtonRef.current?.focus();
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
                onClick={() => setPromptExpanded((v) => !v)}
              >
                <Text as="span" size="T200">
                  {t(
                    promptExpanded ? 'roomTriggers.showLessPrompt' : 'roomTriggers.showFullPrompt'
                  )}
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
              onClick={() => setDetailsOpen((v) => !v)}
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
                onClick={() =>
                  void runAction('toggle', () =>
                    onToggleTrigger(trigger.triggerId, !trigger.enabled)
                  )
                }
              >
                <Text size="T200">
                  {t(
                    pending === 'toggle'
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
                  if (showDeleteBar) cancelDeleteConfirm();
                  else setConfirmDelete(true);
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

        {error === 'toggle' && (
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
            {error === 'delete' && (
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
                aria-disabled={pending === 'delete' || undefined}
                onClick={cancelDeleteConfirm}
              >
                <Text size="T200">{t('roomTriggers.keep')}</Text>
              </Button>
              <Button
                {...CONFIRM_BTN}
                variant="Critical"
                fill="Solid"
                aria-disabled={pending === 'delete' || undefined}
                onClick={() => void runAction('delete', () => onDeleteTrigger(trigger.triggerId))}
              >
                <Text size="T200">
                  {t(pending === 'delete' ? 'roomTriggers.deleting' : 'roomTriggers.deleteTrigger')}
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
                {formatTime(trigger.expiresAt, formatter)}
              </MetaRow>
            )}
            {trigger.lastFiredAt !== null && (
              <MetaRow label={t('roomTriggers.lastFiredLabel')}>
                {formatTime(trigger.lastFiredAt, formatter)}
              </MetaRow>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}
