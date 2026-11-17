import React, { useRef, useState } from 'react';
import { Text, Tooltip, toRem } from 'folds';
import { IconBell, IconCheck, IconClock, IconList, IconLoader } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  THREAD_WORKFLOW_TABS,
  type ThreadWorkflowCounts,
  type ThreadWorkflowTab,
} from '../../event-store/threads/threadWorkflow';
import { TooltipProvider } from '../../ui/directional';
import { localDigits } from '../../lib/localDigits';
import { useSlidingPill } from './useSlidingPill';
import * as css from './WorkflowTabs.css';

const WORKFLOW_ICONS = {
  needsYou: IconBell,
  working: IconLoader,
  later: IconClock,
  done: IconCheck,
  all: IconList,
};

// Motion state is made only when it can play: an animation that never runs never ends.
const reducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * A count that rolls like an odometer when it changes: up when it grows, down when it shrinks.
 * Only between two renders that both `animate`: the render that starts animating (counts that
 * finished loading, often with the last page's values) takes its count as it is.
 */
function RollingCount({
  value,
  animate,
  language,
}: {
  value: number;
  animate: boolean;
  language: string;
}) {
  const [shown, setShown] = useState({
    value,
    animate,
    from: undefined as number | undefined,
    turn: 0,
  });
  if (shown.value !== value || shown.animate !== animate) {
    const rolls = shown.value !== value && shown.animate && animate && !reducedMotion();
    // A roll replaces one still under way, so an old count never outlasts the next change.
    setShown({
      value,
      animate,
      from: rolls ? shown.value : shown.value === value ? shown.from : undefined,
      turn: rolls ? shown.turn + 1 : shown.turn,
    });
  }
  const { from, turn } = shown;
  const digits = (count: number) => localDigits(String(count), language);
  return (
    <Text
      as="span"
      size="T200"
      className={css.WorkflowCount}
      data-roll={from === undefined ? undefined : from < value ? 'up' : 'down'}
    >
      {from !== undefined && (
        <span
          key={`out-${turn}`}
          className={css.RollOut}
          onAnimationEnd={() =>
            setShown((current) =>
              current.turn === turn ? { ...current, from: undefined } : current
            )
          }
        >
          {digits(from)}
        </span>
      )}
      <span key={`in-${turn}`} className={from === undefined ? undefined : css.RollIn}>
        {digits(value)}
      </span>
    </Text>
  );
}

export type WorkflowTabsProps = {
  /** The pressed tab; none while other filters pick the threads. */
  active: ThreadWorkflowTab | undefined;
  counts: ThreadWorkflowCounts | undefined;
  /**
   * Whether the counts have stopped loading. Until then they only take their new values: a room
   * whose threads arrive page by page neither rolls them nor pings Needs you.
   */
  countsSettled: boolean;
  onSelect?: (tab: ThreadWorkflowTab) => void;
};

/**
 * The Needs you / Working / Later / Done / All tabs. One pill glides to the pressed tab, whose icon
 * makes a small gesture; settled counts roll when they change, and a new thread pings Needs you.
 * Nothing moves on mount: give it a `key` per room so a room switch starts it afresh.
 */
export function WorkflowTabs({ active, counts, countsSettled, onSelect }: WorkflowTabsProps) {
  const { t, i18n } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  useSlidingPill(groupRef, pillRef, active);

  // Changes since the last render: a newly pressed tab plays its gesture, and a Needs you count
  // that grows between two settled renders pings. Both start from what the first render showed,
  // so mounting plays nothing; each ends with its animation or with the next change of its kind.
  const needsYou = counts?.needsYou ?? 0;
  const [seen, setSeen] = useState({
    active,
    needsYou,
    settled: countsSettled,
    gesture: undefined as ThreadWorkflowTab | undefined,
    ping: 0,
    pinging: false,
  });
  if (seen.active !== active || seen.needsYou !== needsYou || seen.settled !== countsSettled) {
    const moves = !reducedMotion();
    const pings = moves && seen.settled && countsSettled && needsYou > seen.needsYou;
    setSeen({
      active,
      needsYou,
      settled: countsSettled,
      gesture: seen.active === active ? seen.gesture : moves ? active : undefined,
      ping: pings ? seen.ping + 1 : seen.ping,
      pinging: seen.needsYou === needsYou ? seen.pinging : pings,
    });
  }

  return (
    <div
      ref={groupRef}
      className={css.WorkflowTabs}
      role="group"
      aria-label={t('mindroomUi.threads.roomThreadOverview.statusFilters')}
    >
      <span ref={pillRef} className={css.WorkflowPill} aria-hidden="true" />
      {THREAD_WORKFLOW_TABS.map((tab) => (
        <TooltipProvider
          key={tab}
          position="Bottom"
          align="Center"
          tooltip={
            <Tooltip style={{ maxWidth: toRem(320) }}>
              <Text size="T200">{t(`thread.workflow.description.${tab}`)}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <button
              ref={triggerRef}
              type="button"
              data-thread-tab={tab}
              data-gesture={active === tab && seen.gesture === tab ? '' : undefined}
              className={css.WorkflowTab}
              aria-label={`${t(`thread.workflow.${tab}`)} ${localDigits(
                String(counts?.[tab] ?? 0),
                i18n.language
              )}`}
              aria-pressed={active === tab}
              onClick={() => onSelect?.(tab)}
            >
              <span
                className={css.WorkflowIcon}
                aria-hidden="true"
                onAnimationEnd={(event) => {
                  // A gesture can be several animations (the list's lines); it ends with the last.
                  const playing = event.currentTarget
                    .getAnimations({ subtree: true })
                    .some((animation) => 'animationName' in animation);
                  if (playing) return;
                  setSeen((current) =>
                    current.gesture === tab ? { ...current, gesture: undefined } : current
                  );
                }}
              >
                {React.createElement(WORKFLOW_ICONS[tab], {
                  size: toRem(12),
                  stroke: 1.8,
                  className: css.WorkflowGlyph,
                })}
              </span>
              <span className={css.WorkflowLabel}>
                <Text as="span" size="T200" className={css.WorkflowLabelText}>
                  {t(`thread.workflow.${tab}`)}
                </Text>
              </span>
              <RollingCount
                value={counts?.[tab] ?? 0}
                animate={countsSettled}
                language={i18n.language}
              />
              {tab === 'needsYou' && seen.pinging && (
                <span
                  key={seen.ping}
                  className={css.PingDot}
                  aria-hidden="true"
                  onAnimationEnd={(event) => {
                    if (event.animationName !== css.pingPop) return;
                    const { ping } = seen;
                    setSeen((current) =>
                      current.ping === ping ? { ...current, pinging: false } : current
                    );
                  }}
                />
              )}
            </button>
          )}
        </TooltipProvider>
      ))}
    </div>
  );
}
