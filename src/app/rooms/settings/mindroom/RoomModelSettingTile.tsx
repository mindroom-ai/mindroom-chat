import {
  ChangeEventHandler,
  KeyboardEventHandler,
  MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  Icons,
  Scroll,
  Spinner,
  Text,
  color,
  toRem,
  type RectCords,
} from 'folds';
import { IconCheck, IconRotateClockwise, IconSearch } from '@tabler/icons-react';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { ScreenSize, useScreenSizeContext } from '../../../lib/hooks/useScreenSize';
import { mobileOrTablet } from '../../../lib/user-agent';
import { ModelEffortColumn, ModelEffortEntry } from '../../../models/ModelEffortColumn';
import { ModelIcon } from '../../../models/ModelIcon';
import * as pickerCss from '../../../models/ModelPicker.css';
import {
  splitModelReference,
  type ModelCatalogEntry,
  type ReasoningLevel,
} from '../../../models/modelProtocol';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { PopOut } from '../../../ui/directional';
import { Menu } from '../../../ui/glass/GlassPrimitives';
import { SettingTile } from '../../../ui/SettingTile';
import type { RoomModelSettingDefinition } from './roomSettingDefinitions';
import * as tileCss from './RoomModelSettingTile.css';
import * as textCss from './RoomTextSettingTile.css';
import { useRoomSetting } from './useRoomSetting';

const STRINGS = 'featureUi.roomSettings.mindroom';
const PICKER_STRINGS = 'mindroomUi.models.modelPicker';

const FILTER_AFTER = 8;
const MAX_HEIGHT = 420;
const EFFORT_HEIGHT = 344;

type StoredModelState =
  | { kind: 'default' }
  | { kind: 'known'; model: ModelCatalogEntry; level?: ReasoningLevel }
  | { kind: 'unknown'; raw: string }
  | { kind: 'raw'; raw: string };

type PickerItem = { kind: 'default' } | { kind: 'model'; model: ModelCatalogEntry };

const pickerItemId = (item: PickerItem): string =>
  item.kind === 'default' ? 'default-action' : `model:${item.model.key}`;

const optionId = (listId: string, key: string): string =>
  `${listId}-${encodeURIComponent(JSON.stringify(key))}`;

const modelMatches = (model: ModelCatalogEntry, query: string): boolean =>
  `${model.display_name} ${model.key} ${model.provider} ${model.id}`
    .toLocaleLowerCase()
    .includes(query);

const classifyStoredModel = (
  value: string,
  models: readonly ModelCatalogEntry[],
  hasCatalog: boolean
): StoredModelState => {
  if (value === '') return { kind: 'default' };
  if (!hasCatalog) return { kind: 'raw', raw: value };
  const { key, level } = splitModelReference(value);
  const model = models.find((entry) => entry.key === key);
  if (!model) return { kind: 'unknown', raw: value };
  if (level !== undefined) {
    if (!model.reasoning_levels?.includes(level as ReasoningLevel)) {
      return { kind: 'unknown', raw: value };
    }
    return { kind: 'known', model, level: level as ReasoningLevel };
  }
  return { kind: 'known', model };
};

type RoomModelMenuProps = {
  label: string;
  catalog: ModelPickerState;
  stored: StoredModelState;
  allowReasoningLevels: boolean;
  disabled: boolean;
  onChoose: (next: string) => void;
  requestClose: () => void;
};

function RoomModelMenu({
  label,
  catalog,
  stored,
  allowReasoningLevels,
  disabled,
  onChoose,
  requestClose,
}: RoomModelMenuProps) {
  const { t } = useTranslation();
  const stacked = useScreenSizeContext() === ScreenSize.Mobile;
  const columnRef = useRef<HTMLDivElement>(null);
  const [levelsShown, setLevelsShown] = useState(false);
  const entryRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef(false);
  const columnOriginRef = useRef<HTMLElement>();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const defaultLabel = t(`${STRINGS}.model.default`);
  const defaultDescription = t(`${STRINGS}.model.defaultDescription`);
  const filterShown = catalog.models.length > FILTER_AFTER;
  const normalizedQuery = filterShown ? query.trim().toLocaleLowerCase() : '';
  const defaultVisible =
    !normalizedQuery ||
    `${defaultLabel} ${defaultDescription}`.toLocaleLowerCase().includes(normalizedQuery);

  const visibleModels = useMemo(
    () => catalog.models.filter((model) => modelMatches(model, normalizedQuery)),
    [catalog.models, normalizedQuery]
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
      ? stored.kind === 'default'
      : stored.kind === 'known' && stored.model.key === item.model.key;

  const [movedIndex, setMovedIndex] = useState<number>();
  const activeIndex = movedIndex ?? Math.max(items.findIndex(isCurrent), 0);
  const activeItem = items[activeIndex];
  const activeId = activeItem ? optionId(listId, pickerItemId(activeItem)) : undefined;

  const activeModel = stored.kind === 'known' ? stored.model : undefined;
  const activeLevel =
    stored.kind === 'known' ? stored.level ?? stored.model.reasoning_default : undefined;
  const columnShown =
    allowReasoningLevels && catalog.models.some((model) => Boolean(model.reasoning_levels));
  const levels = allowReasoningLevels ? activeModel?.reasoning_levels : undefined;
  const levelsOpen = levelsShown && stacked && Boolean(levels);

  useEffect(() => {
    (mobileOrTablet() ? listRef.current : inputRef.current ?? listRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (document.activeElement !== document.body) return;
    (
      listRef.current ??
      columnRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
    )?.focus();
  });

  useEffect(() => {
    if (movedIndex === undefined || movedIndex < items.length) return;
    setMovedIndex(Math.max(items.length - 1, 0));
  }, [movedIndex, items.length]);

  useEffect(() => {
    document.getElementById(activeId ?? '')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, levelsShown]);

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
    if (disabled) return;
    onChoose(item.kind === 'default' ? '' : item.model.key);
  };

  const selectLevel = (level: ReasoningLevel) => {
    if (disabled || !activeModel) return;
    onChoose(`${activeModel.key}@${level}`);
  };

  const leaveColumn = () => {
    const origin = columnOriginRef.current;
    (origin?.isConnected ? origin : listRef.current)?.focus();
  };

  const closeLevels = () => {
    backRef.current = true;
    setLevelsShown(false);
  };

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
    const field = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    if (
      event.key === 'ArrowRight' &&
      levels &&
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
        aria-disabled={disabled}
        className={pickerCss.Option}
        data-active={index === activeIndex}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={() => setMovedIndex(index)}
        onClick={() => selectItem(item)}
      >
        <span className={pickerCss.OptionIcon} aria-hidden="true">
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
        <span className={pickerCss.OptionText}>
          <span className={pickerCss.OptionTitle}>
            {item.kind === 'default' ? defaultLabel : item.model.display_name}
          </span>
          <span
            className={
              item.kind === 'default' ? pickerCss.RoomDefaultDetail : pickerCss.OptionDetail
            }
          >
            {item.kind === 'default' ? defaultDescription : item.model.id}
          </span>
        </span>
        {selected && <IconCheck className={pickerCss.Check} size={16} aria-hidden="true" />}
      </div>
    );
  };

  const catalogUnavailable =
    !catalog.loading && catalog.models.length === 0 && catalog.runtimes.length === 0;
  const controls =
    filterShown || catalog.runtimes.length > 1 || catalog.loading || catalogUnavailable;

  const picker = (
    <>
      {controls && (
        <div className={pickerCss.Controls}>
          {filterShown && (
            <div className={pickerCss.SearchRow}>
              <IconSearch size={14} aria-hidden="true" className={pickerCss.SearchIcon} />
              <input
                ref={inputRef}
                className={pickerCss.SearchInput}
                role="searchbox"
                aria-label={t(`${PICKER_STRINGS}.search`)}
                placeholder={t(`${PICKER_STRINGS}.search`)}
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

          {catalog.runtimes.length > 1 && (
            <div className={pickerCss.RuntimeRow}>
              <span className={pickerCss.RuntimeLabel}>{t(`${PICKER_STRINGS}.runtime`)}</span>
              <select
                className={pickerCss.RuntimeSelect}
                aria-label={t(`${PICKER_STRINGS}.runtime`)}
                value={catalog.runtime?.id ?? ''}
                onChange={(event) => catalog.chooseRuntime(event.currentTarget.value)}
              >
                {!catalog.runtime && (
                  <option value="" disabled>
                    {t(`${PICKER_STRINGS}.chooseRuntime`)}
                  </option>
                )}
                {catalog.runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>
                    {t(`${PICKER_STRINGS}.runtimeLabel`, {
                      userId: runtime.userId,
                      deviceId: runtime.deviceId,
                    })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {catalog.loading && (
            <div className={pickerCss.StatusRow} role="status">
              <Spinner size="100" variant="Secondary" />
              {t(`${PICKER_STRINGS}.loading`)}
            </div>
          )}

          {catalogUnavailable && (
            <div className={tileCss.Unavailable} role="status">
              <div>{t(`${STRINGS}.model.catalogUnavailable`)}</div>
              <div className={pickerCss.ErrorActions}>
                <button type="button" className={tileCss.RetryButton} onClick={catalog.refresh}>
                  {t(`${PICKER_STRINGS}.retry`)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
          aria-label={label}
          tabIndex={0}
          aria-activedescendant={activeId}
          onKeyDown={handleKeyDown}
          className={pickerCss.Results}
        >
          {defaultVisible && option({ kind: 'default' }, 0)}

          {groups.map(([provider, models]) => (
            <div key={provider} className={pickerCss.Group} role="group" aria-label={provider}>
              <div className={pickerCss.GroupTitle} aria-hidden="true">
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
            <div className={pickerCss.Empty}>{t(`${PICKER_STRINGS}.noResults`)}</div>
          )}
        </div>
      </Scroll>
    </>
  );

  const effortModelName =
    activeModel?.display_name ??
    (stored.kind === 'unknown' || stored.kind === 'raw' ? stored.raw : defaultLabel);

  const effort = (mode: 'column' | 'view') => (
    <ModelEffortColumn
      model={activeModel}
      active={activeLevel}
      modelName={effortModelName}
      disabled={disabled}
      columnRef={columnRef}
      onPick={selectLevel}
      mode={mode}
      onLeave={mode === 'view' ? closeLevels : leaveColumn}
    />
  );

  const panes = columnShown && (
    <>
      <div className={pickerCss.Picker}>{picker}</div>
      {!stacked && effort('column')}
      {stacked && levels && (
        <ModelEffortEntry
          levels={levels}
          active={activeLevel}
          entryRef={entryRef}
          onOpen={() => setLevelsShown(true)}
        />
      )}
    </>
  );

  const limit = toRem(stacked ? MAX_HEIGHT : EFFORT_HEIGHT);

  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        onDeactivate: requestClose,
        returnFocusOnDeactivate: true,
      }}
    >
      <div>
        <Menu
          role="dialog"
          aria-label={label}
          className={panes && !stacked ? pickerCss.EffortPanel : pickerCss.Panel}
          style={
            panes
              ? { height: `min(${limit}, 50vh)` }
              : { maxHeight: `min(${toRem(MAX_HEIGHT)}, 50vh)` }
          }
        >
          {panes && levelsOpen ? effort('view') : panes || picker}
        </Menu>
      </div>
    </FocusTrap>
  );
}

/**
 * A room setting holding a model reference (`key` or `key@level`), populated from the room's model
 * catalog and written to `io.mindroom.room_settings` via `useRoomSetting`. Shows unknown or
 * catalog-less values as raw text and always lets editors reset to the configured default.
 */
export function RoomModelSettingTile({
  room,
  definition,
  catalog,
}: {
  room: Room;
  definition: RoomModelSettingDefinition;
  catalog: ModelPickerState;
}) {
  const { t } = useTranslation();
  const { canEdit, value, sending, failed, justSaved, write, clearFeedback } = useRoomSetting(
    room,
    definition.key
  );
  const [anchor, setAnchor] = useState<RectCords>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label = t(definition.label);
  const hasCatalog = Boolean(catalog.runtime) || catalog.models.length > 0;
  const stored = useMemo(
    () => classifyStoredModel(value, catalog.models, hasCatalog),
    [value, catalog.models, hasCatalog]
  );

  const close = () => {
    setAnchor(undefined);
    triggerRef.current?.focus();
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor((open) => {
      if (open) return undefined;
      if (!hasCatalog && !catalog.loading) catalog.refresh();
      return rect;
    });
  };

  const handleChoose = (next: string) => {
    clearFeedback();
    close();
    void write(next);
  };

  const shownLabel = (() => {
    switch (stored.kind) {
      case 'default':
        return t(`${STRINGS}.model.default`);
      case 'known':
        return stored.level
          ? t(`${PICKER_STRINGS}.withLevel`, {
              model: stored.model.display_name,
              level: t(`${PICKER_STRINGS}.levels.${stored.level}`),
            })
          : stored.model.display_name;
      case 'unknown':
      case 'raw':
        return stored.raw;
    }
  })();

  const disabled = !canEdit || sending;

  return (
    <Box direction="Column" gap="200">
      <SettingTile
        title={label}
        description={t(definition.description)}
        after={
          <>
            <Button
              ref={triggerRef}
              type="button"
              className={tileCss.TriggerButton}
              aria-description={label}
              aria-haspopup="dialog"
              aria-expanded={anchor !== undefined}
              disabled={disabled}
              onClick={toggle}
              variant="Secondary"
              fill="Soft"
              outlined
              size="300"
              radii="300"
              before={
                stored.kind === 'known' ? (
                  <ModelIcon
                    provider={stored.model.provider}
                    id={stored.model.id}
                    iconUrl={stored.model.icon_url}
                    size={16}
                  />
                ) : undefined
              }
              after={<Icon size="100" src={Icons.ChevronBottom} />}
            >
              <Text size="T300" truncate>
                {shownLabel}
              </Text>
            </Button>
            <PopOut
              anchor={anchor}
              position="Bottom"
              align="End"
              offset={5}
              content={
                anchor ? (
                  <RoomModelMenu
                    label={label}
                    catalog={catalog}
                    stored={stored}
                    allowReasoningLevels={definition.allowReasoningLevels}
                    disabled={disabled}
                    onChoose={handleChoose}
                    requestClose={close}
                  />
                ) : undefined
              }
            />
          </>
        }
      />
      {stored.kind === 'unknown' && (
        <Text size="T200" priority="300">
          {t(`${STRINGS}.model.unknown`, { value: stored.raw })}
        </Text>
      )}
      <span role="status" className={textCss.VisuallyHidden}>
        {justSaved ? t(`${STRINGS}.saved`) : ''}
      </span>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t(`${STRINGS}.saveFailed`)}
        </Text>
      )}
      {!canEdit && (
        <Text size="T200" priority="300">
          {t(`${STRINGS}.readOnly`)}
        </Text>
      )}
    </Box>
  );
}
