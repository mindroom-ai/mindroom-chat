import { IconCheck } from '@tabler/icons-react';
import { KeyboardEventHandler, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelCatalogEntry, ReasoningLevel } from './modelProtocol';
import * as css from './ModelPicker.css';

/** A model's reasoning levels, as the effort column lists them. */
export type Effort = {
  model: ModelCatalogEntry;
  levels: ReasoningLevel[];
  /** The level the plain key runs at. */
  fallback: ReasoningLevel;
  /** The level that gets the check: the one the thread runs the model at, when it does. */
  active?: ReasoningLevel;
  /** Whether `active` is what the thread runs on now, so picking it again changes nothing. */
  current: boolean;
};

/** `model`'s levels, or nothing for a model without levels. */
export const effortOf = (
  model: ModelCatalogEntry | undefined,
  active?: ReasoningLevel,
  current = false
): Effort | undefined =>
  model?.reasoning_levels && model.reasoning_default
    ? {
        model,
        levels: model.reasoning_levels,
        fallback: model.reasoning_default,
        active,
        current,
      }
    : undefined;

/** The level a column opened by the keys starts on: the checked one, else the default. */
const tabStop = (effort: Effort): ReasoningLevel => effort.active ?? effort.fallback;

type ModelEffortColumnProps = {
  /** The levels to list; undefined says the model has none. */
  effort?: Effort;
  /** The name in the header: the model the column is for. */
  modelName?: string;
  disabled: boolean;
  columnRef: RefObject<HTMLDivElement>;
  onPick: (effort: Effort, level: ReasoningLevel) => void;
  /** ArrowLeft or Escape: the keys go back to the models. */
  onLeave: () => void;
};

/**
 * The column beside the models: the levels of the model the highlight is on, each a radio, with a
 * check on the level it runs at and the model's default marked.
 */
export function ModelEffortColumn({
  effort,
  modelName,
  disabled,
  columnRef,
  onPick,
  onLeave,
}: ModelEffortColumnProps) {
  const { t } = useTranslation();
  const levelLabel = (level: ReasoningLevel) => t(`mindroomUi.models.modelPicker.levels.${level}`);

  // Up and Down move between the levels, which stop at either end; Left and Escape leave.
  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = rows.findIndex((row) => row === document.activeElement);
    const next =
      rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
    next?.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <div ref={columnRef} className={css.EffortColumn} data-effort-column="">
      <div className={css.EffortHeader}>
        <span>{t('mindroomUi.models.modelPicker.effort')}</span>
        {modelName && <span className={css.EffortModel}>{modelName}</span>}
      </div>
      {effort ? (
        <div
          role="radiogroup"
          aria-label={t('mindroomUi.models.modelPicker.effortFor', {
            model: effort.model.display_name,
          })}
          className={css.EffortLevels}
          // Focus sits on its radios; the group only takes their keys.
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {effort.levels.map((level) => {
            const label = levelLabel(level);
            const isDefault = level === effort.fallback;
            const checked = level === effort.active;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={
                  isDefault
                    ? t('mindroomUi.models.modelPicker.levelIsDefault', { level: label })
                    : label
                }
                aria-disabled={disabled}
                tabIndex={level === tabStop(effort) ? 0 : -1}
                className={css.EffortRow}
                data-level={level}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !disabled && onPick(effort, level)}
              >
                <span className={css.EffortLabel}>{label}</span>
                {isDefault && !checked && (
                  <span className={css.EffortDefault} aria-hidden="true">
                    {t('mindroomUi.models.modelPicker.defaultLevel')}
                  </span>
                )}
                {checked && <IconCheck className={css.Check} size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={css.EffortNone}>{t('mindroomUi.models.modelPicker.noEffortLevels')}</div>
      )}
    </div>
  );
}
