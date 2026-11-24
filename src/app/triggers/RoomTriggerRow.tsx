import { Fragment, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Button, Icon, IconButton, Icons, Text, type IconSrc } from 'folds';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { revealDirectionControls } from '../ui/directional';
import { renderSchedulePrompt } from '../schedules/schedulePrompt';
import * as s from '../schedules/roomSchedules.css';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger, TriggerKind, TriggerThreadMode } from './roomTriggersApi';
import * as css from './roomTriggers.css';

const BTN = { type: 'button', size: '300', radii: '300' } as const;
const COMPACT = { ...BTN, variant: 'Secondary', fill: 'Soft', className: s.CompactAction } as const;
const CONFIRM = { ...BTN, className: s.CancelBarButton } as const;
const KIND_ICONS: Record<TriggerKind, IconSrc> = {
  webhook: TriggersIcon,
  room_message: Icons.Eye,
  external_event: Icons.Bell,
  thread_tag: Icons.Bookmark,
};
const DEST_KEYS = {
  room: 'roomTriggers.destinationRoom',
  thread: 'roomTriggers.destinationThread',
  new_thread: 'roomTriggers.destinationNewThread',
  origin: 'roomTriggers.destinationOrigin',
} as const satisfies Record<TriggerThreadMode, string>;

type Props = {
  trigger: RoomTrigger;
  highlighted: boolean;
  owner?: ReactNode;
  articleRef?: Ref<HTMLElement>;
  onOpenThread?: () => void;
  onToggle: () => Promise<void>;
  onDelete: () => Promise<void>;
};

export function RoomTriggerRow(props: Props) {
  const { trigger, highlighted, owner, articleRef, onOpenThread, onToggle, onDelete } = props;
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const relativeLastFired = useRelativeTime(trigger.lastFiredAt ?? undefined);

  useEffect(() => {
    if (confirmDelete) keepBtnRef.current?.focus();
  }, [confirmDelete]);

  const kindLabel = t(`roomTriggers.kind.${trigger.kind}`);
  const desc = trigger.description.trim();
  const promptText = trigger.prompt?.trim() ? trigger.prompt : undefined;
  const showDeleteBar = trigger.canManage && confirmDelete;
  const reason =
    !trigger.enabled && trigger.disabledReason !== 'manual' ? trigger.disabledReason : null;
  const disabledNote =
    reason === 'expired'
      ? t('roomTriggers.disabledExpired')
      : reason === 'once_consumed'
        ? t('roomTriggers.disabledOnceConsumed')
        : reason && <bdi>{revealDirectionControls(reason)}</bdi>;
  const rawSubtitle: ReactNode[] = [
    desc ? kindLabel : undefined,
    trigger.relation === 'watch' ? t('roomTriggers.watchingRoom') : undefined,
    t(DEST_KEYS[trigger.threadMode]),
    owner ? <bdi>{owner}</bdi> : undefined,
    disabledNote,
    trigger.lastFiredAt !== null ? (
      <time dateTime={new Date(trigger.lastFiredAt).toISOString()}>
        {t('roomTriggers.lastFired', { time: relativeLastFired })}
      </time>
    ) : (
      t('roomTriggers.neverFired')
    ),
  ];
  const subtitle = rawSubtitle.filter(Boolean);

  const run = async (kind: 'toggle' | 'delete', fn: () => Promise<void>) => {
    if (!trigger.canManage || busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === 'delete') setConfirmDelete(false);
    } catch {
      setError(t(kind === 'toggle' ? 'roomTriggers.toggleError' : 'roomTriggers.deleteError'));
    } finally {
      setBusy(null);
    }
  };
  const closeConfirm = () => {
    setConfirmDelete(false);
    setError(null);
  };
  const toggleKey =
    busy === 'toggle'
      ? 'roomTriggers.updating'
      : trigger.enabled
        ? 'roomTriggers.disable'
        : 'roomTriggers.enable';

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className={classNames(s.Item, css.TriggerCard)}
      data-trigger-id={trigger.triggerId}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      <div className={css.CardHeader}>
        <span className={trigger.enabled ? s.IconTile.primary : css.IconTileNeutral} aria-hidden>
          <Icon size="100" src={KIND_ICONS[trigger.kind]} />
        </span>
        <span className={s.RowBody}>
          <span className={s.RowTopLine}>
            <Text as="h3" size="H5" className={classNames(s.RowTitle, s.Wrap)} dir="auto">
              {desc ? revealDirectionControls(desc) : kindLabel}
            </Text>
            <span className={trigger.enabled ? s.StatusPill.success : css.StatusPillNeutral}>
              {t(trigger.enabled ? 'roomTriggers.stateOn' : 'roomTriggers.stateOff')}
            </span>
          </span>
          <span className={s.RowSubtitle}>
            {subtitle.map((node, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <span className={s.SubtitleDot} aria-hidden="true">
                    ·
                  </span>
                )}
                <Text as="span" size="T200" className={s.Wrap}>
                  {node}
                </Text>
              </Fragment>
            ))}
          </span>
        </span>
      </div>

      {(promptText || onOpenThread || trigger.canManage) && (
        <div className={css.CardBody}>
          {promptText && (
            <div className={s.PromptWell} role="region" aria-label={t('roomTriggers.prompt')}>
              <Text as="p" size="T300" className={classNames(s.Prompt, s.PromptClamped)} dir="auto">
                {renderSchedulePrompt(promptText)}
              </Text>
            </div>
          )}

          {(onOpenThread || trigger.canManage) && (
            <div className={s.ActionsRow}>
              {onOpenThread && (
                <Button {...COMPACT} outlined onClick={onOpenThread}>
                  <Icon size="100" src={Icons.Thread} />
                  <Text size="T200">{t('roomTriggers.openThread')}</Text>
                </Button>
              )}
              {trigger.canManage && (
                <div className={s.ActionsSecondary}>
                  <Button
                    {...COMPACT}
                    disabled={Boolean(busy)}
                    onClick={() => void run('toggle', onToggle)}
                  >
                    <Text size="T200">{t(toggleKey)}</Text>
                  </Button>
                  <IconButton
                    {...BTN}
                    fill="None"
                    variant="Critical"
                    className={s.IconAction}
                    aria-label={t('roomTriggers.delete')}
                    aria-expanded={showDeleteBar}
                    disabled={Boolean(busy)}
                    onClick={() => (showDeleteBar ? closeConfirm() : setConfirmDelete(true))}
                  >
                    <Icon size="100" src={Icons.Delete} />
                  </IconButton>
                </div>
              )}
            </div>
          )}

          {error && (
            <Text size="T200" role="alert" className={s.CancelError}>
              {error}
            </Text>
          )}

          {showDeleteBar && (
            <div role="group" aria-label={t('roomTriggers.deleteConfirm')} className={s.CancelBar}>
              <Text size="T200">{t('roomTriggers.deleteConfirm')}</Text>
              <div className={s.CancelBarActions}>
                <Button
                  ref={keepBtnRef}
                  {...CONFIRM}
                  variant="Secondary"
                  fill="Soft"
                  disabled={busy === 'delete'}
                  onClick={closeConfirm}
                >
                  <Text size="T200">{t('roomTriggers.keep')}</Text>
                </Button>
                <Button
                  {...CONFIRM}
                  variant="Critical"
                  fill="Solid"
                  disabled={busy === 'delete'}
                  onClick={() => void run('delete', onDelete)}
                >
                  <Text size="T200">
                    {t(busy === 'delete' ? 'roomTriggers.deleting' : 'roomTriggers.deleteTrigger')}
                  </Text>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
