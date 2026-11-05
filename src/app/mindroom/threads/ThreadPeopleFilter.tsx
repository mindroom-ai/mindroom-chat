import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { IconChevronDown } from '@tabler/icons-react';
import { Avatar, Checkbox, Icon, Icons, Text } from 'folds';
import { Surface } from '../../components/glass/GlassPrimitives';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import * as overviewCss from './RoomThreadOverview.css';
import * as css from './ThreadPeopleFilter.css';
import { buildThreadPeopleActivity, matchesThreadPersonSearch } from './threadPeopleFilter';
import type { ThreadRecord } from './types';

export type ThreadPeopleFilterProps = {
  room: Room;
  /** The room's thread records before filtering: whoever took part in any of them is listed. */
  records: ReadonlyMap<string, ThreadRecord>;
  selected: readonly string[] | undefined;
  onToggle: (userId: string) => void;
};

type PersonOption = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  agent: boolean;
  threadCount: number;
};

function PeoplePanel({ room, records, selected, onToggle }: ThreadPeopleFilterProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const [query, setQuery] = useState('');

  // One pass over the room's threads while the panel is open, again only when they change.
  const activity = useMemo(() => buildThreadPeopleActivity(records.values()), [records]);
  const toOption = (userId: string, threadCount: number): PersonOption => {
    const avatarMxc = getMemberAvatarMxc(room, userId);
    return {
      userId,
      displayName: getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId,
      avatarUrl: avatarMxc
        ? mxcUrlToHttp(mx, avatarMxc, authenticatedMedia, 32, 32, 'crop') ?? undefined
        : undefined,
      agent: isMindroomAgentUserId(userId),
      threadCount,
    };
  };
  const listed = useMemo(
    () => activity.map((person) => toOption(person.userId, person.threadCount)),
    // toOption reads only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, room, mx, authenticatedMedia]
  );
  // A chosen person no thread shows any more stays listed, so the choice can be undone.
  const listedIds = new Set(listed.map((person) => person.userId));
  const options = [
    ...listed,
    ...(selected ?? []).filter((userId) => !listedIds.has(userId)).map((id) => toOption(id, 0)),
  ].filter((person) => matchesThreadPersonSearch(person, query));
  const chosen = new Set(selected);

  return (
    <Surface
      level="overlay"
      variant="SurfaceVariant"
      className={classNames(overviewCss.PresetDropdown, css.Panel)}
      role="dialog"
      aria-label={t('mindroomUi.threads.threadPeopleFilter.ariaLabel')}
      data-people-filter-panel="true"
    >
      <input
        className={css.Search}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Escape first clears the search, then closes the panel.
          if (event.key === 'Escape' && query) {
            event.stopPropagation();
            setQuery('');
          }
        }}
        placeholder={t('mindroomUi.threads.threadPeopleFilter.search')}
        aria-label={t('mindroomUi.threads.threadPeopleFilter.search')}
        // The panel opens to search; the trigger takes focus back when it closes.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        data-people-filter-search="true"
      />
      <div
        className={css.List}
        // A press on a person keeps the focus where it is, so the panel does not close on blur.
        onMouseDown={(event) => event.preventDefault()}
        data-people-filter-list="true"
      >
        {options.map((person) => (
          <label key={person.userId} className={css.Person} data-person-option={person.userId}>
            <Checkbox
              variant="Primary"
              size="200"
              checked={chosen.has(person.userId)}
              // folds leaves onChange out of its Checkbox type; the click toggles the choice.
              readOnly
              onClick={() => onToggle(person.userId)}
            />
            <Avatar size="200" radii="Pill">
              <UserAvatar
                userId={person.userId}
                src={person.avatarUrl}
                alt=""
                renderFallback={() => <Icon size="50" src={Icons.User} filled />}
              />
            </Avatar>
            <Text as="span" size="T300" truncate className={css.Name}>
              {person.displayName}
            </Text>
            {person.agent && (
              <Text as="span" size="L400" className={css.AgentLabel}>
                {t('threadActions.agent')}
              </Text>
            )}
            {person.threadCount > 0 && (
              <Text as="span" size="T200" className={css.ThreadCount} aria-hidden="true">
                {person.threadCount}
              </Text>
            )}
          </label>
        ))}
        {options.length === 0 && (
          <Text size="T200" className={css.Empty}>
            {t('mindroomUi.threads.threadPeopleFilter.noMatch')}
          </Text>
        )}
      </div>
    </Surface>
  );
}

/**
 * The filter bar's People dropdown: a search field over a checkbox for everyone who took part in
 * the room's threads. A thread stays when any checked person took part in it.
 */
export function ThreadPeopleFilter(props: ThreadPeopleFilterProps) {
  const { selected } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = selected?.length ?? 0;

  const handleBlur = (event: FocusEvent) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={overviewCss.PresetContainer}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={classNames(overviewCss.PresetButton, count > 0 && css.TriggerActive)}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-label={
          count > 0
            ? t('mindroomUi.threads.threadPeopleFilter.ariaLabelActive', { number: count })
            : t('mindroomUi.threads.threadPeopleFilter.ariaLabel')
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        data-people-filter-button="true"
        data-people-filter-count={count}
      >
        <Text size="T200">{t('mindroomUi.threads.threadPeopleFilter.label')}</Text>
        {count > 0 && (
          <Text size="T200" className={css.Count}>
            {count}
          </Text>
        )}
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
      {open && <PeoplePanel {...props} />}
    </div>
  );
}
