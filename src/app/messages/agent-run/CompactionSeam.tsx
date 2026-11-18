import {
  Fragment,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RectCords } from 'folds';
import { IconAlertTriangle, IconFold } from '@tabler/icons-react';
import { PopOut, revealDirectionControls } from '../../ui/directional';
import { timeHourMinuteSecond } from '../../lib/time';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { MAX_TIME_MS, type ReplyCompaction } from '../../matrix/protocol/compactions';
import {
  formatSeconds,
  formatTokensShort,
  percentOf,
  seamPlace,
  seamState,
  type SeamPlace,
  type SeamState,
} from './compactionCopy';
import * as css from './CompactionSeam.css';

const KEY = 'mindroomUi.messages.compactionSeam';
/** How long a hover card waits for the mouse to reach it, or come back to the row, before closing. */
const HOVER_CLOSE_DELAY_MS = 150;
/** 14px at the default root font size, scaling with it. */
const ICON_SIZE = '0.875rem';

type CompactionSeamProps = {
  compaction: ReplyCompaction;
  /** The reply ended, so a compaction still running there never finishes. */
  interrupted?: boolean;
};

/** How the card came up: a mouse resting on the row, keyboard focus, or a click or tap. */
type OpenMode = 'hover' | 'focus' | 'pinned';

type UnfinishedState = Exclude<SeamState, 'running' | 'success'>;

const isUnfinished = (state: SeamState): state is UnfinishedState =>
  state === 'failed' || state === 'timeout' || state === 'interrupted';

/** The whole seconds since `startedAt`, once a second while `ticking`; undefined without a start. */
const useElapsedSeconds = (startedAt: number | undefined, ticking: boolean): number | undefined => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking || startedAt === undefined) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, ticking]);
  if (startedAt === undefined) return undefined;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
};

type Labels = { t: TFunction; elapsed: string | undefined };

/** The row's words at rest: what happened, and (after a dot) what it changed. */
const restParts = (
  compaction: ReplyCompaction,
  state: SeamState,
  place: SeamPlace,
  { t, elapsed }: Labels
): { what: string; detail?: string; tick?: string } => {
  if (state === 'running') return { what: t(`${KEY}.label.running`), tick: elapsed };
  if (isUnfinished(state)) {
    // Each summary part is saved before the next starts, so one that gave up after folding runs
    // did not keep the full history.
    const kept = !compaction.compactedRunCount;
    return { what: t(`${KEY}.label.${state}`), ...(kept && { detail: t(`${KEY}.keptHistory`) }) };
  }
  const what = t(`${KEY}.label.${place === 'notice' ? 'midTurn' : place}`);
  const { beforeTokens, afterTokens } = compaction;
  if (beforeTokens === undefined || afterTokens === undefined) return { what };
  const detail = t(`${KEY}.tokensShort`, {
    before: formatTokensShort(beforeTokens),
    after: formatTokensShort(afterTokens),
  });
  return { what, detail };
};

/** The card's line under its title: where the compaction ran, or that the reply kept it all. */
const subtitle = (
  compaction: ReplyCompaction,
  state: SeamState,
  place: SeamPlace,
  t: TFunction
): string | undefined => {
  if (place === 'notice') return undefined;
  if (isUnfinished(state)) return t(`${KEY}.subtitle.unfinished`);
  if (place === 'midTurn') {
    return compaction.afterTool > 0
      ? t(`${KEY}.subtitle.midTurn`, { n: compaction.afterTool })
      : t(`${KEY}.subtitle.midTurnNoTools`);
  }
  return t(`${KEY}.subtitle.${place}`);
};

function Gauge({ compaction, state }: { compaction: ReplyCompaction; state: SeamState }) {
  const { t } = useTranslation();
  const { beforeTokens, afterTokens, historyBudgetTokens: budget } = compaction;
  if (beforeTokens === undefined || budget === undefined || budget <= 0) return null;
  const was = percentOf(beforeTokens, budget);
  const done = state === 'success' && afterTokens !== undefined;
  const now = done ? Math.min(100, (afterTokens / budget) * 100) : 0;
  let label: ReactNode = <span>{t(`${KEY}.gauge.unchanged`, { p: was })}</span>;
  if (state === 'running') label = <span>{t(`${KEY}.gauge.used`, { p: was })}</span>;
  if (done) {
    label = (
      <>
        <span>{t(`${KEY}.gauge.was`, { p: was })}</span>
        <span>{t(`${KEY}.gauge.now`, { p: percentOf(afterTokens, budget) })}</span>
      </>
    );
  }
  if (state === 'success' && !done) label = null;
  return (
    <>
      <span className={css.Gauge} data-state={state} data-over={beforeTokens > budget} aria-hidden>
        <i className={css.GaugeWas} style={{ inlineSize: `${Math.min(100, was)}%` }} />
        {done && (
          <i
            className={css.GaugeNow}
            style={{ inlineSize: `max(${now.toFixed(1)}%, 0.1875rem)` }}
          />
        )}
      </span>
      {label && <div className={css.GaugeLabel}>{label}</div>}
    </>
  );
}

type Row = { term: string; value: ReactNode; className?: string };

type RowContext = { t: TFunction; at: (ts: number) => string };

/** History before (and, once done, after) the compaction, the numbers in bold. */
const historyRow = (
  { beforeTokens, afterTokens }: ReplyCompaction,
  done: boolean,
  t: TFunction
): Row[] => {
  if (beforeTokens === undefined) return [];
  const change = done && afterTokens !== undefined;
  const value = (
    <Trans
      t={t}
      shouldUnescape
      tOptions={{ interpolation: { escapeValue: true } }}
      i18nKey={change ? `${KEY}.value.historyChange` : `${KEY}.value.history`}
      values={change ? { before: beforeTokens, after: afterTokens } : { n: beforeTokens }}
      components={{ b: <b /> }}
    />
  );
  return [{ term: t(`${KEY}.row.history`), value }];
};

const budgetRow = ({ historyBudgetTokens: budget }: ReplyCompaction, t: TFunction): Row[] =>
  budget === undefined
    ? []
    : [{ term: t(`${KEY}.row.budget`), value: t(`${KEY}.value.tokens`, { n: budget }) }];

const modelRow = ({ summaryModel }: ReplyCompaction, t: TFunction): Row[] =>
  summaryModel === undefined
    ? []
    : [{ term: t(`${KEY}.row.summaryModel`), value: revealDirectionControls(summaryModel) }];

const timeRow = (term: string, ts: number | undefined, at: RowContext['at']): Row[] =>
  ts === undefined ? [] : [{ term, value: at(ts) }];

/** When the compaction ended; undefined without a start, or past the latest date. */
const endTime = ({ startedAt, durationMs }: ReplyCompaction): number | undefined => {
  if (startedAt === undefined) return undefined;
  const end = startedAt + (durationMs ?? 0);
  return end <= MAX_TIME_MS ? end : undefined;
};

const successRows = (c: ReplyCompaction, { t, at }: RowContext): Row[] => {
  const runs = c.compactedRunCount ?? c.runsBefore;
  const saved =
    c.beforeTokens !== undefined && c.afterTokens !== undefined && c.afterTokens <= c.beforeTokens
      ? c.beforeTokens - c.afterTokens
      : undefined;
  let summarizedBy: string | undefined;
  if (c.summaryModel !== undefined && c.durationMs !== undefined) {
    summarizedBy = t(`${KEY}.value.summarizedBy`, {
      model: revealDirectionControls(c.summaryModel),
      duration: formatSeconds(c.durationMs),
    });
  } else if (c.summaryModel !== undefined) summarizedBy = revealDirectionControls(c.summaryModel);
  return [
    ...historyRow(c, true, t),
    ...(saved === undefined || c.beforeTokens === undefined
      ? []
      : [
          {
            term: t(`${KEY}.row.saved`),
            value: t(`${KEY}.value.saved`, { n: saved, p: percentOf(saved, c.beforeTokens) }),
          },
        ]),
    ...budgetRow(c, t),
    ...(runs === undefined
      ? []
      : [
          {
            term: t(`${KEY}.row.folded`),
            value: t(`${KEY}.value.folded`, { runs: t(`${KEY}.value.runs`, { count: runs }) }),
          },
        ]),
    ...(summarizedBy === undefined
      ? []
      : [{ term: t(`${KEY}.row.summarizedBy`), value: summarizedBy }]),
    ...timeRow(t(`${KEY}.row.when`), endTime(c), at),
  ];
};

const runningRows = (c: ReplyCompaction, { t, at }: RowContext): Row[] => {
  let folding: string | undefined;
  if (c.runsBefore !== undefined) {
    const runs = t(`${KEY}.value.runs`, { count: c.runsBefore });
    folding =
      c.compactedRunCount === undefined
        ? runs
        : t(`${KEY}.value.folding`, { runs, done: c.compactedRunCount });
  }
  return [
    ...historyRow(c, false, t),
    ...budgetRow(c, t),
    ...(folding === undefined ? [] : [{ term: t(`${KEY}.row.folding`), value: folding }]),
    ...modelRow(c, t),
    ...timeRow(t(`${KEY}.row.started`), c.startedAt, at),
  ];
};

const unfinishedRows = (c: ReplyCompaction, state: SeamState, { t, at }: RowContext): Row[] => {
  const interrupted = state === 'interrupted';
  let reason: string | undefined = c.failureReason && revealDirectionControls(c.failureReason);
  if (interrupted) reason = t(`${KEY}.value.interrupted`);
  return [
    ...(reason === undefined
      ? []
      : [{ term: t(`${KEY}.row.reason`), value: reason, className: css.Reason }]),
    ...historyRow(c, false, t),
    ...budgetRow(c, t),
    ...modelRow(c, t),
    ...(interrupted || c.durationMs === undefined
      ? []
      : [{ term: t(`${KEY}.row.gaveUpAfter`), value: formatSeconds(c.durationMs) }]),
    ...(interrupted
      ? timeRow(t(`${KEY}.row.started`), c.startedAt, at)
      : timeRow(t(`${KEY}.row.when`), endTime(c), at)),
  ];
};

const cardRows = (c: ReplyCompaction, state: SeamState, context: RowContext): Row[] => {
  if (state === 'success') return successRows(c, context);
  if (state === 'running') return runningRows(c, context);
  return unfinishedRows(c, state, context);
};

/**
 * One history compaction, as a quiet row at the spot of the reply where it ran: what it did in a
 * few words and a hairline to the row's end. Hovering, focusing or tapping the row opens a card
 * below it with the numbers.
 */
export function CompactionSeam({ compaction, interrupted = false }: CompactionSeamProps) {
  const { t, i18n } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ mode: OpenMode; anchor: RectCords }>();
  const cardId = useId();
  const state = seamState(compaction, interrupted);
  const place = seamPlace(compaction);
  const seconds = useElapsedSeconds(compaction.startedAt, state === 'running');
  const elapsed = seconds === undefined ? undefined : t(`${KEY}.elapsed`, { n: seconds });

  const show = (mode: OpenMode) => {
    const trigger = triggerRef.current;
    if (trigger) setOpen({ mode, anchor: trigger.getBoundingClientRect() });
  };

  // A card the mouse opened stays while the mouse is on the row or on the card, so it can be read
  // and selected (WCAG 1.4.13): leaving either closes it only after a moment without the other.
  const closeTimer = useRef<number>();
  const keepHover = () => window.clearTimeout(closeTimer.current);
  const leaveHover = (evt: PointerEvent) => {
    if (evt.pointerType !== 'mouse' || open?.mode !== 'hover') return;
    keepHover();
    closeTimer.current = window.setTimeout(() => {
      setOpen((current) => (current?.mode === 'hover' ? undefined : current));
    }, HOVER_CLOSE_DELAY_MS);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const cardRef = useRef<HTMLDivElement>(null);

  const isOpen = !!open;
  useEffect(() => {
    if (!isOpen) return undefined;
    const close = () => setOpen(undefined);
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') close();
    };
    const onPointerDown = (evt: Event) => {
      const target = evt.target as Node;
      if (!triggerRef.current?.contains(target) && !cardRef.current?.contains(target)) close();
    };
    // The card sits at a fixed spot; the timeline scrolls on its own as rows arrive and settle,
    // so it follows the row instead of closing.
    const onScroll = () => {
      const trigger = triggerRef.current;
      if (trigger)
        setOpen((current) => current && { ...current, anchor: trigger.getBoundingClientRect() });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen]);

  const unfinished = isUnfinished(state);
  const Icon = unfinished ? IconAlertTriangle : IconFold;
  const rest = restParts(compaction, state, place, { t, elapsed });
  const title = state === 'success' ? t(`${KEY}.title`) : t(`${KEY}.label.${state}`);
  const tag = place === 'notice' ? undefined : t(`${KEY}.tag.${place}`);
  const sub = subtitle(compaction, state, place, t);
  const at = (ts: number) => timeHourMinuteSecond(ts, hour24Clock, i18n.language);
  const rows = cardRows(compaction, state, { t, at });

  return (
    <div className={css.Seam} data-compaction-seam data-state={state}>
      <button
        ref={triggerRef}
        type="button"
        className={css.Trigger}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? cardId : undefined}
        onPointerEnter={(evt: PointerEvent) => {
          if (evt.pointerType !== 'mouse') return;
          keepHover();
          if (!open) show('hover');
        }}
        onPointerLeave={leaveHover}
        onFocus={() => {
          // Focus outlasts a hover opening, so a mouse leaving must not close the card under it.
          if (open?.mode !== 'pinned') show('focus');
        }}
        onClick={() => (open?.mode === 'pinned' ? setOpen(undefined) : show('pinned'))}
        onBlur={() => setOpen(undefined)}
      >
        <Icon className={css.Icon} size={ICON_SIZE} aria-hidden />
        <span>{rest.what}</span>
        {rest.detail !== undefined && (
          <>
            {' '}
            <span className={css.Separator} aria-hidden>
              ·
            </span>{' '}
            <span>{rest.detail}</span>
          </>
        )}
        {rest.tick !== undefined && (
          <>
            {' '}
            <span>{rest.tick}</span>
          </>
        )}
      </button>
      <span className={css.Rule} aria-hidden />
      {/* folds' PopOut layer covers the screen; as a tooltip it must let the pointer through to
          the row and the timeline, while the card takes it, so the mouse can rest on the card.
          The card inside, not the layer, has the role: on touch screens index.css hides tooltip
          layers in the body, and this card a tap opens. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        anchor={open?.anchor}
        position="Bottom"
        align="Start"
        offset={6}
        content={
          <div
            ref={cardRef}
            id={cardId}
            role="tooltip"
            className={css.Card}
            data-state={state}
            style={{ pointerEvents: 'auto' }}
            onPointerEnter={(evt: PointerEvent) => {
              if (evt.pointerType === 'mouse') keepHover();
            }}
            onPointerLeave={leaveHover}
          >
            <div className={css.Head}>
              <Icon size={ICON_SIZE} aria-hidden />
              <span>
                {title}
                {state === 'running' && elapsed !== undefined && ` ${elapsed}`}
              </span>
              {tag !== undefined && <span className={css.Tag}>{tag}</span>}
            </div>
            {sub !== undefined && <div className={css.Subtitle}>{sub}</div>}
            <Gauge compaction={compaction} state={state} />
            <dl className={css.Rows}>
              {rows.map(({ term, value, className }) => (
                <Fragment key={term}>
                  <dt className={css.Term}>{term}</dt>
                  <dd className={className ? `${css.Value} ${className}` : css.Value}>{value}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        }
      />
    </div>
  );
}

/**
 * How long an old notice may say it is compacting: the backend gives a compaction 600 s, so a
 * notice still running well past that lost its final edit and never finishes.
 */
const NOTICE_GIVE_UP_MS = 15 * 60_000;

/**
 * The compaction of an old `io.mindroom.compaction` notice, as its seam row. One still running
 * 15 min after the notice was sent (its `startedAt`) shows as interrupted, from that moment on.
 */
export function CompactionNoticeSeam({ compaction }: { compaction: ReplyCompaction }) {
  const { status, startedAt } = compaction;
  const deadline =
    status === 'running' && startedAt !== undefined ? startedAt + NOTICE_GIVE_UP_MS : undefined;
  const [, wake] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (deadline === undefined) return undefined;
    const left = deadline - Date.now();
    // The deadline can pass between the render and this effect: draw it as interrupted now.
    if (left <= 0) {
      wake();
      return undefined;
    }
    const timer = window.setTimeout(wake, left);
    return () => window.clearTimeout(timer);
  }, [deadline]);
  const gaveUp = deadline !== undefined && Date.now() >= deadline;
  return <CompactionSeam compaction={compaction} interrupted={gaveUp} />;
}
