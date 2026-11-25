import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { revealDirectionControls } from '../ui/directional';
import { renderPromptText } from '../rich-text/promptText';
import { ConfirmBar } from '../schedules/ConfirmBar';
import { RowSubtitle } from '../schedules/RowSubtitle';
import * as s from '../schedules/roomSchedules.css';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger } from './roomTriggersApi';
import * as css from './roomTriggers.css';

const BTN = { type: 'button', size: '300', radii: '300' } as const;
const COMPACT = { ...BTN, variant: 'Secondary', fill: 'Soft', className: s.CompactAction } as const;

const KNOWN_KIND_LIST = ['webhook', 'room_message', 'external_event', 'thread_tag'] as const;
const KNOWN_KINDS: ReadonlySet<string> = new Set(KNOWN_KIND_LIST);
const isKnownKind = (kind: string): kind is (typeof KNOWN_KIND_LIST)[number] =>
  KNOWN_KINDS.has(kind);

const DEST_KEYS = {
  room: 'roomTriggers.destinationRoom',
  thread: 'roomTriggers.destinationThread',
  new_thread: 'roomTriggers.destinationNewThread',
  origin: 'roomTriggers.destinationOrigin',
} as const;

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
  const titleId = useId();
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState<'toggle' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const relativeLastFired = useRelativeTime(trigger.lastFiredAt ?? undefined);

  useEffect(() => {
    if (confirmDelete) keepBtnRef.current?.focus();
  }, [confirmDelete]);

  const kindLabel = t(`roomTriggers.kind.${isKnownKind(trigger.kind) ? trigger.kind : 'unknown'}`);
  const destLabel =
    trigger.threadMode && Object.hasOwn(DEST_KEYS, trigger.threadMode)
      ? t(DEST_KEYS[trigger.threadMode as keyof typeof DEST_KEYS])
      : undefined;
  const desc = trigger.description.trim();
  const idLabel = revealDirectionControls(trigger.triggerId);
  const promptText = trigger.prompt?.trim() ? trigger.prompt : undefined;
  const showDeleteBar = trigger.canManage && confirmDelete;
  const disabledNote = !trigger.enabled
    ? trigger.disabledReason === 'expired'
      ? t('roomTriggers.disabledExpired')
      : trigger.disabledReason === 'once_consumed'
        ? t('roomTriggers.disabledOnceConsumed')
        : undefined
    : undefined;

  const rawSubtitle: ReactNode[] = [
    kindLabel,
    desc ? (
      <code className={s.TaskId}>
        <bdi>{idLabel}</bdi>
      </code>
    ) : undefined,
    trigger.relation === 'watch' ? t('roomTriggers.watchingRoom') : undefined,
    destLabel,
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
      setError(kind);
    } finally {
      setBusy(null);
    }
  };
  const closeConfirm = () => {
    if (busy) return;
    setConfirmDelete(false);
    setError(null);
    deleteBtnRef.current?.focus();
  };
  const isBusy = Boolean(busy) || undefined;
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
        <span className={trigger.enabled ? s.IconTile.primary : s.IconTile.neutral} aria-hidden>
          <Icon size="100" src={TriggersIcon} />
        </span>
        <span className={s.RowBody}>
          <span className={s.RowTopLine}>
            <Text
              as="h3"
              id={titleId}
              size="H5"
              className={classNames(s.RowTitle, s.Wrap)}
              dir="auto"
            >
              {desc ? revealDirectionControls(desc) : <bdi>{idLabel}</bdi>}
            </Text>
            <span className={trigger.enabled ? s.StatusPill.success : s.StatusPill.neutral}>
              {t(trigger.enabled ? 'roomTriggers.stateOn' : 'roomTriggers.stateOff')}
            </span>
          </span>
          <RowSubtitle parts={subtitle} />
        </span>
      </div>

      {(promptText || onOpenThread || trigger.canManage) && (
        <div className={css.CardBody}>
          {promptText && (
            <div className={s.PromptWell} role="region" aria-label={t('roomTriggers.prompt')}>
              <Text as="p" size="T300" className={s.Prompt} dir="auto">
                {renderPromptText(promptText)}
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
                    aria-describedby={titleId}
                    aria-disabled={isBusy}
                    onClick={() => void run('toggle', onToggle)}
                  >
                    <Text size="T200">{t(toggleKey)}</Text>
                  </Button>
                  <IconButton
                    ref={deleteBtnRef}
                    {...BTN}
                    fill="None"
                    variant="Critical"
                    className={s.IconAction}
                    aria-label={t('roomTriggers.delete')}
                    aria-describedby={titleId}
                    aria-expanded={showDeleteBar}
                    aria-controls={showDeleteBar ? `${titleId}-confirm` : undefined}
                    aria-disabled={isBusy}
                    onClick={() => {
                      if (busy) return;
                      if (showDeleteBar) closeConfirm();
                      else setConfirmDelete(true);
                    }}
                  >
                    <Icon size="100" src={Icons.Delete} />
                  </IconButton>
                </div>
              )}
            </div>
          )}

          {error === 'toggle' && (
            <Text size="T200" role="alert" className={s.CancelError}>
              {t('roomTriggers.toggleError')}
            </Text>
          )}

          {showDeleteBar && (
            <ConfirmBar
              id={`${titleId}-confirm`}
              keepRef={keepBtnRef}
              prompt={t('roomTriggers.deleteConfirm')}
              error={error === 'delete' ? t('roomTriggers.deleteError') : undefined}
              keepLabel={t('roomTriggers.keep')}
              confirmLabel={t(
                busy === 'delete' ? 'roomTriggers.deleting' : 'roomTriggers.deleteTrigger'
              )}
              busy={Boolean(busy)}
              onKeep={closeConfirm}
              onConfirm={() => void run('delete', onDelete)}
            />
          )}
        </div>
      )}
    </article>
  );
}
