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

import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { mobileOrTablet } from '../lib/user-agent';
import { IconButton, Menu } from '../ui/glass/GlassPrimitives';
import { glassExpanded } from '../ui/styles/Glass.css';
import { IconTooltip } from '../ui/IconTooltip';
import { EffortGlyph, effortBars } from './EffortGlyph';
import { ModelEffortColumn } from './ModelEffortColumn';
import type { ModelCatalogEntry, ReasoningLevel } from './modelProtocol';
import { ModelIcon } from './ModelIcon';
import { useModelPicker, type ModelPickerState } from './useModelPicker';
import * as css from './ModelPicker.css';

/** A catalog longer than this gets a field above its models that filters them. */
const FILTER_AFTER = 8;
/** The gap between the menu and its button. */
const POP_OUT_OFFSET = 8;
/** The menu's height without the effort column, and its one height beside or above it. */
const MAX_HEIGHT = 420;
const EFFORT_HEIGHT = 344;
const STACKED_EFFORT_HEIGHT = 560;

type ModelPickerPanelProps = {
  state: ModelPickerState;
  /** The height above the button the menu may take, a CSS length. */
  room: string;
  requestClose: () => void;
  onCommand: () => void;
};

const modelMatches = (model: ModelCatalogEntry, query: string): boolean =>
  `${model.display_name} ${model.key} ${model.provider} ${model.id}`
    .toLocaleLowerCase()
    .includes(query);

const optionId = (listId: string, key: string): string => `${listId}-${encodeURIComponent(key)}`;
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

/** Each agent's fallback model by name, "entity: Model, …"; empty before the router names them. */
const agentModels = (
  inherited: ModelPickerState['inherited'],
  models: ModelPickerState['models']
): string => {
  const labels = new Map(models.map((model) => [model.key, model.display_name]));
  return inherited
    .map(({ entity, model }) => `${entity}: ${labels.get(model) ?? model}`)
    .join(', ');
};

/**
 * The model the thread runs on now, its own or else the one every agent falls back to, and the
 * reasoning level it runs it at; no level without such a model, or while the agents' levels differ.
 */
const currentChoice = (state: ModelPickerState) => {
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

function ModelPickerPanel({ state, room, requestClose, onCommand }: ModelPickerPanelProps) {
  const { t } = useTranslation();
  const stacked = useScreenSizeContext() === ScreenSize.Mobile;
  const columnRef = useRef<HTMLDivElement>(null);
  /** The filter field or the list, whichever the keys left for the levels. */
  const columnOriginRef = useRef<HTMLElement>();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filterShown = state.models.length > FILTER_AFTER;
  // A catalog that shrinks under the field (another runtime, a refresh) takes its filter with it.
  const normalizedQuery = filterShown ? query.trim().toLocaleLowerCase() : '';
  // What "Room default" means here: each agent's own model, by name, once the router says.
  const defaultDetail = useMemo(
    () =>
      agentModels(state.inherited, state.models) ||
      t('mindroomUi.models.modelPicker.roomDefaultDescription'),
    [state.inherited, state.models, t]
  );
  // Found by its own words, not by the names of the models it falls back to.
  const defaultVisible =
    !normalizedQuery ||
    `${t('mindroomUi.models.modelPicker.roomDefault')} ${t(
      'mindroomUi.models.modelPicker.roomDefaultDescription'
    )}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
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
    item.kind === 'default' ? state.override === null : state.override === item.model.key;
  // The highlight sits on the current choice, also once a late catalog lists it, until the user
  // moves it with the keys, the pointer or the filter.
  const [movedIndex, setMovedIndex] = useState<number>();
  const activeIndex = movedIndex ?? Math.max(items.findIndex(isCurrent), 0);
  const activeItem = items[activeIndex];
  const activeId = activeItem ? optionId(listId, pickerItemId(activeItem)) : undefined;
  const mutationsDisabled = !state.canMutate;
  // The levels of the model the thread runs on, beside the models, once any model has levels.
  // They never follow the highlight: a level is picked for the model the thread has.
  const columnShown = state.models.some((model) => model.reasoning_levels);
  const current = currentChoice(state);

  // A phone's keyboard would come up over the menu, so there the list takes focus, not the filter.
  useEffect(() => {
    (mobileOrTablet() ? listRef.current : inputRef.current ?? listRef.current)?.focus();
  }, []);

  // A control that goes while it has focus (the filter field, Retry, the runtime chooser) leaves
  // the keys to the list.
  useEffect(() => {
    if (document.activeElement === document.body) listRef.current?.focus();
  });

  useEffect(() => {
    if (movedIndex === undefined || movedIndex < items.length) return;
    setMovedIndex(Math.max(items.length - 1, 0));
  }, [movedIndex, items.length]);

  useEffect(() => {
    document.getElementById(activeId ?? '')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const selectItem = (item: PickerItem) => {
    if (mutationsDisabled) return;
    // The current choice needs no command; choosing it again only closes the menu. A current model
    // at a named level goes back to its plain key, which runs it at its default.
    if (isCurrent(item) && (item.kind === 'default' || state.reasoning === null)) {
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
        aria-disabled={mutationsDisabled}
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
            {item.kind === 'default'
              ? t('mindroomUi.models.modelPicker.roomDefault')
              : item.model.display_name}
          </span>
          <span className={item.kind === 'default' ? css.RoomDefaultDetail : css.OptionDetail}>
            {item.kind === 'default' ? defaultDetail : item.model.id}
          </span>
        </span>
        {selected && <IconCheck className={css.Check} size={16} aria-hidden="true" />}
      </div>
    );
  };

  const controls = filterShown || state.runtimes.length > 1 || state.loading || state.pending;

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

          {(state.loading || state.pending) && (
            <div className={css.StatusRow} role="status">
              <Spinner size="100" variant="Secondary" />
              {state.pending
                ? t('mindroomUi.models.modelPicker.pending')
                : t('mindroomUi.models.modelPicker.loading')}
            </div>
          )}

          {state.error && (
            <div className={css.Error} role="alert">
              <div>{state.error}</div>
              <div>{t('mindroomUi.models.modelPicker.commandFallback')}</div>
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
        </div>
      )}

      {/* The rows scroll inside the menu's rim, which stays put around them. */}
      <Scroll
        ref={resultsRef}
        className={css.Rows}
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

          {groups.map(([provider, models]) => (
            <div key={provider} className={css.Group} role="group" aria-label={provider}>
              <div className={css.GroupTitle} aria-hidden="true">
                {provider}
              </div>
              {models.map((model) =>
                option(
                  { kind: 'model', model },
                  items.findIndex((item) => item.kind === 'model' && item.model.key === model.key)
                )
              )}
            </div>
          ))}

          {items.length === 0 && (
            <div className={css.Empty}>{t('mindroomUi.models.modelPicker.noResults')}</div>
          )}
        </div>
      </Scroll>
    </>
  );

  const panes = columnShown && (
    <>
      <div className={css.Picker}>{picker}</div>
      <ModelEffortColumn
        model={current.model}
        active={current.level}
        modelName={
          current.model?.display_name ??
          state.override ??
          t('mindroomUi.models.modelPicker.roomDefault')
        }
        disabled={mutationsDisabled}
        columnRef={columnRef}
        onPick={selectLevel}
        onLeave={leaveColumn}
      />
    </>
  );
  // With the column the menu has one height, so a model with more levels never resizes it; on a
  // phone the levels sit under the models.
  const limit = toRem(stacked ? STACKED_EFFORT_HEIGHT : EFFORT_HEIGHT);
  return (
    <Menu
      role="dialog"
      aria-label={t('mindroomUi.models.modelPicker.modelForThread')}
      className={panes && !stacked ? css.EffortPanel : css.Panel}
      style={
        panes
          ? { height: `min(${limit}, ${room})` }
          : { maxHeight: `min(${toRem(MAX_HEIGHT)}, ${room})` }
      }
    >
      {panes && stacked ? <div className={css.StackedScroll}>{panes}</div> : panes || picker}
    </Menu>
  );
}

function TrappedPanel(props: ModelPickerPanelProps) {
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
  conversationHidden,
}: {
  state: ModelPickerState;
  /** The conversation it is in is hidden (a cover over it, a side panel in its place): it closes. */
  conversationHidden?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const triggerId = useId();
  const triggerLabelId = useId();
  const commandStartedRef = useRef(false);
  const sawPendingRef = useRef(false);
  const selectedModel = state.models.find((model) => model.key === state.override);
  const { model: shownModel, level: active } = currentChoice(state);
  const roomDefault = t('mindroomUi.models.modelPicker.roomDefault');
  const agents = agentModels(state.inherited, state.models);
  // Without an override the button names what each agent runs, as Room default in the menu does.
  const modelLabel =
    selectedModel?.display_name ??
    state.override ??
    (agents
      ? t('mindroomUi.models.modelPicker.roomDefaultWith', { label: roomDefault, models: agents })
      : roomDefault);
  // A model with levels names the level it runs at too, and shows it as bars after its logo.
  const levels = shownModel?.reasoning_levels;
  const bars = levels && active ? effortBars(levels, active) : undefined;
  const label = active
    ? t('mindroomUi.models.modelPicker.withLevel', {
        model: modelLabel,
        level: t(`mindroomUi.models.modelPicker.levels.${active}`),
      })
    : modelLabel;
  const chooseModel = t('mindroomUi.models.modelPicker.chooseModel');

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
  };

  const anchor = open ? triggerRef.current?.getBoundingClientRect() : undefined;
  // The room above the button, less a phone's status bar: folds puts a pop-out that does not fit
  // above beside the button instead.
  const room = anchor
    ? `calc(${anchor.y - POP_OUT_OFFSET}px - env(safe-area-inset-top, 0px) - ${config.space.S200})`
    : '';

  return (
    <PopOut
      anchor={anchor}
      offset={POP_OUT_OFFSET}
      position="Top"
      align="Start"
      content={
        anchor ? (
          <TrappedPanel
            state={state}
            room={room}
            requestClose={close}
            onCommand={() => {
              commandStartedRef.current = true;
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
            aria-labelledby={`${triggerId} ${triggerLabelId}`}
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

type ThreadModelPickerProps = { room: Room; conversationHidden?: boolean };

function ExistingThreadModelPicker({
  room,
  threadId,
  conversationHidden,
}: ThreadModelPickerProps & { threadId: string }) {
  const state = useModelPicker(room, threadId);
  if (!state.eligible) return null;

  return (
    <>
      <ModelPicker state={state} conversationHidden={conversationHidden} />
      <span className={css.TriggerDivider} aria-hidden="true" />
    </>
  );
}

/** The thread's model button at the start of the composer, in a thread an agent answers in. */
export function ThreadModelPicker({
  threadId,
  ...props
}: ThreadModelPickerProps & { threadId?: string }) {
  if (!threadId) return null;
  return <ExistingThreadModelPicker threadId={threadId} {...props} />;
}
