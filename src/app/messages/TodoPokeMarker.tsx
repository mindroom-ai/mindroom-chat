import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { IconChecklist } from '@tabler/icons-react';
import { copyToClipboard } from '../lib/dom';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import type { TodoPokeInfo } from '../matrix/protocol/todoPoke';
import { settingsAtom } from '../preferences/settings';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { ownDirectionBlock, revealDirectionControls } from '../ui/directional';
import { useRevealOnOpen } from '../ui/disclosureReveal';
import { Time } from './Time';
import * as css from './TodoPokeMarker.css';

const KEY = 'mindroomUi.messages.todoPokeMarker';
const COPIED_FEEDBACK_MS = 2000;

export type TodoPokeMarkerProps = {
  poke: TodoPokeInfo;
  ts?: number;
  senderDisplayName?: string;
};

const resolveAgentName = (
  senderDisplayName: string | undefined,
  assignedAgent: string | undefined
): string | undefined => {
  const trimmed = senderDisplayName?.trim();
  if (trimmed && (!isMindroomAgentUserId(trimmed) || !assignedAgent)) return trimmed;
  return assignedAgent;
};

/**
 * Quiet scannable list for a MindRoom todo wake-up message: drops the redundant agent avatar and
 * boilerplate while keeping actionable items immediately readable, with aligned priority pills and
 * copyable short IDs.
 */
export function TodoPokeMarker({ poke, ts, senderDisplayName }: TodoPokeMarkerProps) {
  const { t } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const dateFormatString = useSettingValue(settingsAtom, 'dateFormatString');
  const [expanded, setExpanded] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const armReveal = useRevealOnOpen(expanded, toggleRef, bodyRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const agentName = resolveAgentName(senderDisplayName, poke.assignedAgent);
  const metaItems: Array<{ key: string; node: ReactNode }> = [];
  if (agentName) {
    metaItems.push({ key: 'agent', node: <bdi>{revealDirectionControls(agentName)}</bdi> });
  }
  if (ts !== undefined && Number.isFinite(ts)) {
    metaItems.push({
      key: 'time',
      node: <Time ts={ts} hour24Clock={hour24Clock} dateFormatString={dateFormatString} />,
    });
  }

  const remaining = Math.max(0, poke.totalCount - poke.items.length);

  const handleCopyId = async (
    itemKey: string,
    id: string,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    const done = await copyToClipboard(id, event.currentTarget);
    if (!done || !mountedRef.current) return;
    setCopiedKey(itemKey);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopiedKey(null);
    }, COPIED_FEEDBACK_MS);
  };

  return (
    <div className={css.Marker} data-todo-poke="true">
      <div className={css.Eyebrow}>
        <span className={css.EyebrowMain}>
          <IconChecklist size={14} aria-hidden />
          <Text as="span" size="T200" className={css.Title}>
            {t(`${KEY}.readyCount`, { count: poke.totalCount })}
          </Text>
          {metaItems.length > 0 && (
            <Text as="span" size="T200" priority="400" className={css.Meta}>
              {metaItems.map(({ key, node }) => (
                <Fragment key={key}>
                  {' · '}
                  {node}
                </Fragment>
              ))}
            </Text>
          )}
        </span>
        <button
          ref={toggleRef}
          type="button"
          className={css.Toggle}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => {
            if (!expanded) armReveal();
            setExpanded((value) => !value);
          }}
        >
          <span>{t(expanded ? `${KEY}.hide` : `${KEY}.show`)}</span>
          <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
        </button>
      </div>
      {expanded && (
        <div ref={bodyRef} className={css.Body} data-todo-poke-list="true">
          <ul id={listId} className={css.List}>
            {poke.items.map((item, index) => {
              const itemKey = `${index}:${item.id}`;
              const isCopied = copiedKey === itemKey;
              const safeId = revealDirectionControls(item.id);
              const copyLabel = isCopied
                ? t('messageCodeBlock.copied')
                : t(`${KEY}.copyId`, { id: safeId });
              return (
                <li key={itemKey} className={css.Item}>
                  <span className={css.PriorityDot[item.priority]} aria-hidden="true" />
                  <span className={css.ItemTitle} {...ownDirectionBlock}>
                    {revealDirectionControls(item.title)}
                  </span>
                  <span className={css.ItemMeta}>
                    <span className={css.PriorityPill[item.priority]}>
                      {t(`${KEY}.priority.${item.priority}`)}
                    </span>
                    <button
                      type="button"
                      className={css.IdButton}
                      aria-label={copyLabel}
                      title={copyLabel}
                      onClick={(event) => void handleCopyId(itemKey, item.id, event)}
                    >
                      {isCopied ? t('messageCodeBlock.copied') : safeId}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {remaining > 0 && (
            <Text as="div" size="T200" priority="400" className={css.Overflow}>
              {t(`${KEY}.moreItems`, { count: remaining })}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
