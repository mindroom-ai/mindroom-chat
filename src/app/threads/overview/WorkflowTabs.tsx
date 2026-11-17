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

/** A count that rolls like an odometer when it changes: up when it grows, down when it shrinks. */
function RollingCount({ value, language }: { value: number | undefined; language: string }) {
  const text = localDigits(String(value ?? 0), language);
  const [shown, setShown] = useState({
    value,
    text,
    from: undefined as string | undefined,
    up: true,
    turn: 0,
  });
  if (shown.value !== value) {
    // A count that arrives (from none) shows without rolling.
    const previous = shown.value;
    const rolls = previous !== undefined && value !== undefined;
    setShown({
      value,
      text,
      from: rolls ? shown.text : undefined,
      up: rolls ? value > previous : shown.up,
      turn: rolls ? shown.turn + 1 : shown.turn,
    });
  } else if (shown.text !== text) {
    setShown({ ...shown, text });
  }
  const { from, up, turn } = shown;
  return (
    <Text
      as="span"
      size="T200"
      className={css.WorkflowCount}
      data-roll={turn > 0 ? (up ? 'up' : 'down') : undefined}
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
          {from}
        </span>
      )}
      <span key={`in-${turn}`} className={turn > 0 ? css.RollIn : undefined}>
        {shown.text}
      </span>
    </Text>
  );
}

export type WorkflowTabsProps = {
  /** The pressed tab; none while other filters pick the threads. */
  active: ThreadWorkflowTab | undefined;
  counts: ThreadWorkflowCounts | undefined;
  onSelect?: (tab: ThreadWorkflowTab) => void;
};

/**
 * The Needs you / Working / Later / Done / All tabs. One pill glides to the pressed tab, whose icon
 * makes a small gesture; counts roll when they change, and a new thread pings Needs you. Nothing
 * moves on mount: give it a `key` per room so a room switch starts it afresh.
 */
export function WorkflowTabs({ active, counts, onSelect }: WorkflowTabsProps) {
  const { t, i18n } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  useSlidingPill(groupRef, pillRef, active);

  // Changes since the last render: a newly pressed tab plays its gesture, and a Needs you count
  // that grows pings. Both start from what the first render showed, so mounting plays nothing.
  const needsYou = counts?.needsYou;
  const [seen, setSeen] = useState({
    active,
    needsYou,
    gesture: undefined as ThreadWorkflowTab | undefined,
    pings: 0,
  });
  if (seen.active !== active || seen.needsYou !== needsYou) {
    const grew = seen.needsYou !== undefined && needsYou !== undefined && needsYou > seen.needsYou;
    setSeen({
      active,
      needsYou,
      gesture: seen.active !== active ? active : seen.gesture,
      pings: grew ? seen.pings + 1 : seen.pings,
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
              <span className={css.WorkflowIcon} aria-hidden="true">
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
              <RollingCount value={counts?.[tab]} language={i18n.language} />
              {tab === 'needsYou' && seen.pings > 0 && (
                <span key={seen.pings} className={css.PingDot} aria-hidden="true" />
              )}
            </button>
          )}
        </TooltipProvider>
      ))}
    </div>
  );
}
