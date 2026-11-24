import { Fragment, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { IconBolt } from '@tabler/icons-react';
import { ownDirectionBlock, revealDirectionControls } from '../ui/directional';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
import type { TriggerWakeInfo } from '../matrix/protocol/triggerWake';
import { Time } from './Time';
import * as css from './TriggerWakeMarker.css';

const KEY = 'mindroomUi.messages.triggerWakeMarker';

type TriggerWakeMarkerProps = {
  wake: TriggerWakeInfo;
  ts?: number;
};

const summarizeWake = (wake: TriggerWakeInfo): string => {
  const parts = [wake.kind ?? wake.sourceType, wake.triggerId].filter(
    (part, index, list): part is string => !!part && list.indexOf(part) === index
  );
  return parts.map(revealDirectionControls).join(' · ');
};

const describeSource = (wake: TriggerWakeInfo): string | undefined => {
  if (wake.sourceType && wake.kind && wake.sourceType !== wake.kind) {
    return `${wake.sourceType} / ${wake.kind}`;
  }
  return wake.sourceType ?? wake.kind;
};

/**
 * Quiet 1-line marker for a MindRoom reactive or direct external trigger wake event.
 * Expands in place to show trigger metadata, prompt text, and optional JSON event payload.
 */
export function TriggerWakeMarker({ wake, ts }: TriggerWakeMarkerProps) {
  const { t } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const dateFormatString = useSettingValue(settingsAtom, 'dateFormatString');
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const summary = summarizeWake(wake);
  const source = describeSource(wake);
  const metaItems: ReactNode[] = [];
  if (wake.triggerId) {
    metaItems.push(t(`${KEY}.triggerLabel`, { id: revealDirectionControls(wake.triggerId) }));
  }
  if (source) {
    metaItems.push(t(`${KEY}.sourceLabel`, { source: revealDirectionControls(source) }));
  }
  if (wake.triage) {
    metaItems.push(t(`${KEY}.triageLabel`, { reason: revealDirectionControls(wake.triage) }));
  }
  if (ts !== undefined && Number.isFinite(ts)) {
    metaItems.push(
      <Time key="time" ts={ts} hour24Clock={hour24Clock} dateFormatString={dateFormatString} />
    );
  }
  const promptText = wake.prompt || (metaItems.length === 0 && !wake.eventJson ? wake.rawBody : '');

  return (
    <div className={css.Marker} data-trigger-wake={wake.sourceKind}>
      <button
        type="button"
        className={css.Trigger}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <IconBolt size={14} aria-hidden />
        <Text as="span" size="T200" className={css.Title}>
          {t(wake.sourceKind === 'reactive' ? `${KEY}.triggered` : `${KEY}.webhook`)}
        </Text>
        {summary && (
          <Text as="span" size="T200" className={css.Summary}>
            {summary}
          </Text>
        )}
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className={css.Panel} data-trigger-wake-details="true">
          {metaItems.length > 0 && (
            <Text as="span" size="T200" priority="300">
              {metaItems.map((item, index) => (
                <Fragment key={index}>
                  {index > 0 ? ' · ' : null}
                  {item}
                </Fragment>
              ))}
            </Text>
          )}
          {promptText && (
            <Text as="p" size="T200" className={css.Prompt} {...ownDirectionBlock}>
              {revealDirectionControls(promptText)}
            </Text>
          )}
          {wake.eventJson && (
            <pre
              className={css.Payload}
              dir="ltr"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              role="region"
              aria-label={t(`${KEY}.payloadLabel`)}
            >
              {revealDirectionControls(wake.eventJson)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
