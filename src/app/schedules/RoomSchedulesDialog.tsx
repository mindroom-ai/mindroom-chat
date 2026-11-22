import {
  Fragment,
  type ReactNode,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { copyToClipboard } from '../lib/dom';
import { PageScroll } from '../ui/page/PageScroll';
import { Header, Modal } from '../ui/glass/GlassPrimitives';
import { CopyIcon } from '../rich-text/code/CodeBlockIcons';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import { getMatrixToUser } from '../matrix/matrix-to';
import {
  makeMentionCustomProps,
  renderMatrixMention,
} from '../messages/html/react-custom-html-parser';
import { isUserId } from '../matrix/matrix';
import {
  parseScheduleTimestamp,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';
import {
  formatCompactExecutionTime,
  formatRelativeCountdown,
  formatShortCadence,
  getScheduleTimestamp,
  isRecurringTask,
  isScheduleInThread,
} from './roomSchedules';
import { renderSchedulePrompt } from './schedulePrompt';
import * as css from './roomSchedules.css';

type ScheduleFilter = 'all' | 'once' | 'recurring';
type CancelState = 'idle' | 'confirm' | 'pending' | 'error' | 'sent';

const LONG_PROMPT_CHAR_LIMIT = 180;
const LONG_PROMPT_LINE_LIMIT = 3;
const COPY_FEEDBACK_MS = 2_000;

const isLongPrompt = (prompt: string): boolean =>
  prompt.length > LONG_PROMPT_CHAR_LIMIT || prompt.split('\n').length > LONG_PROMPT_LINE_LIMIT;

function ScheduleAccordionItem({
  roomId,
  task,
  now,
  locale,
  formatter,
  grouped,
  open,
  onToggle,
  onOpenThread,
  onCancelTask,
  onEditTask,
}: {
  roomId: string;
  task: ParsedScheduledTask;
  now: number;
  locale: string;
  formatter: Intl.DateTimeFormat;
  grouped: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenThread: (threadId: string) => void;
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => void;
}) {
  const { t } = useTranslation();
  const drawerId = useId();
  const detailsId = useId();
  const mx = useMatrixClient();
  const mentionClickHandler = useMentionClickHandler(roomId);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cancelState, setCancelState] = useState<CancelState>('idle');

  const copyTimerRef = useRef<number>();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const recurring = isRecurringTask(task);
  const executionTime = getScheduleTimestamp(task);
  const createdTime = parseScheduleTimestamp(task.createdAt);
  const updatedTime = parseScheduleTimestamp(task.updatedAt);
  const awaiting = !recurring && executionTime !== undefined && executionTime <= now;
  const showUpdated = updatedTime !== undefined && updatedTime !== createdTime;

  // Cron fields are UTC; the runtime writes the description in the task's own wall time.
  const utcCronExpression = task.cronExpression ? (
    <bdi>{task.cronExpression} (UTC)</bdi>
  ) : undefined;

  const creatorMention =
    detailsOpen && task.createdBy && isUserId(task.createdBy)
      ? renderMatrixMention(mx, roomId, getMatrixToUser(task.createdBy), {
          ...makeMentionCustomProps(mentionClickHandler),
          title: task.createdBy,
        })
      : undefined;

  const destinationLabel = task.newThread
    ? t('roomSchedules.newThread')
    : task.threadId
    ? t('roomSchedules.thread')
    : t('roomSchedules.roomTimeline');

  const historyChipLabel =
    task.historyLimit === 0
      ? t('roomSchedules.noHistory')
      : typeof task.historyLimit === 'number' && task.historyLimit > 0
      ? t('roomSchedules.recentMessages', { total: task.historyLimit })
      : undefined;

  const statusPill = awaiting
    ? { label: t('roomSchedules.awaitingShort'), variant: css.StatusPillWarning }
    : recurring
    ? { label: formatShortCadence(task, t), variant: css.StatusPillSuccess }
    : executionTime !== undefined
    ? {
        label: formatRelativeCountdown(executionTime, now, t, locale),
        variant: css.StatusPillPrimary,
      }
    : undefined;

  const subtitleItems: { key: string; node: ReactNode }[] = [];
  if (recurring) {
    subtitleItems.push({
      key: 'timing',
      node: task.cronDescription ? (
        <span dir="auto">{task.cronDescription}</span>
      ) : (
        utcCronExpression ?? t('roomSchedules.unknownTime')
      ),
    });
  } else {
    subtitleItems.push({
      key: 'timing',
      node:
        executionTime === undefined ? (
          t('roomSchedules.unknownTime')
        ) : (
          <time dateTime={new Date(executionTime).toISOString()}>
            {formatCompactExecutionTime(executionTime, now, locale)}
          </time>
        ),
    });
    if (awaiting) {
      subtitleItems.push({
        key: 'awaiting',
        node: <span className={css.Awaiting}>{t('roomSchedules.awaitingExecution')}</span>,
      });
    }
  }
  subtitleItems.push({ key: 'destination', node: destinationLabel });
  if (!open) {
    if (task.silent) subtitleItems.push({ key: 'silent', node: t('roomSchedules.silent') });
    if (task.isConditional) {
      subtitleItems.push({ key: 'conditional', node: t('roomSchedules.conditional') });
    }
    if (task.model) subtitleItems.push({ key: 'model', node: <bdi>{task.model}</bdi> });
  }

  const promptText = task.message;
  const promptLong = promptText !== undefined && isLongPrompt(promptText);

  const handleCopyId = async () => {
    const ok = await copyToClipboard(task.taskId);
    if (!mountedRef.current) return;
    if (ok) {
      setCopied(true);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, COPY_FEEDBACK_MS);
    } else {
      setDetailsOpen(true);
    }
  };

  const handleConfirmCancel = async () => {
    if (!onCancelTask || cancelState === 'pending') return;
    setCancelState('pending');
    try {
      await onCancelTask(task);
      if (mountedRef.current) setCancelState('sent');
    } catch {
      if (mountedRef.current) setCancelState('error');
    }
  };

  const showCancelBar =
    cancelState === 'confirm' || cancelState === 'pending' || cancelState === 'error';

  return (
    <article className={css.Item} data-expanded={open ? 'true' : undefined}>
      <button
        type="button"
        className={css.RowHeader}
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={onToggle}
      >
        <span
          className={classNames(
            css.IconTile,
            awaiting ? css.IconTileWarning : recurring ? css.IconTileSuccess : css.IconTilePrimary
          )}
          aria-hidden="true"
        >
          <Icon
            size="100"
            src={awaiting ? Icons.Warning : recurring ? Icons.Reload : Icons.Clock}
          />
        </span>
        <span className={css.RowBody}>
          <span className={css.RowTopLine}>
            <Text
              as={grouped ? 'h4' : 'h3'}
              size="H5"
              className={classNames(css.RowTitle, css.Wrap)}
              dir="auto"
            >
              {task.description ?? task.taskId}
            </Text>
            {statusPill && (
              <span className={classNames(css.StatusPill, statusPill.variant)}>
                {statusPill.label}
              </span>
            )}
          </span>
          <span className={css.RowSubtitle}>
            {subtitleItems.map((item, index) => (
              <Fragment key={item.key}>
                {index > 0 && (
                  <span className={css.SubtitleDot} aria-hidden="true">
                    ·
                  </span>
                )}
                <Text as="span" size="T200" className={css.Wrap}>
                  {item.node}
                </Text>
              </Fragment>
            ))}
          </span>
        </span>
        <span className={classNames(css.Chevron, open && css.ChevronOpen)} aria-hidden="true">
          <Icon size="100" src={Icons.ChevronBottom} />
        </span>
      </button>

      {open && (
        <div id={drawerId} className={css.Drawer}>
          <div className={css.ChipRow}>
            <span className={css.Chip}>
              {recurring ? t('roomSchedules.recurring') : t('roomSchedules.once')}
            </span>
            {task.silent && <span className={css.Chip}>{t('roomSchedules.silent')}</span>}
            {task.isConditional && (
              <span className={css.Chip}>{t('roomSchedules.conditional')}</span>
            )}
            {task.model && (
              <span className={css.Chip}>
                <bdi>{task.model}</bdi>
              </span>
            )}
            {historyChipLabel && <span className={css.Chip}>{historyChipLabel}</span>}
          </div>

          <div className={css.PromptWell}>
            <Text
              as="p"
              size="T300"
              className={classNames(css.Prompt, promptLong && !promptExpanded && css.PromptClamped)}
              dir="auto"
            >
              {promptText !== undefined
                ? renderSchedulePrompt(promptText)
                : t('roomSchedules.promptUnavailable')}
            </Text>
            {promptLong && (
              <button
                type="button"
                className={css.PromptToggle}
                aria-expanded={promptExpanded}
                onClick={() => setPromptExpanded((expanded) => !expanded)}
              >
                <Text as="span" size="T200">
                  {promptExpanded
                    ? t('roomSchedules.showLessPrompt')
                    : t('roomSchedules.showFullPrompt')}
                </Text>
              </button>
            )}
          </div>

          {showCancelBar && (
            <div className={css.CancelBar}>
              <Text size="T200">{t('roomSchedules.cancelConfirm')}</Text>
              {cancelState === 'error' && (
                <Text size="T200" role="status" className={css.CancelError}>
                  {t('roomSchedules.cancelError')}
                </Text>
              )}
              <div className={css.CancelBarActions}>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="300"
                  disabled={cancelState === 'pending'}
                  onClick={() => setCancelState('idle')}
                >
                  <Text size="T200">{t('roomSchedules.keep')}</Text>
                </Button>
                <Button
                  size="300"
                  variant="Critical"
                  fill="Solid"
                  radii="300"
                  disabled={cancelState === 'pending'}
                  onClick={() => void handleConfirmCancel()}
                >
                  <Text size="T200">
                    {cancelState === 'pending'
                      ? t('roomSchedules.cancelling')
                      : t('roomSchedules.cancelTask')}
                  </Text>
                </Button>
              </div>
            </div>
          )}

          {cancelState === 'sent' && (
            <div role="status" className={css.CancelSentBar}>
              <Text size="T200">{t('roomSchedules.cancellationSent')}</Text>
            </div>
          )}

          <div className={css.ActionsRow}>
            <div className={css.ActionsPrimary}>
              {!task.newThread && task.threadId && (
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  radii="300"
                  onClick={() => onOpenThread(task.threadId!)}
                >
                  <Icon size="100" src={Icons.Thread} />
                  <Text size="T200">{t('roomSchedules.openThread')}</Text>
                </Button>
              )}
              <Button
                size="300"
                variant="Secondary"
                fill="None"
                radii="300"
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen((shown) => !shown)}
              >
                <Text size="T200">
                  {detailsOpen ? t('roomSchedules.hideDetails') : t('roomSchedules.details')}
                </Text>
              </Button>
            </div>

            <div className={css.ActionsSecondary}>
              <Button
                size="300"
                variant="Secondary"
                fill="None"
                radii="300"
                onClick={() => void handleCopyId()}
              >
                {copied ? <Icon size="100" src={Icons.Check} /> : <CopyIcon />}
                <Text size="T200">
                  {copied ? t('roomSchedules.copied') : t('roomSchedules.copyId')}
                </Text>
              </Button>
              <span role="status" className={css.SrOnly}>
                {copied ? t('roomSchedules.copied') : ''}
              </span>

              {onEditTask && (
                <IconButton
                  size="300"
                  variant="SurfaceVariant"
                  fill="None"
                  radii="300"
                  aria-label={t('roomSchedules.edit')}
                  title={t('roomSchedules.edit')}
                  onClick={() => onEditTask(task)}
                >
                  <Icon size="100" src={Icons.Pencil} />
                </IconButton>
              )}

              {onCancelTask && (
                <IconButton
                  size="300"
                  variant="Critical"
                  fill="None"
                  radii="300"
                  aria-label={t('roomSchedules.cancel')}
                  title={t('roomSchedules.cancel')}
                  aria-expanded={showCancelBar}
                  disabled={cancelState === 'pending' || cancelState === 'sent'}
                  onClick={() => setCancelState((state) => (state === 'idle' ? 'confirm' : 'idle'))}
                >
                  <Icon size="100" src={Icons.Delete} />
                </IconButton>
              )}
            </div>
          </div>

          {detailsOpen && (
            <dl id={detailsId} className={css.Metadata}>
              <Text as="dt" size="T200" priority="300">
                {t('roomSchedules.taskId')}
              </Text>
              <Text as="dd" size="T200" className={css.Wrap}>
                <code className={css.TaskId}>
                  <bdi>{task.taskId}</bdi>
                </code>
              </Text>

              {task.createdBy && (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.owner')}
                  </Text>
                  <Text as="dd" size="T200" className={css.Wrap}>
                    <bdi>{creatorMention ?? task.createdBy}</bdi>
                  </Text>
                </>
              )}

              <Text as="dt" size="T200" priority="300">
                {t('roomSchedules.model')}
              </Text>
              <Text as="dd" size="T200" className={css.Wrap}>
                {task.model ? <bdi>{task.model}</bdi> : t('roomSchedules.inheritedModel')}
              </Text>

              {task.historyLimit !== undefined && (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.historyLimit')}
                  </Text>
                  <Text as="dd" size="T200">
                    {task.historyLimit === null
                      ? t('roomSchedules.fullHistory')
                      : task.historyLimit === 0
                      ? t('roomSchedules.noHistory')
                      : t('roomSchedules.recentMessages', { total: task.historyLimit })}
                  </Text>
                </>
              )}

              {recurring ? (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.recurrence')}
                  </Text>
                  <Text as="dd" size="T200" className={css.Wrap}>
                    {task.cronDescription ? (
                      <Box direction="Column" gap="100">
                        <span dir="auto">{task.cronDescription}</span>
                        {utcCronExpression && (
                          <Text as="span" size="T200" priority="300" className={css.Wrap}>
                            {utcCronExpression}
                          </Text>
                        )}
                      </Box>
                    ) : (
                      utcCronExpression ?? t('roomSchedules.unknownTime')
                    )}
                  </Text>
                </>
              ) : (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.executionTime')}
                  </Text>
                  <Text as="dd" size="T200" className={css.Wrap}>
                    {executionTime === undefined ? (
                      t('roomSchedules.unknownTime')
                    ) : (
                      <time dateTime={new Date(executionTime).toISOString()}>
                        {formatter.format(executionTime)}
                      </time>
                    )}
                  </Text>
                </>
              )}

              {createdTime !== undefined && (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.createdAt')}
                  </Text>
                  <Text as="dd" size="T200">
                    <time dateTime={new Date(createdTime).toISOString()}>
                      {formatter.format(createdTime)}
                    </time>
                  </Text>
                </>
              )}

              {showUpdated && (
                <>
                  <Text as="dt" size="T200" priority="300">
                    {t('roomSchedules.updatedAt')}
                  </Text>
                  <Text as="dd" size="T200">
                    <time dateTime={new Date(updatedTime).toISOString()}>
                      {formatter.format(updatedTime)}
                    </time>
                  </Text>
                </>
              )}

              <Text as="dt" size="T200" priority="300">
                {t('roomSchedules.destination')}
              </Text>
              <Text as="dd" size="T200">
                {destinationLabel}
              </Text>
            </dl>
          )}
        </div>
      )}
    </article>
  );
}

export const RoomSchedulesDialog = forwardRef<
  HTMLDivElement,
  {
    roomId: string;
    tasks: readonly ParsedScheduledTask[];
    openThreadId?: string;
    onClose: () => void;
    onOpenThread: (threadId: string) => void;
    onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
    onEditTask?: (task: ParsedScheduledTask) => void;
  }
>(({ roomId, tasks, openThreadId, onClose, onOpenThread, onCancelTask, onEditTask }, ref) => {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }),
    [locale]
  );

  let onceCount = 0;
  let recurringCount = 0;
  tasks.forEach((task) => {
    if (isRecurringTask(task)) recurringCount += 1;
    else onceCount += 1;
  });

  const showFilterBar = onceCount > 0 && recurringCount > 0;
  const effectiveFilter: ScheduleFilter =
    (filter === 'once' && onceCount === 0) || (filter === 'recurring' && recurringCount === 0)
      ? 'all'
      : filter;

  const filteredTasks =
    effectiveFilter === 'all'
      ? tasks
      : tasks.filter((task) =>
          effectiveFilter === 'recurring' ? isRecurringTask(task) : !isRecurringTask(task)
        );

  const activeExpandedId =
    expandedId === undefined
      ? filteredTasks.length === 1
        ? filteredTasks[0]!.taskId
        : null
      : expandedId;

  const threadTasks: ParsedScheduledTask[] = [];
  const elsewhereTasks: ParsedScheduledTask[] = [];
  filteredTasks.forEach((task) => {
    if (openThreadId !== undefined && isScheduleInThread(task, openThreadId))
      threadTasks.push(task);
    else elsewhereTasks.push(task);
  });
  const grouped = threadTasks.length > 0 && elsewhereTasks.length > 0;
  const groups = [
    { id: 'thread', heading: 'roomSchedules.thisThread', tasks: threadTasks },
    { id: 'elsewhere', heading: 'roomSchedules.elsewhereInRoom', tasks: elsewhereTasks },
  ] as const;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectFilter = (next: ScheduleFilter) => {
    setFilter(next);
    setExpandedId(undefined);
  };

  return (
    <Modal
      ref={ref}
      size="400"
      flexHeight
      className={css.Dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <PageScroll
        header={
          <Header size="500" className={css.Header}>
            <Box grow="Yes" alignItems="Center" gap="200">
              <Icon size="200" src={Icons.Clock} />
              <Text as="h2" id={titleId} size="H4">
                {t('roomSchedules.title')}
              </Text>
              <span className={css.HeaderCount}>{tasks.length}</span>
            </Box>
            <IconButton
              size="300"
              radii="300"
              aria-label={t('roomSchedules.close')}
              onClick={onClose}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          </Header>
        }
      >
        <Box direction="Column" gap="300" className={css.Content}>
          {tasks.length === 0 ? (
            <Box direction="Column" gap="200" className={css.Empty}>
              <Text size="T400">{t('roomSchedules.empty')}</Text>
              <Text size="T300" priority="300">
                {t('roomSchedules.emptyHint')}
              </Text>
            </Box>
          ) : (
            <>
              {showFilterBar && (
                <div
                  role="group"
                  aria-label={t('roomSchedules.filterLabel')}
                  className={css.FilterBar}
                >
                  {(
                    [
                      { id: 'all', label: t('roomSchedules.filterAll'), count: tasks.length },
                      { id: 'once', label: t('roomSchedules.once'), count: onceCount },
                      {
                        id: 'recurring',
                        label: t('roomSchedules.recurring'),
                        count: recurringCount,
                      },
                    ] as const
                  ).map((option) => {
                    const active = effectiveFilter === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        className={classNames(css.FilterPill, active && css.FilterPillActive)}
                        onClick={() => selectFilter(option.id)}
                      >
                        <span>{option.label}</span>
                        <span className={css.FilterCount}>{option.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <Box direction="Column" gap="200">
                {groups.map(({ id, heading, tasks: groupTasks }) => (
                  <Fragment key={id}>
                    {grouped && (
                      <Text as="h3" size="T300" priority="300" className={css.GroupHeading}>
                        {t(heading)}
                      </Text>
                    )}
                    {groupTasks.map((task) => {
                      const open = activeExpandedId === task.taskId;
                      return (
                        <ScheduleAccordionItem
                          key={task.taskId}
                          roomId={roomId}
                          task={task}
                          now={now}
                          locale={locale}
                          formatter={formatter}
                          grouped={grouped}
                          open={open}
                          onToggle={() => setExpandedId(open ? null : task.taskId)}
                          onOpenThread={onOpenThread}
                          onCancelTask={onCancelTask}
                          onEditTask={onEditTask}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </Box>
            </>
          )}
        </Box>
      </PageScroll>
    </Modal>
  );
});
