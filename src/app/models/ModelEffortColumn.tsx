import { IconCheck, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { KeyboardEventHandler, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { EffortGlyph, effortBars } from './EffortGlyph';
import type { ModelCatalogEntry, ReasoningLevel } from './modelProtocol';
import * as css from './ModelPicker.css';

type ModelEffortColumnProps = {
  /** The model the thread runs on, when the catalog has it and the room's agents share it. */
  model?: ModelCatalogEntry;
  /** The level it runs at, which gets the check; none while the agents' levels differ. */
  active?: ReasoningLevel;
  /** The name in the header: the model the thread runs on. */
  modelName: string;
  disabled: boolean;
  columnRef: RefObject<HTMLDivElement>;
  onPick: (level: ReasoningLevel) => void;
  /** A column beside the models, or on a phone a view in their place with a way back to them. */
  mode: 'column' | 'view';
  /** ArrowLeft, Escape or the view's Back: the keys go back to the models. */
  onLeave: () => void;
};

/**
 * The levels of the model the thread runs on, each a radio, with a check on the level it runs at
 * and the model's default marked.
 */
export function ModelEffortColumn({
  model,
  active,
  modelName,
  disabled,
  columnRef,
  onPick,
  mode,
  onLeave,
}: ModelEffortColumnProps) {
  const { t } = useTranslation();
  const levelLabel = (level: ReasoningLevel) => t(`mindroomUi.models.modelPicker.levels.${level}`);

  // Up and Down move between the levels, which stop at either end; Left and Escape leave.
  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
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
    <div ref={columnRef} className={css.EffortColumn} data-effort-column="" data-mode={mode}>
      <div className={css.EffortHeader}>
        {mode === 'view' && (
          <button
            type="button"
            className={css.EffortBack}
            aria-label={t('mindroomUi.models.modelPicker.back')}
            onClick={onLeave}
            onKeyDown={handleKeyDown}
          >
            <IconChevronLeft className={css.Mirrored} size={20} aria-hidden="true" />
          </button>
        )}
        <span>{t('mindroomUi.models.modelPicker.effort')}</span>
        <span className={css.EffortModel}>{modelName}</span>
      </div>
      {model?.reasoning_levels ? (
        <div
          // Another model's levels are other buttons, so a focused level never changes model.
          key={model.key}
          role="radiogroup"
          aria-label={t('mindroomUi.models.modelPicker.effortFor', { model: model.display_name })}
          className={css.EffortLevels}
          // Focus sits on its radios; the group only takes their keys.
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {model.reasoning_levels.map((level) => {
            const label = levelLabel(level);
            const isDefault = level === model.reasoning_default;
            const checked = level === active;
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
                // The keys enter on the checked level, else the default.
                tabIndex={level === (active ?? model.reasoning_default) ? 0 : -1}
                className={css.EffortRow}
                data-level={level}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !disabled && onPick(level)}
              >
                <span className={css.EffortLabel}>{label}</span>
                {isDefault && (
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

/**
 * On a phone, under the models of a model with levels: the level it runs at, a row that opens the
 * levels in place of the models.
 */
export function ModelEffortEntry({
  levels,
  active,
  entryRef,
  onOpen,
}: {
  levels: readonly ReasoningLevel[];
  /** None while the agents' levels differ. */
  active?: ReasoningLevel;
  entryRef: RefObject<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const bars = effortBars(levels, active ?? 'off');
  const level = active && t(`mindroomUi.models.modelPicker.levels.${active}`);
  return (
    <div className={css.EffortEntryBar}>
      <button
        ref={entryRef}
        type="button"
        className={css.EffortEntry}
        aria-label={
          level
            ? t('mindroomUi.models.modelPicker.effortLevel', { level })
            : t('mindroomUi.models.modelPicker.effort')
        }
        data-effort-entry=""
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return;
          event.preventDefault();
          onOpen();
        }}
      >
        <span className={css.OptionIcon} aria-hidden="true">
          {bars.count > 0 && <EffortGlyph count={bars.count} filled={bars.filled} />}
        </span>
        <span className={css.EffortLabel}>{t('mindroomUi.models.modelPicker.effort')}</span>
        {level && <span className={css.EffortValue}>{level}</span>}
        <IconChevronRight
          className={`${css.EffortValue} ${css.Mirrored}`}
          size={16}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
