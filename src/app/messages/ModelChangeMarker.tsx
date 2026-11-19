import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import { IconArrowsExchange } from '@tabler/icons-react';
import { revealDirectionControls } from '../ui/directional';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMemberDisplayName } from '../matrix/room';
import {
  REASONING_LEVELS,
  splitModelReference,
  type ModelCatalogEntry,
  type ReasoningLevel,
} from '../models/modelProtocol';
import { useThreadModelCatalog } from '../models/useModelPicker';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
import type { ModelChange } from './modelChanges';
import { Time } from './Time';
import * as css from './ModelChangeMarker.css';

const KEY = 'mindroomUi.messages.modelChangeMarker';

/**
 * How a set's reference reads: the name the viewer's catalog gives its key, else the key, and the
 * level it names, by the picker's own name for it. A level the client does not know leaves the
 * reference as the command wrote it.
 */
const describeModel = (
  reference: string,
  models: readonly ModelCatalogEntry[]
): { name: string; level?: ReasoningLevel } => {
  const { key, level } = splitModelReference(reference);
  const known = (REASONING_LEVELS as readonly string[]).includes(level ?? '');
  if (level !== undefined && !known) return { name: reference };
  const name = models.find((model) => model.key === key)?.display_name ?? key;
  return level === undefined ? { name } : { name, level: level as ReasoningLevel };
};

type ModelChangeMarkerProps = {
  change: ModelChange;
  room: Room;
  /** When the router applied the change: its acknowledgement's time. */
  ts: number;
};

// A thread's model change is a quiet fact of the thread, not a conversation: one line in place of
// the command and the router's reply to it (`planModelChanges`). It names what the command named
// and nothing else, since nothing the room can read says which model the change replaced. A
// click opens who changed it, when, and what the change covers.
export function ModelChangeMarker({ change, room, ts }: ModelChangeMarkerProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const models = useThreadModelCatalog(room, change.threadId);
  const [hour24Clock] = useHour24Clock();
  const dateFormatString = useSettingValue(settingsAtom, 'dateFormatString');
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const set = change.operation === 'set' && change.model !== undefined;
  const model = set && change.model !== undefined ? describeModel(change.model, models) : undefined;
  const modelLabel =
    model &&
    (model.level
      ? t('mindroomUi.models.modelPicker.withLevel', {
          model: model.name,
          level: t(`mindroomUi.models.modelPicker.levels.${model.level}`),
        })
      : model.name);
  const name = revealDirectionControls(
    getMemberDisplayName(room, change.senderId) ?? change.senderId
  );

  return (
    <div className={css.Marker} data-model-change={change.operation}>
      <button
        type="button"
        className={css.Trigger}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <IconArrowsExchange size={14} aria-hidden />
        <Text as="span" size="T200" className={css.Title}>
          {t(set ? `${KEY}.set` : `${KEY}.reset`)}
        </Text>
        <Text as="span" size="T200" className={css.Model}>
          {modelLabel ? revealDirectionControls(modelLabel) : t(`${KEY}.inherited`)}
        </Text>
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className={css.Panel} data-model-change-details="true">
          <Text as="span" size="T200" priority="300">
            {t(`${KEY}.changedBy`, { name })}
            {' · '}
            <Time ts={ts} hour24Clock={hour24Clock} dateFormatString={dateFormatString} />
          </Text>
          <Text as="span" size="T200" priority="300">
            {change.senderId === mx.getUserId()
              ? t(`${KEY}.scopeOwn`)
              : t(`${KEY}.scopeOther`, { name })}
          </Text>
        </div>
      )}
    </div>
  );
}
