import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconAlertTriangle, IconFold } from '@tabler/icons-react';
import { PopOut, revealDirectionControls } from '../../ui/directional';
import { useAnchoredCard } from '../../ui/useAnchoredCard';
import { timeHourMinuteSecond } from '../../lib/time';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
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

/** The row's words at rest: what happened, and (after a dot) what it changed. */
const restParts = (
  compaction: ReplyCompaction,
  state: SeamState,
  place: SeamPlace,
  t: TFunction
): { what: string; detail?: string } => {
  if (state === 'running') return { what: t(`${KEY}.label.running`) };
  if (isUnfinished(state)) return { what: t(`${KEY}.label.${state}`) };
  const what = t(`${KEY}.label.${place === 'notice' ? 'midTurn' : place}`);
  const { beforeTokens, afterTokens } = compaction;
  if (beforeTokens === undefined || afterTokens === undefined) return { what };
  const detail = t(`${KEY}.tokensShort`, {
    before: formatTokensShort(beforeTokens),
    after: formatTokensShort(afterTokens),
  });
  return { what, detail };
};

/** The card's line under its title: where a compaction that finished or still runs took place. */
const subtitle = (
  compaction: ReplyCompaction,
  state: SeamState,
  place: SeamPlace,
  t: TFunction
): string | undefined => {
  if (place === 'notice' || isUnfinished(state)) return undefined;
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
  let label: ReactNode = null;
  if (done) {
    label = (
      <>
        <span>{t(`${KEY}.gauge.was`, { p: was })}</span>
        <span>{t(`${KEY}.gauge.now`, { p: percentOf(afterTokens, budget) })}</span>
      </>
    );
  } else if (state === 'running') label = <span>{t(`${KEY}.gauge.used`, { p: was })}</span>;
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

type Row = { term: string; value: ReactNode };

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

/** A row of the card, or none without a value. */
const row = (term: string, value: ReactNode | undefined): Row[] =>
  value === undefined ? [] : [{ term, value }];

const budgetRow = ({ historyBudgetTokens: budget }: ReplyCompaction, t: TFunction): Row[] =>
  row(
    t(`${KEY}.row.budget`),
    budget === undefined ? undefined : t(`${KEY}.value.tokens`, { n: budget })
  );

const modelRow = ({ summaryModel }: ReplyCompaction, t: TFunction): Row[] =>
  row(t(`${KEY}.row.summaryModel`), summaryModel && revealDirectionControls(summaryModel));

const timeRow = (term: string, ts: number | undefined, at: RowContext['at']): Row[] =>
  row(term, ts === undefined ? undefined : at(ts));

/** When the compaction ended; undefined without a start, or past the latest date. */
const endTime = ({ startedAt, durationMs }: ReplyCompaction): number | undefined => {
  if (startedAt === undefined) return undefined;
  const end = startedAt + (durationMs ?? 0);
  return end <= MAX_TIME_MS ? end : undefined;
};

const successRows = (c: ReplyCompaction, { t, at }: RowContext): Row[] => {
  const runs = c.compactedRunCount ?? c.runsBefore;
  const { beforeTokens: before, afterTokens: after } = c;
  const model = c.summaryModel && revealDirectionControls(c.summaryModel);
  return [
    ...historyRow(c, true, t),
    ...row(
      t(`${KEY}.row.saved`),
      before !== undefined && after !== undefined && after <= before
        ? t(`${KEY}.value.saved`, { n: before - after, p: percentOf(before - after, before) })
        : undefined
    ),
    ...budgetRow(c, t),
    ...row(
      t(`${KEY}.row.folded`),
      runs === undefined
        ? undefined
        : t(`${KEY}.value.folded`, { runs: t(`${KEY}.value.runs`, { count: runs }) })
    ),
    ...row(
      t(`${KEY}.row.summarizedBy`),
      model !== undefined && c.durationMs !== undefined
        ? t(`${KEY}.value.summarizedBy`, { model, duration: formatSeconds(c.durationMs) })
        : model
    ),
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
    ...row(t(`${KEY}.row.folding`), folding),
    ...modelRow(c, t),
    ...timeRow(t(`${KEY}.row.started`), c.startedAt, at),
  ];
};

const unfinishedRows = (c: ReplyCompaction, state: SeamState, { t, at }: RowContext): Row[] => {
  const interrupted = state === 'interrupted';
  const reason = interrupted
    ? t(`${KEY}.value.interrupted`)
    : c.failureReason && revealDirectionControls(c.failureReason);
  return [
    ...row(t(`${KEY}.row.reason`), reason),
    ...historyRow(c, false, t),
    ...budgetRow(c, t),
    ...modelRow(c, t),
    ...row(
      t(`${KEY}.row.gaveUpAfter`),
      interrupted || c.durationMs === undefined ? undefined : formatSeconds(c.durationMs)
    ),
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
  const { open, triggerRef, cardRef, show, toggle, pin, hover, onFocusLeave } =
    useAnchoredCard(HOVER_CLOSE_DELAY_MS);
  const cardId = useId();
  const state = seamState(compaction, interrupted);
  const place = seamPlace(compaction);
  const seconds = useElapsedSeconds(compaction.startedAt, state === 'running');
  // The running clock, on the row and in the card's head.
  const elapsed =
    state === 'running' && seconds !== undefined ? t(`${KEY}.elapsed`, { n: seconds }) : undefined;

  // A card the keyboard pinned takes focus once it shows (the frame loop hands it a new anchor
  // then), so its keys scroll it; Escape gives focus back to the row.
  const focusCard = useRef(false);
  useEffect(() => {
    if (open?.mode !== 'pinned') {
      focusCard.current = false;
      return;
    }
    const cardElement = cardRef.current;
    if (!focusCard.current || !cardElement) return;
    focusCard.current = false;
    cardElement.focus({ preventScroll: true });
  }, [open, cardRef]);
  const isOpen = !!open;

  const unfinished = isUnfinished(state);
  const Icon = unfinished ? IconAlertTriangle : IconFold;
  const rest = restParts(compaction, state, place, t);
  const title = state === 'success' ? t(`${KEY}.title`) : t(`${KEY}.label.${state}`);
  const tag = place === 'notice' ? undefined : t(`${KEY}.tag.${place}`);
  const sub = subtitle(compaction, state, place, t);
  const at = (ts: number) => timeHourMinuteSecond(ts, hour24Clock, i18n.language);
  // The card's rows are built only while it shows.
  const rows = isOpen ? cardRows(compaction, state, { t, at }) : [];

  return (
    // Keeps the interface's direction in a reply that reads the other way (index.css), as the tool
    // rows do: in an Arabic reply an English row still reads `367k → 6k tokens`.
    <div className={css.Seam} data-compaction-seam data-state={state}>
      <button
        ref={triggerRef}
        type="button"
        className={css.Trigger}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? cardId : undefined}
        {...hover}
        onFocus={() => {
          // Focus outlasts a hover opening, so a mouse leaving must not close the card under it.
          if (open?.mode !== 'pinned') show('focus');
        }}
        onClick={(evt: MouseEvent) => {
          // Enter and Space click with no press count.
          focusCard.current = evt.detail === 0;
          toggle();
        }}
        onBlur={onFocusLeave}
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
        {elapsed !== undefined && (
          <>
            {' '}
            <span>{elapsed}</span>
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
            tabIndex={-1}
            className={css.Card}
            data-state={state}
            style={{ pointerEvents: 'auto' }}
            {...hover}
            onFocus={pin}
            onBlur={onFocusLeave}
          >
            <div className={css.Head}>
              <span className={css.HeadTitle}>
                <Icon className={css.HeadIcon} size={ICON_SIZE} aria-hidden />
                <span data-compaction-title>
                  {title}
                  {elapsed !== undefined && ` ${elapsed}`}
                </span>
              </span>
              {tag !== undefined && (
                <span className={css.Tag} data-compaction-tag>
                  {tag}
                </span>
              )}
            </div>
            {sub !== undefined && <div className={css.Subtitle}>{sub}</div>}
            <Gauge compaction={compaction} state={state} />
            <dl className={css.Rows}>
              {rows.map(({ term, value }) => (
                <Fragment key={term}>
                  <dt className={css.Term}>{term}</dt>
                  <dd className={css.Value}>{value}</dd>
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
  const [, wake] = useForceUpdate();
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
  }, [deadline, wake]);
  const gaveUp = deadline !== undefined && Date.now() >= deadline;
  return <CompactionSeam compaction={compaction} interrupted={gaveUp} />;
}
