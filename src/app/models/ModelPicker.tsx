import FocusTrap from 'focus-trap-react';
import { Scroll, Spinner, config, toRem } from 'folds';
import { PopOut } from '../ui/directional';
import { Room } from 'matrix-js-sdk';
import { IconCheck, IconRotateClockwise, IconSearch } from '@tabler/icons-react';
import {
  ChangeEventHandler,
  KeyboardEventHandler,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useNavigate } from 'react-router-dom';

import { formatRelativeTime } from '../lib/time';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { getUsagePath } from '../routes/pathUtils';
import { mobileOrTablet } from '../lib/user-agent';
import { IconButton, Menu } from '../ui/glass/GlassPrimitives';
import { glassExpanded } from '../ui/styles/Glass.css';
import { IconTooltip } from '../ui/IconTooltip';
import { EffortGlyph, effortBars } from './EffortGlyph';
import { ModelEffortColumn, ModelEffortEntry } from './ModelEffortColumn';
import type { ModelCatalogEntry, ModelInheritedEntry, ReasoningLevel } from './modelProtocol';
import { ModelIcon } from './ModelIcon';
import type { ProviderUsageSnapshot } from '../usage/providerUsageProtocol';
import { InlineQuotaSummary, singleAccountForModels } from '../usage/QuotaBar';
import { useRuntimeProviderUsage } from '../usage/useProviderUsage';
import { useModelPicker, type ModelPickerState } from './useModelPicker';
import * as css from './ModelPicker.css';

/** A catalog longer than this gets a field above its models that filters them. */
const FILTER_AFTER = 8;
/** The gap between the menu and its button. */
const POP_OUT_OFFSET = 8;
/**
 * The menu's height without levels, its one height on a phone with them, and beside the effort
 * column.
 */
const MAX_HEIGHT = 420;
const EFFORT_HEIGHT = 344;

type ModelPickerPanelProps = {
  state: ModelPickerState;
  newThread?: boolean;
  /** The words for the row that clears the model: its title, optional agents and description. */
  defaults: DefaultWords;
  /** The height the menu may take, a CSS length. */
  room: string;
  /** Accessible dialog label; defaults to the thread model picker label. */
  ariaLabel?: string;
  /**
   * The menu sets a room setting, not a thread's model: its default row needs no catalog, so it
   * shows and counts as current without one, and writes while `canReset` whatever `canMutate`
   * says of the models; picking the current row writes it again; and an error names no thread
   * command.
   */
  roomSetting?: { canReset: boolean };
  usageSnapshot?: ProviderUsageSnapshot;
  usageAvailable?: boolean;
  onBeforeOpenUsage?: () => void;
  requestClose: () => void;
  onCommand: () => void;
};

const modelMatches = (model: ModelCatalogEntry, query: string): boolean =>
  `${model.display_name} ${model.key} ${model.provider} ${model.id}`
    .toLocaleLowerCase()
    .includes(query);

// JSON escapes lone UTF-16 surrogates before URI encoding and keeps distinct keys distinct.
const optionId = (listId: string, key: string): string =>
  `${listId}-${encodeURIComponent(JSON.stringify(key))}`;
type PickerItem = { kind: 'default' } | { kind: 'model'; model: ModelCatalogEntry };
const pickerItemId = (item: PickerItem): string =>
  item.kind === 'default' ? 'default-action' : `model:${item.model.key}`;

/**
 * The model the room's agents fall back to when they all use the same one, so the button can show
 * its provider; with none, or several, the button shows a generic mark.
 */
const sharedRoomDefault = (state: ModelPickerState): ModelCatalogEntry | undefined => {
  const keys = new Set(state.inherited.map(({ model }) => model));
  if (keys.size !== 1) return undefined;
  const [key] = keys;
  return state.models.find((model) => model.key === key);
};

/** Where the thread's default comes from: each agent's own model, the room's, or a mix or unknown. */
export type DefaultSource = 'agent' | 'room' | 'unknown';

/**
 * What the default row says: its source, each agent's model by name ("DevAgent · Opus", or
 * "DevAgent: Opus · Analyst: Sol"), empty before an agent names them, and whether `!room_model` set it.
 */
export const describeDefault = (
  inherited: ModelPickerState['inherited'],
  models: ModelPickerState['models'],
  nameOf: (entry: ModelInheritedEntry) => string
): { source: DefaultSource; agents: string; roomOverride: boolean } => {
  const labels = new Map(models.map((model) => [model.key, model.display_name]));
  const named = inherited.map((entry) => [nameOf(entry), labels.get(entry.model) ?? entry.model]);
  const kinds = new Set(
    inherited.map(({ source }) => (source === 'room_config' ? 'room' : source))
  );
  const [kind] = kinds;
  return {
    source: kinds.size === 1 && (kind === 'agent' || kind === 'room') ? kind : 'unknown',
    agents:
      named.length === 1 ? named[0]!.join(' · ') : named.map((pair) => pair.join(': ')).join(' · '),
    roomOverride: inherited.length > 0 && inherited.every(({ source }) => source === 'room'),
  };
};
type DefaultWords = { label: string; agents: string; description: string };
const DEFAULT_LABELS = {
  agent: 'agentDefault',
  room: 'roomModel',
  unknown: 'defaultChoice',
} as const;

/**
 * The model the thread runs on now, its own or else the one every agent falls back to, and the
 * reasoning level it runs it at; no level without such a model, or while the agents' levels differ.
 */
const currentChoice = (state: ModelPickerState) => {
  if (!state.runtime) return { model: undefined, level: undefined };
  const model =
    state.override === null
      ? sharedRoomDefault(state)
      : state.models.find(({ key }) => key === state.override);
  const named =
    state.override === null ? state.inherited.map(({ reasoning }) => reasoning) : [state.reasoning];
  const levels = new Set(named.map((level) => level ?? model?.reasoning_default));
  const [level] = levels;
  return { model, level: model && levels.size === 1 ? level : undefined };
};

function UsageFooterLink({
  onBeforeNavigate,
  requestClose,
}: {
  onBeforeNavigate?: () => void;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={css.UsageLink}
      onClick={() => {
        onBeforeNavigate?.();
        void navigate(getUsagePath());
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }}
    >
      {t('mindroomUi.usage.allUsageAndLimits')}
    </button>
  );
}

function ModelPickerPanel({
  state,
  newThread,
  defaults,
  room,
  ariaLabel,
  roomSetting,
  usageSnapshot,
  usageAvailable,
  onBeforeOpenUsage,
  requestClose,
  onCommand,
}: ModelPickerPanelProps) {
  const { t, i18n } = useTranslation();
  const inRouter = useInRouterContext();
  const stacked = useScreenSizeContext() === ScreenSize.Mobile;
  const checkedAtMs = usageSnapshot ? Date.parse(usageSnapshot.checked_at) : Number.NaN;
  const usageUpdated = Number.isFinite(checkedAtMs)
    ? formatRelativeTime(checkedAtMs, i18n?.resolvedLanguage ?? i18n?.language ?? 'en')
    : '';
  const columnRef = useRef<HTMLDivElement>(null);
  /** On a phone the levels show in place of the models, opened from the Effort row under them. */
  const [levelsShown, setLevelsShown] = useState(false);
  const entryRef = useRef<HTMLButtonElement>(null);
  /** Back from the levels, the keys return to the Effort row. */
  const backRef = useRef(false);
  /** The filter field or the list, whichever the keys left for the levels. */
  const columnOriginRef = useRef<HTMLElement>();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filterShown = state.models.length > FILTER_AFTER;
  // Discovery without models has no results or error to show until the wait ends.
  const waitingForCatalog = state.loading && state.models.length === 0;
  // A catalog that shrinks under the field (another runtime, a refresh) takes its filter with it.
  const normalizedQuery = filterShown ? query.trim().toLocaleLowerCase() : '';
  // Found by its own words, not by the names of the models it falls back to.
  const defaultVisible =
    (roomSetting || !waitingForCatalog) &&
    (!normalizedQuery ||
      `${defaults.label} ${defaults.description}`.toLocaleLowerCase().includes(normalizedQuery));
  const visibleModels = useMemo(
    () => state.models.filter((model) => modelMatches(model, normalizedQuery)),
    [state.models, normalizedQuery]
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    visibleModels.forEach((model) => {
      grouped.set(model.provider, [...(grouped.get(model.provider) ?? []), model]);
    });
    return [...grouped];
  }, [visibleModels]);
  const items = useMemo(
    () => [
      ...(defaultVisible ? ([{ kind: 'default' }] satisfies PickerItem[]) : []),
      ...groups.flatMap(([, models]) => models.map((model) => ({ kind: 'model' as const, model }))),
    ],
    [defaultVisible, groups]
  );
  const isCurrent = (item: PickerItem): boolean =>
    item.kind === 'default'
      ? state.override === null && (!!roomSetting || !!state.runtime)
      : !!state.runtime && state.override === item.model.key;
  // The highlight sits on the current choice, also once a late catalog lists it, until the user
  // moves it with the keys, the pointer or the filter.
  const [movedIndex, setMovedIndex] = useState<number>();
  const activeIndex = movedIndex ?? Math.max(items.findIndex(isCurrent), 0);
  const activeItem = items[activeIndex];
  const activeId = activeItem ? optionId(listId, pickerItemId(activeItem)) : undefined;
  const mutationsDisabled = !state.canMutate;
  const disabledItem = (item: PickerItem): boolean =>
    item.kind === 'default' && roomSetting ? !roomSetting.canReset : mutationsDisabled;
  // The levels of the model the thread runs on, beside the models, once any model has levels.
  // They never follow the highlight: a level is picked for the model the thread has.
  const columnShown = !!state.runtime && state.models.some((model) => model.reasoning_levels);
  const current = currentChoice(state);
  const levels = current.model?.reasoning_levels;
  // The view goes with the phone's layout, or with the levels of the model the thread runs on.
  const levelsOpen = levelsShown && stacked && !!levels;

  // A phone's keyboard would come up over the menu, so there the list takes focus, not the filter.
  useEffect(() => {
    (mobileOrTablet() ? listRef.current : inputRef.current ?? listRef.current)?.focus();
  }, []);

  // A control that goes while it has focus (the filter field, Retry, the runtime chooser) leaves
  // the keys to the list.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    // In the levels a focused level can go too, when the thread's model changes.
    (
      listRef.current ??
      columnRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
    )?.focus();
  });

  useEffect(() => {
    if (movedIndex === undefined || movedIndex < items.length) return;
    setMovedIndex(Math.max(items.length - 1, 0));
  }, [movedIndex, items.length]);

  // The list comes back from the levels at its top, so the highlight scrolls in again.
  useEffect(() => {
    document.getElementById(activeId ?? '')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, levelsShown]);

  // Opened, the levels take the keys on the checked one, else the default.
  useEffect(() => {
    if (levelsShown && !levelsOpen) {
      backRef.current = true;
      setLevelsShown(false);
    }
  }, [levelsShown, levelsOpen]);
  useEffect(() => {
    if (levelsShown) {
      columnRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    } else if (backRef.current) {
      backRef.current = false;
      entryRef.current?.focus();
    }
  }, [levelsShown]);

  const selectItem = (item: PickerItem) => {
    if (disabledItem(item)) return;
    // The current choice needs no command; choosing it again only closes the menu. A current model
    // at a named level goes back to its plain key, which runs it at its default.
    if (!roomSetting && isCurrent(item) && (item.kind === 'default' || state.reasoning === null)) {
      requestClose();
      return;
    }
    onCommand();
    if (item.kind === 'default') state.resetToRoomDefault();
    else state.selectModel(item.model.key);
  };

  const selectLevel = (level: ReasoningLevel) => {
    if (mutationsDisabled || !current.model) return;
    // The level the thread already runs at needs no command.
    if (level === current.level) {
      requestClose();
      return;
    }
    onCommand();
    state.selectModel(current.model.key, level);
  };

  // The keys come back to the control they left, the list when that one is gone.
  const leaveColumn = () => {
    const origin = columnOriginRef.current;
    (origin?.isConnected ? origin : listRef.current)?.focus();
  };
  const closeLevels = () => {
    backRef.current = true;
    setLevelsShown(false);
  };

  // The filter field or the list holds focus; the arrows move the highlight.
  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length) setMovedIndex((activeIndex + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) setMovedIndex((activeIndex - 1 + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      selectItem(activeItem);
      return;
    }
    // Right moves into the levels, onto the checked one, else the default; in the filter field
    // only from the end of its text.
    const field = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    if (
      event.key === 'ArrowRight' &&
      current.model?.reasoning_levels &&
      (!field || field.selectionStart === field.value.length)
    ) {
      event.preventDefault();
      if (stacked) {
        setLevelsShown(true);
        return;
      }
      columnOriginRef.current = event.currentTarget;
      columnRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    }
  };

  const handleQuery: ChangeEventHandler<HTMLInputElement> = (event) => {
    setQuery(event.currentTarget.value);
    setMovedIndex(0);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  const option = (item: PickerItem, index: number) => {
    const selected = isCurrent(item);
    return (
      // Keyboard activation belongs to the filter field or the list, which keeps DOM focus.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
      <div
        key={pickerItemId(item)}
        id={optionId(listId, pickerItemId(item))}
        role="option"
        aria-selected={selected}
        aria-disabled={disabledItem(item)}
        className={css.Option}
        data-active={index === activeIndex}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={() => setMovedIndex(index)}
        onClick={() => selectItem(item)}
      >
        <span className={css.OptionIcon} aria-hidden="true">
          {item.kind === 'default' ? (
            <IconRotateClockwise size={18} />
          ) : (
            <ModelIcon
              provider={item.model.provider}
              id={item.model.id}
              iconUrl={item.model.icon_url}
              size={18}
            />
          )}
        </span>
        <span className={css.OptionText}>
          <span className={css.OptionTitle}>
            {item.kind === 'default' ? defaults.label : item.model.display_name}
          </span>
          {item.kind === 'default' && defaults.agents && (
            <span className={css.RoomDefaultDetail}>{defaults.agents}</span>
          )}
          <span className={item.kind === 'default' ? css.RoomDefaultDetail : css.OptionDetail}>
            {item.kind === 'default' ? defaults.description : item.model.id}
          </span>
        </span>
        {selected && <IconCheck className={css.Check} size={16} aria-hidden="true" />}
      </div>
    );
  };

  const controls = filterShown || state.runtimes.length > 1 || state.loading || state.pending;

  // What the menu waits for and what went wrong, with Retry, shown over the models and the levels.
  const status = (
    <>
      {(state.loading || state.pending) && (
        <div className={css.StatusRow} role="status">
          <Spinner size="100" variant="Secondary" />
          {state.pending
            ? t('mindroomUi.models.modelPicker.pending')
            : t('mindroomUi.models.modelPicker.loading')}
        </div>
      )}

      {state.error && !waitingForCatalog && (
        <div className={css.Error} role="alert">
          <div>{state.error}</div>
          {!roomSetting && <div>{t('mindroomUi.models.modelPicker.commandFallback')}</div>}
          <div className={css.ErrorActions}>
            <button
              type="button"
              className={css.TextButton}
              aria-label={t('mindroomUi.models.modelPicker.retry')}
              onClick={state.refresh}
            >
              {t('mindroomUi.models.modelPicker.retry')}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const picker = (
    <>
      {(controls || state.error) && (
        <div className={css.Controls}>
          {filterShown && (
            <div className={css.SearchRow}>
              <IconSearch size={14} aria-hidden="true" className={css.SearchIcon} />
              <input
                ref={inputRef}
                className={css.SearchInput}
                role="searchbox"
                aria-label={t('mindroomUi.models.modelPicker.search')}
                placeholder={t('mindroomUi.models.modelPicker.search')}
                aria-controls={listId}
                aria-activedescendant={activeId}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={handleQuery}
                onKeyDown={handleKeyDown}
              />
            </div>
          )}

          {state.runtimes.length > 1 && (
            <div className={css.RuntimeRow}>
              <span className={css.RuntimeLabel}>{t('mindroomUi.models.modelPicker.runtime')}</span>
              <select
                className={css.RuntimeSelect}
                aria-label={t('mindroomUi.models.modelPicker.runtime')}
                value={state.runtime?.id ?? ''}
                onChange={(event) => state.chooseRuntime(event.currentTarget.value)}
              >
                {!state.runtime && (
                  <option value="" disabled>
                    {t('mindroomUi.models.modelPicker.chooseRuntime')}
                  </option>
                )}
                {state.runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>
                    {t('mindroomUi.models.modelPicker.runtimeLabel', {
                      userId: runtime.userId,
                      deviceId: runtime.deviceId,
                    })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {status}
        </div>
      )}

      {/* The rows scroll inside the menu's rim, which stays put around them. */}
      <Scroll
        ref={resultsRef}
        size="300"
        hideTrack
        visibility="Hover"
        style={{ overflowY: 'auto' }}
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('mindroomUi.models.modelPicker.models')}
          // The list takes the keys when it has focus: with no filter field, or on a phone.
          tabIndex={0}
          aria-activedescendant={activeId}
          onKeyDown={handleKeyDown}
          className={css.Results}
        >
          {defaultVisible && option({ kind: 'default' }, 0)}

          {groups.map(([provider, models]) => {
            const account = usageSnapshot
              ? singleAccountForModels(
                  usageSnapshot.accounts,
                  models.map((model) => model.key)
                )
              : undefined;
            const quotaId =
              account && account.windows.length > 0
                ? optionId(listId, `quota:${provider}`)
                : undefined;
            return (
              <div
                key={provider}
                className={css.Group}
                role="group"
                aria-label={provider}
                aria-describedby={quotaId}
              >
                <div className={css.GroupHeader}>
                  <span className={css.GroupTitle} aria-hidden="true">
                    {provider}
                  </span>
                  {account && account.windows.length > 0 && (
                    <InlineQuotaSummary id={quotaId} account={account} />
                  )}
                </div>
                {models.map((model) =>
                  option(
                    { kind: 'model', model },
                    items.findIndex((item) => item.kind === 'model' && item.model.key === model.key)
                  )
                )}
              </div>
            );
          })}

          {!waitingForCatalog && items.length === 0 && (
            <div className={css.Empty}>{t('mindroomUi.models.modelPicker.noResults')}</div>
          )}
        </div>
      </Scroll>
      {usageAvailable && inRouter && !roomSetting && (
        <div className={css.UsageFooter} data-usage-footer="">
          {usageUpdated && (
            <span className={css.UsageUpdated}>
              {t('mindroomUi.usage.updatedAgo', { time: usageUpdated })}
            </span>
          )}
          <UsageFooterLink onBeforeNavigate={onBeforeOpenUsage} requestClose={requestClose} />
        </div>
      )}
    </>
  );

  const effort = (mode: 'column' | 'view') => (
    <ModelEffortColumn
      model={current.model}
      active={current.level}
      modelName={current.model?.display_name ?? state.override ?? defaults.label}
      disabled={mutationsDisabled}
      columnRef={columnRef}
      onPick={selectLevel}
      mode={mode}
      onLeave={mode === 'view' ? closeLevels : leaveColumn}
    />
  );
  // On a phone the levels take the models' place, opened from a row pinned under them; a model
  // without levels has no row, so it opens nothing.
  const panes = columnShown && (
    <>
      <div className={css.Picker}>{picker}</div>
      {!stacked && effort('column')}
      {stacked && levels && (
        <ModelEffortEntry
          levels={levels}
          active={current.level}
          entryRef={entryRef}
          onOpen={() => setLevelsShown(true)}
        />
      )}
    </>
  );
  // With levels the menu has one height, so a model with more levels never resizes it, and the
  // levels on a phone fill the models' box.
  const limit = toRem(stacked ? MAX_HEIGHT : EFFORT_HEIGHT);
  return (
    <Menu
      role="dialog"
      aria-label={
        ariaLabel ??
        t(
          newThread
            ? 'mindroomUi.models.modelPicker.chooseNextThread'
            : 'mindroomUi.models.modelPicker.modelForThread'
        )
      }
      className={panes && !stacked ? css.EffortPanel : css.Panel}
      style={
        panes
          ? { height: `min(${limit}, ${room})` }
          : { maxHeight: `min(${toRem(MAX_HEIGHT)}, ${room})` }
      }
    >
      {panes && levelsOpen ? (
        <>
          {effort('view')}
          {(state.loading || state.pending || state.error) && (
            // Retry here sits outside the levels' keys, so it takes the same way back.
            <div
              className={`${css.Controls} ${css.ViewStatus}`}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeLevels();
              }}
            >
              {status}
            </div>
          )}
        </>
      ) : (
        panes || picker
      )}
    </Menu>
  );
}

export function TrappedModelPickerPanel(props: ModelPickerPanelProps) {
  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        onDeactivate: props.requestClose,
        returnFocusOnDeactivate: true,
      }}
    >
      <div>
        <ModelPickerPanel {...props} />
      </div>
    </FocusTrap>
  );
}

/**
 * The composer's model button: the logo of the model's provider, and a compact menu of the
 * catalog above it, on phones too.
 */
export function ModelPicker({
  state,
  newThread = false,
  room: membersRoom,
  conversationHidden,
}: {
  state: ModelPickerState;
  newThread?: boolean;
  /** The room whose members name the agents; without it, agents go by their entity names. */
  room?: Room;
  /** The conversation it is in is hidden (a cover over it, a side panel in its place): it closes. */
  conversationHidden?: boolean;
}) {
  const { t } = useTranslation();
  const usage = useRuntimeProviderUsage(membersRoom?.roomId, state.runtime);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const triggerId = useId();
  const triggerLabelId = useId();
  const commandStartedRef = useRef(false);
  const sawPendingRef = useRef(false);
  const selectedModel = state.models.find((model) => model.key === state.override);
  const { model: shownModel, level: active } = currentChoice(state);
  const described = describeDefault(
    state.inherited,
    state.models,
    // The runtime names each entity's account; without it, or before its member loads, the entity.
    ({ entity, user_id: userId }) => (userId && membersRoom?.getMember(userId)?.name) || entity
  );
  const defaults: DefaultWords = {
    label: t(`mindroomUi.models.modelPicker.${DEFAULT_LABELS[described.source]}`),
    agents: described.agents,
    description: newThread
      ? t('mindroomUi.models.modelPicker.nextThreadOnly')
      : described.roomOverride
      ? t('mindroomUi.models.modelPicker.roomOverrideThreadOnly')
      : t('mindroomUi.models.modelPicker.threadOnly'),
  };
  // Without an override the button names what each agent runs, as the default row in the menu does.
  const modelLabel =
    selectedModel?.display_name ??
    state.override ??
    (defaults.agents
      ? t('mindroomUi.models.modelPicker.roomDefaultWith', {
          label: defaults.label,
          models: defaults.agents,
        })
      : defaults.label);
  // A model with levels names the level it runs at too, and shows it as bars after its logo.
  const levels = shownModel?.reasoning_levels;
  const bars = levels && active ? effortBars(levels, active) : undefined;
  const modelAndLevel = active
    ? t('mindroomUi.models.modelPicker.withLevel', {
        model: modelLabel,
        level: t(`mindroomUi.models.modelPicker.levels.${active}`),
      })
    : modelLabel;
  const label = state.runtime ? modelAndLevel : undefined;
  const chooseModel = t(
    newThread
      ? 'mindroomUi.models.modelPicker.chooseNextThread'
      : 'mindroomUi.models.modelPicker.chooseModel'
  );

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  if (conversationHidden && open) setOpen(false);

  // The page can change size under an open menu: the window resizes, or a phone's keyboard comes
  // up and useMobileKeyboardViewportFix shortens #root a frame later. Once the page has its new
  // size the button is measured again, so the menu stays above it.
  const [, remeasure] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!open || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(document.getElementById('root') ?? document.body);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open || !commandStartedRef.current) return;
    if (state.pending) {
      sawPendingRef.current = true;
      return;
    }
    if (!sawPendingRef.current) return;
    commandStartedRef.current = false;
    sawPendingRef.current = false;
    if (!state.error) close();
  }, [open, state.pending, state.error]);

  // A command of an earlier opening, which may have been closed while it waited, counts no more.
  const openPicker = () => {
    commandStartedRef.current = false;
    sawPendingRef.current = false;
    setOpen(true);
    state.refresh();
    usage.ensureLoaded();
  };

  const anchor = open ? triggerRef.current?.getBoundingClientRect() : undefined;
  // The room above the button, less a phone's status bar: folds puts a pop-out that does not fit
  // above beside the button instead.
  const room = anchor
    ? `calc(${
        anchor.y - POP_OUT_OFFSET
      }px - var(--app-inset-top, env(safe-area-inset-top, 0px)) - ${config.space.S200})`
    : '';

  return (
    <PopOut
      anchor={anchor}
      offset={POP_OUT_OFFSET}
      position="Top"
      align="Start"
      content={
        anchor ? (
          <TrappedModelPickerPanel
            state={state}
            newThread={newThread}
            defaults={defaults}
            room={room}
            usageSnapshot={usage.snapshot}
            usageAvailable={usage.available}
            onBeforeOpenUsage={() => setOpen(false)}
            requestClose={close}
            onCommand={() => {
              if (newThread) close();
              else commandStartedRef.current = true;
            }}
          />
        ) : undefined
      }
    >
      <IconTooltip position="Top" label={chooseModel} hint={label}>
        {(tooltipRef) => (
          <IconButton
            ref={(element: HTMLButtonElement | null) => {
              triggerRef.current = element;
              tooltipRef(element);
            }}
            type="button"
            id={triggerId}
            variant="SurfaceVariant"
            radii="300"
            size="300"
            className={`${css.Trigger} ${glassExpanded}`}
            // Named "Choose model" and then the model it stands for, as its tooltip reads.
            aria-label={chooseModel}
            aria-labelledby={label ? `${triggerId} ${triggerLabelId}` : undefined}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-effort={bars && bars.count > 0 ? true : undefined}
            onClick={openPicker}
          >
            <ModelIcon
              provider={shownModel?.provider}
              id={shownModel?.id}
              iconUrl={shownModel?.icon_url}
              size={20}
            />
            {bars && bars.count > 0 && <EffortGlyph count={bars.count} filled={bars.filled} />}
            <span id={triggerLabelId} className={css.VisuallyHidden}>
              {label}
            </span>
          </IconButton>
        )}
      </IconTooltip>
    </PopOut>
  );
}

type ThreadModelPickerProps = {
  room: Room;
  threadId?: string;
  newThread?: boolean;
  conversationHidden?: boolean;
};

function ScopedModelPicker({ room, threadId, conversationHidden }: ThreadModelPickerProps) {
  const state = useModelPicker(room, threadId);
  if (!state.eligible) return null;

  return (
    <>
      <ModelPicker
        state={state}
        room={room}
        newThread={!threadId}
        conversationHidden={conversationHidden}
      />
      <span className={css.TriggerDivider} aria-hidden="true" />
    </>
  );
}

/** An existing thread's model, or a local pick for the next thread the composer starts. */
export function ThreadModelPicker(props: ThreadModelPickerProps) {
  if (!props.threadId && !props.newThread) return null;
  return <ScopedModelPicker key={props.threadId ?? props.room.roomId} {...props} />;
}
