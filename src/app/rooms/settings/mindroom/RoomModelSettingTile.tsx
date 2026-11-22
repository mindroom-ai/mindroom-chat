import { MouseEvent, useCallback, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Box, Button, Icon, Icons, Spinner, Text, color, config, type RectCords } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { ModelIcon } from '../../../models/ModelIcon';
import { TrappedModelPickerPanel, type DefaultWords } from '../../../models/ModelPicker';
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

type StoredModelState =
  | { kind: 'default' }
  | { kind: 'known'; model: ModelCatalogEntry; level?: ReasoningLevel }
  | { kind: 'unknown'; raw: string }
  | { kind: 'raw'; raw: string };

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
  if (level === undefined) return { kind: 'known', model };
  return model.reasoning_levels?.includes(level as ReasoningLevel)
    ? { kind: 'known', model, level: level as ReasoningLevel }
    : { kind: 'unknown', raw: value };
};

/**
 * A room setting holding a model reference (`key` or `key@level`), populated from room-scope
 * discovery and written via `useRoomSetting`. Reuses `TrappedModelPickerPanel` via an adapter state.
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
  const hasCatalog = Boolean(catalog.runtime);
  const stored = useMemo(
    () => classifyStoredModel(value, catalog.models, hasCatalog),
    [value, catalog.models, hasCatalog]
  );

  const close = useCallback(() => {
    setAnchor(undefined);
    triggerRef.current?.focus();
  }, []);

  const writeSetting = useCallback(
    (next: string) => {
      clearFeedback();
      close();
      void write(next);
    },
    [clearFeedback, close, write]
  );

  const defaults: DefaultWords = useMemo(
    () => ({
      label: t(`${STRINGS}.model.default`),
      agents: '',
      description: t(`${STRINGS}.model.defaultDescription`),
    }),
    [t]
  );

  const models = useMemo(
    () =>
      definition.allowReasoningLevels
        ? catalog.models
        : catalog.models.map(({ reasoning_levels: _, reasoning_default: __, ...plain }) => plain),
    [catalog.models, definition.allowReasoningLevels]
  );

  const adaptedState: ModelPickerState = useMemo(
    () => ({
      ...catalog,
      models,
      inherited: [],
      override:
        stored.kind === 'known' ? stored.model.key : stored.kind === 'unknown' ? stored.raw : null,
      reasoning: stored.kind === 'known' ? stored.level ?? null : null,
      pending: false,
      error: undefined,
      canMutate: canEdit && !sending,
      selectModel: (key, level) => writeSetting(level ? `${key}@${level}` : key),
      resetToRoomDefault: () => writeSetting(''),
    }),
    [catalog, models, stored, canEdit, sending, writeSetting]
  );

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor((open) => {
      if (open) return undefined;
      if (!hasCatalog && !catalog.loading) catalog.refresh();
      return rect;
    });
  };

  const shownLabel =
    stored.kind === 'default'
      ? defaults.label
      : stored.kind === 'known'
      ? stored.level
        ? t(`${PICKER_STRINGS}.withLevel`, {
            model: stored.model.display_name,
            level: t(`${PICKER_STRINGS}.levels.${stored.level}`),
          })
        : stored.model.display_name
      : stored.raw;

  const disabled = !canEdit || sending;
  const showPicker = hasCatalog || catalog.runtimes.length > 1;

  const popover = !anchor ? undefined : showPicker ? (
    <TrappedModelPickerPanel
      state={adaptedState}
      defaults={defaults}
      room="50vh"
      ariaLabel={label}
      allowReselect
      requestClose={close}
      onCommand={close}
    />
  ) : (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        onDeactivate: close,
        returnFocusOnDeactivate: true,
      }}
    >
      <div>
        <Menu role="dialog" aria-label={label} className={pickerCss.Panel}>
          <Box direction="Column" gap="200" style={{ padding: config.space.S300 }}>
            {catalog.loading ? (
              <div className={pickerCss.StatusRow} role="status">
                <Spinner size="100" variant="Secondary" />
                {t(`${PICKER_STRINGS}.loading`)}
              </div>
            ) : (
              <Text size="T200" priority="300" role="status">
                {t(`${STRINGS}.model.catalogUnavailable`)}
              </Text>
            )}
            <Box gap="200" justifyContent="End">
              {!catalog.loading && (
                <Button
                  type="button"
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="None"
                  onClick={catalog.refresh}
                >
                  <Text size="B300">{t(`${PICKER_STRINGS}.retry`)}</Text>
                </Button>
              )}
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={disabled}
                onClick={() => writeSetting('')}
              >
                <Text size="B300">{defaults.label}</Text>
              </Button>
            </Box>
          </Box>
        </Menu>
      </div>
    </FocusTrap>
  );

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
            <PopOut anchor={anchor} position="Bottom" align="End" offset={5} content={popover} />
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
