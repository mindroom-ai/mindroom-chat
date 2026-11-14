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

import { mobileOrTablet } from '../lib/user-agent';
import { Menu } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import type { ModelCatalogEntry } from './modelProtocol';
import { ModelIcon } from './ModelIcon';
import { useModelPicker, type ModelPickerState } from './useModelPicker';
import * as css from './ModelPicker.css';

/** A catalog longer than this gets a field above its models that filters them. */
const FILTER_AFTER = 8;
/** The gap between the menu and its button. */
const POP_OUT_OFFSET = 8;

type ModelPickerPanelProps = {
  state: ModelPickerState;
  maxHeight: string;
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

function ModelPickerPanel({ state, maxHeight, requestClose, onCommand }: ModelPickerPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filterShown = state.models.length > FILTER_AFTER;
  // A catalog that shrinks under the field (another runtime, a refresh) takes its filter with it.
  const normalizedQuery = filterShown ? query.trim().toLocaleLowerCase() : '';
  // What "Room default" means here: each agent's own model, by name, once the router says.
  const defaultDetail = useMemo(() => {
    if (state.inherited.length === 0) {
      return t('mindroomUi.models.modelPicker.roomDefaultDescription');
    }
    const labels = new Map(state.models.map((model) => [model.key, model.display_name]));
    return state.inherited
      .map(({ entity, model }) => `${entity}: ${labels.get(model) ?? model}`)
      .join(', ');
  }, [state.inherited, state.models, t]);
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
    // The current choice needs no command; choosing it again only closes the menu.
    if (isCurrent(item)) {
      requestClose();
      return;
    }
    onCommand();
    if (item.kind === 'default') state.resetToRoomDefault();
    else state.selectModel(item.model.key);
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

  return (
    <Menu
      role="dialog"
      aria-label={t('mindroomUi.models.modelPicker.modelForThread')}
      className={css.Panel}
      style={{ maxHeight }}
    >
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
  const shownModel = state.override === null ? sharedRoomDefault(state) : selectedModel;
  const label =
    selectedModel?.display_name ?? state.override ?? t('mindroomUi.models.modelPicker.roomDefault');
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
  // As tall as the room above the button allows, less a phone's status bar: folds puts a pop-out
  // that does not fit above beside the button instead.
  const maxHeight = anchor
    ? `min(${toRem(420)}, calc(${anchor.y - POP_OUT_OFFSET}px - env(safe-area-inset-top, 0px) - ${
        config.space.S200
      }))`
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
            maxHeight={maxHeight}
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
          <button
            ref={(element: HTMLButtonElement | null) => {
              triggerRef.current = element;
              tooltipRef(element);
            }}
            type="button"
            id={triggerId}
            className={css.Trigger}
            // Named "Choose model" and then the model it stands for, as its tooltip reads.
            aria-label={chooseModel}
            aria-labelledby={`${triggerId} ${triggerLabelId}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={openPicker}
          >
            <ModelIcon
              provider={shownModel?.provider}
              id={shownModel?.id}
              iconUrl={shownModel?.icon_url}
              size={18}
              className={css.TriggerIcon}
            />
            <span id={triggerLabelId} className={css.VisuallyHidden}>
              {label}
            </span>
          </button>
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
