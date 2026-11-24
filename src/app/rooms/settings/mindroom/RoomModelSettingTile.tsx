import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Icon, Icons, Text, color, type RectCords } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { ModelIcon } from '../../../models/ModelIcon';
import { TrappedModelPickerPanel } from '../../../models/ModelPicker';
import {
  splitModelReference,
  type ModelCatalogEntry,
  type ReasoningLevel,
} from '../../../models/modelProtocol';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { PopOut } from '../../../ui/directional';
import { SettingTile } from '../../../ui/SettingTile';
import type { RoomModelSettingDefinition } from './roomSettingDefinitions';
import * as tileCss from './RoomModelSettingTile.css';
import * as textCss from './RoomTextSettingTile.css';
import { useRoomSetting } from './useRoomSetting';

const STRINGS = 'featureUi.roomSettings.mindroom';
const PICKER_STRINGS = 'mindroomUi.models.modelPicker';
const WRAP_STYLE = { overflowWrap: 'anywhere' as const };

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
 * A room setting holding a model reference (`key` or `key@level`), chosen in the composer's model
 * menu from the room's catalog and written via `useRoomSetting`. The menu shows in every state of
 * the catalog, so its reset row is always there and the keys stay in one focus trap.
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
  // The right to edit went under the open menu: it closes, as a ChoiceButton's does. The button is
  // disabled by then, so the keys go to the line under it that says why.
  if (!canEdit && anchor) setAnchor(undefined);
  const readOnlyRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!canEdit && wasOpen.current) readOnlyRef.current?.focus();
    wasOpen.current = anchor !== undefined;
  });
  const label = t(definition.label);
  const hasCatalog = Boolean(catalog.runtime);
  const stored = useMemo(
    () => classifyStoredModel(value, catalog.models, hasCatalog),
    [value, catalog.models, hasCatalog]
  );

  const close = () => {
    setAnchor(undefined);
    triggerRef.current?.focus();
  };

  // The menu closes itself before it calls this.
  const writeSetting = (next: string) => {
    clearFeedback();
    void write(next);
  };

  const defaultLabel = t(`${STRINGS}.model.default`);

  const models = useMemo(
    () =>
      definition.allowReasoningLevels
        ? catalog.models
        : catalog.models.map(({ reasoning_levels: _, reasoning_default: __, ...plain }) => plain),
    [catalog.models, definition.allowReasoningLevels]
  );

  const mayWrite = canEdit && !sending;
  // No runtime has a list, also after a refresh none answered: the menu keeps the reset row and
  // says so, with Retry.
  const unavailable = catalog.runtimes.length === 0;
  const state: ModelPickerState = {
    ...catalog,
    // A list that waits for its runtime's answer says so, also while no query runs: one refused
    // for want of capacity is asked again in a moment.
    loading: catalog.loading || (hasCatalog && !catalog.canMutate),
    models,
    inherited: [],
    override:
      stored.kind === 'default' ? null : stored.kind === 'known' ? stored.model.key : stored.raw,
    reasoning: stored.kind === 'known' ? (stored.level ?? null) : null,
    pending: false,
    error: unavailable ? t(`${STRINGS}.model.catalogUnavailable`) : undefined,
    // A model or level writes once the shown runtime answered the query this opening started
    // (the catalog's `canMutate`): until then the rows show the list it had, which may hold a
    // model it has just lost. The reset needs no list.
    canMutate: mayWrite && catalog.canMutate,
    selectModel: (key, level) => writeSetting(level ? `${key}@${level}` : key),
    resetToRoomDefault: () => writeSetting(''),
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    if (sending) return;
    if (anchor) {
      setAnchor(undefined);
      return;
    }
    // Asked again on each opening, as the composer's menu does: a runtime's models change when
    // its configuration reloads.
    catalog.refresh();
    setAnchor(event.currentTarget.getBoundingClientRect());
  };

  const shownLabel =
    stored.kind === 'default'
      ? defaultLabel
      : stored.kind === 'known'
        ? stored.level
          ? t(`${PICKER_STRINGS}.withLevel`, {
              model: stored.model.display_name,
              level: t(`${PICKER_STRINGS}.levels.${stored.level}`),
            })
          : stored.model.display_name
        : stored.raw;

  const popover = anchor && (
    <TrappedModelPickerPanel
      state={state}
      defaults={{
        label: defaultLabel,
        agents: '',
        description: t(`${STRINGS}.model.defaultDescription`),
      }}
      room="50vh"
      ariaLabel={label}
      roomSetting={{ canReset: mayWrite }}
      requestClose={close}
      onCommand={close}
    />
  );

  return (
    <Box direction="Column" gap="200" data-room-setting={definition.key}>
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
              // Someone who may not edit gets a disabled button. A save only marks it disabled, so
              // the focus the closing menu handed back stays on it until the save ends.
              disabled={!canEdit}
              aria-disabled={sending || undefined}
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
        <Text size="T200" priority="300" style={WRAP_STYLE}>
          {t(`${STRINGS}.model.unknown`, { value: stored.raw })}
        </Text>
      )}
      {stored.kind === 'raw' && (
        <Text size="T200" priority="300" style={WRAP_STYLE}>
          {t(`${STRINGS}.model.storedRaw`, { value: stored.raw })}
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
        <Text ref={readOnlyRef} tabIndex={-1} size="T200" priority="300">
          {t(`${STRINGS}.readOnly`)}
        </Text>
      )}
    </Box>
  );
}
