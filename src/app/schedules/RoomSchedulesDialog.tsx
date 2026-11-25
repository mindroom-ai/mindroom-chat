import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { copyToClipboard } from '../lib/dom';
import { localDigits } from '../lib/localDigits';
import { RoomDialogEmpty, RoomDialogFrame } from '../ui/RoomDialogOverlay';
import { CopyIcon } from '../rich-text/code/CodeBlockIcons';
import { useOwnerMention } from '../messages/useOwnerMention';
import { renderSchedulePrompt } from '../rich-text/schedulePrompt';
import {
  parseScheduleTimestamp,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';
import * as sched from './roomSchedules';
import { RowSubtitle } from './RowSubtitle';
import { useScheduleCancelState } from './useScheduleCancelState';
import * as css from './roomSchedules.css';

export type EditScheduledTaskResult = 'prefilled' | 'draft-busy' | void;
type ScheduleFilter = 'all' | 'once' | 'recurring';

const LONG_PROMPT_CHAR_LIMIT = 180;
const LONG_PROMPT_LINE_LIMIT = 3;
const COPY_FEEDBACK_MS = 2_000;
const IMMINENT_COUNTDOWN_WINDOW_MS = 120_000;
const BTN = { type: 'button', size: '300', radii: '300' } as const;
const COMPACT_BTN = { ...BTN, variant: 'Secondary', className: css.CompactAction } as const;
const ICON_BTN = { ...BTN, fill: 'None', className: css.IconAction } as const;
const CANCEL_BTN = { ...BTN, className: css.CancelBarButton } as const;

const isLongPrompt = (p: string) =>
  p.length > LONG_PROMPT_CHAR_LIMIT || p.split('\n').length > LONG_PROMPT_LINE_LIMIT;
const filterByType = (tasks: readonly ParsedScheduledTask[], filter: ScheduleFilter) =>
  filter === 'all'
    ? tasks
    : tasks.filter((task) => sched.isRecurringTask(task) === (filter === 'recurring'));
const timeEl = (ts: number, label: string) => (
  <time dateTime={new Date(ts).toISOString()}>{label}</time>
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
    <Text as="dt" size="T200" className={css.MetaLabel}>
      {label}
    </Text>
    <Text as="dd" size="T200" className={wrap ? css.Wrap : undefined}>
      {children}
    </Text>
  </>
);

type ScheduleContext = {
  now: number;
  locale: string;
  formatter: Intl.DateTimeFormat;
  grouped: boolean;
  canManageCancel: boolean;
  cancel: ReturnType<typeof useScheduleCancelState>;
  renderOwner: (userId: string) => ReactNode;
  onOpenThread: (threadId: string) => void;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
};

function ScheduleAccordionItem({
  ctx,
  task,
  open,
  onToggle,
}: {
  ctx: ScheduleContext;
  task: ParsedScheduledTask;
  open: boolean;
  onToggle: () => void;
}) {
  const { now, locale, formatter, grouped, onOpenThread, onEditTask } = ctx;
  const { t } = useTranslation();
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<'edit-busy' | 'copy-failed' | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const confirmBarRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const promptText = task.message;
  const longPrompt = promptText !== undefined && isLongPrompt(promptText);
  useEffect(() => setPromptExpanded(false), [promptText]);

  const commandSafe = sched.isCommandSafeTaskId(task.taskId);
  const canCancel = Boolean(
    ctx.canManageCancel &&
    commandSafe &&
    (task.newThread || !task.threadId || isConfirmedMatrixEventId(task.threadId))
  );
  const cancelStatus = ctx.cancel.statusByTaskId.get(task.taskId);
  const isCancelling = cancelStatus === 'pending';
  const cancelSent = cancelStatus === 'sent';
  const cancelError = cancelStatus === 'error';
  const showCancelBar = Boolean(canCancel && (confirmingCancel || isCancelling || cancelError));

  useEffect(() => {
    if (!open || !canCancel) setConfirmingCancel(false);
    if (!open) setNotice(null);
  }, [canCancel, open]);
  useEffect(() => {
    if (confirmingCancel) keepButtonRef.current?.focus();
  }, [confirmingCancel]);

  const recurring = sched.isRecurringTask(task);
  const executionTime = sched.getScheduleTimestamp(task);
  const createdTime = parseScheduleTimestamp(task.createdAt);
  const updatedTime = parseScheduleTimestamp(task.updatedAt);
  const awaiting = !recurring && executionTime !== undefined && executionTime <= now;
  const tone = awaiting ? 'warning' : recurring ? 'success' : 'primary';

  // Cron fields are UTC; the runtime writes the description in the task's own wall time.
  const utcCron = task.cronExpression ? <bdi>{task.cronExpression} (UTC)</bdi> : undefined;
  const destinationLabel = t(
    task.newThread
      ? 'roomSchedules.newThread'
      : task.threadId
        ? 'roomSchedules.thread'
        : 'roomSchedules.roomTimeline'
  );
  const historyChip =
    task.historyLimit === 0
      ? t('roomSchedules.noHistory')
      : typeof task.historyLimit === 'number' && task.historyLimit > 0
        ? t('roomSchedules.recentMessages', { total: task.historyLimit })
        : undefined;
  const statusLabel = awaiting
    ? t('roomSchedules.awaitingShort')
    : recurring
      ? sched.formatShortCadence(task, t)
      : executionTime !== undefined
        ? sched.formatRelativeCountdown(executionTime, now, t, locale)
        : undefined;

  const formatTime = (ts: number) => timeEl(ts, formatter.format(ts));
  const timingNode = recurring ? (
    task.cronDescription ? (
      <span dir="auto">{task.cronDescription}</span>
    ) : (
      (utcCron ?? t('roomSchedules.unknownTime'))
    )
  ) : executionTime === undefined ? (
    t('roomSchedules.unknownTime')
  ) : (
    timeEl(executionTime, sched.formatCompactExecutionTime(executionTime, now, locale))
  );
  const badges = [
    task.silent && t('roomSchedules.silent'),
    task.isConditional && t('roomSchedules.conditional'),
    task.model && <bdi>{task.model}</bdi>,
  ].filter(Boolean);
  const subtitleParts = [
    timingNode,
    awaiting && <span className={css.Awaiting}>{t('roomSchedules.awaitingExecution')}</span>,
    destinationLabel,
    ...(open ? [] : badges),
  ].filter(Boolean);
  const chips = [
    t(recurring ? 'roomSchedules.recurring' : 'roomSchedules.once'),
    ...badges,
    historyChip,
  ].filter(Boolean);

  const handleCopyId = async (trigger?: Element | null) => {
    const ok = await copyToClipboard(task.taskId, trigger);
    if (!mountedRef.current) return;
    if (ok) {
      setNotice(null);
      setCopied(true);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(
        () => mountedRef.current && setCopied(false),
        COPY_FEEDBACK_MS
      );
    } else {
      setCopied(false);
      setNotice('copy-failed');
      setDetailsOpen(true);
    }
  };

  const handleKeepCancel = () => {
    if (isCancelling) return;
    setConfirmingCancel(false);
    ctx.cancel.clearCancelError(task.taskId);
    cancelButtonRef.current?.focus();
  };

  const handleConfirmCancelClick = async () => {
    if (isCancelling) return;
    if ((await ctx.cancel.handleCancelTask(task)) && mountedRef.current) {
      const shouldRestoreFocus = Boolean(confirmBarRef.current?.contains(document.activeElement));
      setConfirmingCancel(false);
      if (shouldRestoreFocus) toggleButtonRef.current?.focus();
    }
  };

  const actionNotice = notice
    ? t(notice === 'edit-busy' ? 'roomSchedules.editDraftBusy' : 'roomSchedules.copyFailed')
    : undefined;

  return (
    <article
      className={css.Item}
      data-expanded={open ? 'true' : undefined}
      data-schedule-task-id={task.taskId}
    >
      <div role="heading" aria-level={grouped ? 4 : 3} className={css.RowHeading}>
        <button
          ref={toggleButtonRef}
          type="button"
          data-schedule-toggle=""
          data-schedule-task-id={task.taskId}
          className={css.RowHeader}
          aria-expanded={open}
          aria-controls={open ? `${id}-drawer` : undefined}
          onClick={() => {
            toggleButtonRef.current?.focus();
            onToggle();
          }}
        >
          <span className={css.IconTile[tone]} aria-hidden="true">
            <Icon
              size="100"
              src={awaiting ? Icons.Warning : recurring ? Icons.Reload : Icons.Clock}
            />
          </span>
          <span className={css.RowBody}>
            <span className={css.RowTopLine}>
              <Text as="span" size="H5" className={classNames(css.RowTitle, css.Wrap)} dir="auto">
                {task.description ?? task.taskId}
              </Text>
              {statusLabel && <span className={css.StatusPill[tone]}>{statusLabel}</span>}
            </span>
            <RowSubtitle parts={subtitleParts} />
          </span>
          <span className={classNames(css.Chevron, open && css.ChevronOpen)} aria-hidden="true">
            <Icon size="100" src={Icons.ChevronBottom} />
          </span>
        </button>
      </div>

      {open && (
        <div id={`${id}-drawer`} className={css.Drawer}>
          <div className={css.ChipRow}>
            {chips.map((chip, i) => (
              <span key={i} className={css.Chip}>
                {chip}
              </span>
            ))}
          </div>

          <div className={css.PromptWell} role="region" aria-label={t('roomSchedules.prompt')}>
            <Text
              id={`${id}-prompt`}
              as="p"
              size="T300"
              className={classNames(css.Prompt, longPrompt && !promptExpanded && css.PromptClamped)}
              dir="auto"
            >
              {promptText !== undefined
                ? renderSchedulePrompt(promptText)
                : t('roomSchedules.promptUnavailable')}
            </Text>
            {longPrompt && (
              <button
                type="button"
                className={css.PromptToggle}
                aria-controls={`${id}-prompt`}
                aria-expanded={promptExpanded}
                onClick={() => setPromptExpanded((v) => !v)}
              >
                <Text as="span" size="T200">
                  {t(
                    promptExpanded ? 'roomSchedules.showLessPrompt' : 'roomSchedules.showFullPrompt'
                  )}
                </Text>
              </button>
            )}
          </div>

          <div className={css.ActionsRow}>
            <div className={css.ActionsPrimary}>
              {!task.newThread && task.threadId && (
                <Button
                  {...COMPACT_BTN}
                  fill="Soft"
                  outlined
                  onClick={() => onOpenThread(task.threadId!)}
                >
                  <Icon size="100" src={Icons.Thread} />
                  <Text size="T200">{t('roomSchedules.openThread')}</Text>
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
                  {t(detailsOpen ? 'roomSchedules.hideDetails' : 'roomSchedules.details')}
                </Text>
              </Button>
            </div>

            <div className={css.ActionsSecondary}>
              <Button
                {...COMPACT_BTN}
                fill="None"
                onClick={(e: MouseEvent<HTMLButtonElement>) => void handleCopyId(e.currentTarget)}
              >
                {copied ? <Icon size="100" src={Icons.Check} /> : <CopyIcon />}
                <Text size="T200">{t('roomSchedules.copyId')}</Text>
              </Button>
              <span
                className={copied ? css.CopiedStatus : css.SrOnly}
                role="status"
                aria-live="polite"
              >
                {copied ? t('roomSchedules.copied') : ''}
              </span>

              {onEditTask && commandSafe && !task.preApprovedCall && (
                <IconButton
                  {...ICON_BTN}
                  variant="SurfaceVariant"
                  aria-label={t('roomSchedules.edit')}
                  title={t('roomSchedules.edit')}
                  onClick={() => setNotice(onEditTask(task) === 'draft-busy' ? 'edit-busy' : null)}
                >
                  <Icon size="100" src={Icons.Pencil} />
                </IconButton>
              )}

              {canCancel && (
                <IconButton
                  ref={cancelButtonRef}
                  {...ICON_BTN}
                  variant="Critical"
                  aria-label={t('roomSchedules.cancel')}
                  title={t('roomSchedules.cancel')}
                  aria-expanded={showCancelBar}
                  aria-controls={showCancelBar ? `${id}-confirm` : undefined}
                  aria-disabled={isCancelling || cancelSent || undefined}
                  onClick={() => {
                    if (isCancelling || cancelSent) return;
                    if (showCancelBar) handleKeepCancel();
                    else setConfirmingCancel(true);
                  }}
                >
                  <Icon
                    size="100"
                    src={Icons.Delete}
                    className={isCancelling || cancelSent ? css.IconMuted : undefined}
                  />
                </IconButton>
              )}
            </div>
          </div>

          {showCancelBar && (
            <div
              ref={confirmBarRef}
              id={`${id}-confirm`}
              role="group"
              aria-labelledby={`${id}-confirm-q`}
              className={css.CancelBar}
            >
              <Text id={`${id}-confirm-q`} size="T200">
                {t('roomSchedules.cancelConfirm')}
              </Text>
              {cancelError && (
                <Text size="T200" role="alert" className={css.CancelError}>
                  {t('roomSchedules.cancelError')}
                </Text>
              )}
              <div className={css.CancelBarActions}>
                <Button
                  ref={keepButtonRef}
                  {...CANCEL_BTN}
                  variant="Secondary"
                  fill="Soft"
                  aria-describedby={`${id}-confirm-q`}
                  aria-disabled={isCancelling || undefined}
                  onClick={handleKeepCancel}
                >
                  <Text size="T200">{t('roomSchedules.keep')}</Text>
                </Button>
                <Button
                  {...CANCEL_BTN}
                  variant="Critical"
                  fill="Solid"
                  aria-disabled={isCancelling || undefined}
                  onClick={() => void handleConfirmCancelClick()}
                >
                  <Text size="T200">
                    {t(isCancelling ? 'roomSchedules.cancelling' : 'roomSchedules.cancelTask')}
                  </Text>
                </Button>
              </div>
            </div>
          )}

          <div
            role="status"
            aria-live="polite"
            data-schedule-cancel-status=""
            className={cancelSent ? css.CancelSentBar : css.SrOnly}
          >
            {cancelSent && <Text size="T200">{t('roomSchedules.cancellationSent')}</Text>}
          </div>
          <div
            role="status"
            aria-live="polite"
            data-schedule-action-status=""
            className={actionNotice ? css.NoticeBar : css.SrOnly}
          >
            {actionNotice && <Text size="T200">{actionNotice}</Text>}
          </div>

          {detailsOpen && (
            <dl id={`${id}-details`} className={css.Metadata}>
              <MetaRow label={t('roomSchedules.taskId')} wrap>
                <code className={css.TaskId}>
                  <bdi>{task.taskId}</bdi>
                </code>
              </MetaRow>
              {task.createdBy && (
                <MetaRow label={t('roomSchedules.owner')} wrap>
                  <bdi>{ctx.renderOwner(task.createdBy)}</bdi>
                </MetaRow>
              )}
              <MetaRow label={t('roomSchedules.model')} wrap>
                {task.model ? <bdi>{task.model}</bdi> : t('roomSchedules.inheritedModel')}
              </MetaRow>
              {(task.historyLimit === null || historyChip) && (
                <MetaRow label={t('roomSchedules.historyLimit')}>
                  {task.historyLimit === null ? t('roomSchedules.fullHistory') : historyChip}
                </MetaRow>
              )}
              <MetaRow
                label={t(recurring ? 'roomSchedules.recurrence' : 'roomSchedules.executionTime')}
                wrap
              >
                {recurring ? (
                  task.cronDescription ? (
                    <Box direction="Column" gap="100">
                      <span dir="auto">{task.cronDescription}</span>
                      {utcCron && (
                        <Text as="span" size="T200" className={classNames(css.MetaLabel, css.Wrap)}>
                          {utcCron}
                        </Text>
                      )}
                    </Box>
                  ) : (
                    (utcCron ?? t('roomSchedules.unknownTime'))
                  )
                ) : executionTime === undefined ? (
                  t('roomSchedules.unknownTime')
                ) : (
                  formatTime(executionTime)
                )}
              </MetaRow>
              {createdTime !== undefined && (
                <MetaRow label={t('roomSchedules.createdAt')}>{formatTime(createdTime)}</MetaRow>
              )}
              {updatedTime !== undefined && updatedTime !== createdTime && (
                <MetaRow label={t('roomSchedules.updatedAt')}>{formatTime(updatedTime)}</MetaRow>
              )}
              <MetaRow label={t('roomSchedules.destination')}>{destinationLabel}</MetaRow>
            </dl>
          )}
        </div>
      )}
    </article>
  );
}

type RoomSchedulesDialogProps = {
  roomId: string;
  tasks: readonly ParsedScheduledTask[];
  openThreadId?: string;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
  ref?: Ref<HTMLDivElement>;
};

export function RoomSchedulesDialog({
  roomId,
  tasks,
  openThreadId,
  onClose,
  onOpenThread,
  onCancelTask,
  onEditTask,
  ref,
}: RoomSchedulesDialogProps) {
  const { t, i18n } = useTranslation();
  const renderOwner = useOwnerMention(roomId);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(() =>
    tasks.length === 1 ? tasks[0]!.taskId : null
  );
  const cancel = useScheduleCancelState(roomId, onCancelTask);

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }),
    [locale]
  );

  const recurringCount = tasks.filter(sched.isRecurringTask).length;
  const onceCount = tasks.length - recurringCount;
  const showFilterBar = onceCount > 0 && recurringCount > 0;
  const effectiveFilter: ScheduleFilter =
    (filter === 'once' && onceCount === 0) || (filter === 'recurring' && recurringCount === 0)
      ? 'all'
      : filter;
  const filteredTasks = useMemo(
    () => filterByType(tasks, effectiveFilter),
    [effectiveFilter, tasks]
  );

  useEffect(() => {
    if (expandedId !== null && !tasks.some((task) => task.taskId === expandedId)) {
      setExpandedId(null);
    }
    if (!showFilterBar && filter !== 'all') setFilter('all');
  }, [expandedId, filter, showFilterBar, tasks]);

  const hasCancel = Boolean(onCancelTask);
  const hasEdit = Boolean(onEditTask);

  // Recover focus inside the dialog if a focused task row, filter button, or action control unmounted.
  useLayoutEffect(() => {
    const modal = dialogRef.current;
    if (!modal) return;
    const active = modal.ownerDocument.activeElement;
    if (active && active !== modal.ownerDocument.body) return;
    const fallback =
      modal.querySelector<HTMLButtonElement>(
        '[data-expanded="true"] button[data-schedule-toggle]'
      ) ?? modal.querySelector<HTMLButtonElement>('button[data-schedule-toggle]');
    (fallback ?? closeButtonRef.current)?.focus();
  }, [cancel.statusByTaskId, expandedId, filteredTasks, hasCancel, hasEdit, showFilterBar]);

  const inThread = (task: ParsedScheduledTask) =>
    openThreadId !== undefined && sched.isScheduleInThread(task, openThreadId);
  const threadTasks = filteredTasks.filter(inThread);
  const elsewhereTasks = filteredTasks.filter((task) => !inThread(task));
  const grouped = threadTasks.length > 0 && elsewhereTasks.length > 0;
  const groups = [
    ['thread', 'roomSchedules.thisThread', threadTasks],
    ['elsewhere', 'roomSchedules.elsewhereInRoom', elsewhereTasks],
  ] as const;

  const hasImminentTask = tasks.some((task) => {
    const ts = sched.getScheduleTimestamp(task);
    return (
      !sched.isRecurringTask(task) &&
      ts !== undefined &&
      ts > now &&
      ts - now <= IMMINENT_COUNTDOWN_WINDOW_MS
    );
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), hasImminentTask ? 1_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [hasImminentTask]);

  const handleSelectFilter = (nextFilter: ScheduleFilter) => {
    setFilter(nextFilter);
    const nextFiltered = filterByType(tasks, nextFilter);
    if (nextFiltered.length === 1) setExpandedId(nextFiltered[0]!.taskId);
  };

  const itemCtx: ScheduleContext = {
    now,
    locale,
    formatter,
    grouped,
    canManageCancel: Boolean(onCancelTask),
    cancel,
    renderOwner,
    onOpenThread,
    onEditTask,
  };
  const filterOptions = [
    ['all', t('roomSchedules.filterAll'), tasks.length],
    ['once', t('roomSchedules.once'), onceCount],
    ['recurring', t('roomSchedules.recurring'), recurringCount],
  ] as const;

  return (
    <RoomDialogFrame
      ref={ref}
      modalRef={dialogRef}
      closeButtonRef={closeButtonRef}
      icon={Icons.Clock}
      title={t('roomSchedules.title')}
      count={tasks.length}
      onClose={onClose}
    >
      {tasks.length === 0 ? (
        <RoomDialogEmpty title={t('roomSchedules.empty')} hint={t('roomSchedules.emptyHint')} />
      ) : (
        <>
          {showFilterBar && (
            <div role="group" aria-label={t('roomSchedules.filterLabel')} className={css.FilterBar}>
              {filterOptions.map(([optId, label, count]) => {
                const active = effectiveFilter === optId;
                return (
                  <button
                    key={optId}
                    type="button"
                    aria-pressed={active}
                    className={classNames(css.FilterPill, active && css.FilterPillActive)}
                    onClick={() => handleSelectFilter(optId)}
                  >
                    {active && <Icon size="50" src={Icons.Check} aria-hidden />}
                    <span>{label}</span>
                    <span className={css.FilterCount}>{localDigits(String(count), locale)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <Box direction="Column" gap="200">
            {groups.map(([groupId, heading, groupTasks]) => (
              <Fragment key={groupId}>
                {grouped && (
                  <Text as="h3" size="T300" priority="300" className={css.GroupHeading}>
                    {t(heading)}
                  </Text>
                )}
                {groupTasks.map((task) => {
                  const open = expandedId === task.taskId;
                  return (
                    <ScheduleAccordionItem
                      key={task.taskId}
                      ctx={itemCtx}
                      task={task}
                      open={open}
                      onToggle={() => setExpandedId(open ? null : task.taskId)}
                    />
                  );
                })}
              </Fragment>
            ))}
          </Box>
        </>
      )}
    </RoomDialogFrame>
  );
}
