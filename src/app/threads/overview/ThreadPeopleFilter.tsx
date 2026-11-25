import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../matrix/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../matrix/room';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { ThreadFilterDropdown, ThreadFilterPanel } from './ThreadFilterDropdown';
import * as css from './ThreadFilterDropdown.css';
import {
  buildThreadPeopleActivity,
  matchesThreadPersonSearch,
} from '../../event-store/threads/threadPeopleFilter';
import type { ThreadRecord } from '../../event-store/threads/types';

export type ThreadPeopleFilterProps = (
  { room: Room; rooms?: never } | { rooms: readonly Room[]; room?: never }
) & {
  /** The room's thread records before filtering: whoever took part in any of them is listed. */
  records: ReadonlyMap<string, ThreadRecord>;
  selected: readonly string[] | undefined;
  /** Called when the list opens: its counts need every thread's writers. */
  onShown?: () => void;
  onToggle: (userId: string) => void;
  /** Unchecks everyone. */
  onClear: () => void;
};

type PersonOption = {
  userId: string;
  displayName: string;
  disambiguator?: string;
  avatarUrl?: string;
  agent: boolean;
  threadCount: number;
};

const normalizeDisplayNameKey = (name: string): string =>
  name.normalize('NFKC').trim().toLocaleLowerCase();

function PeoplePanel({
  room,
  rooms,
  records,
  selected,
  onShown,
  onToggle,
  onClear,
}: ThreadPeopleFilterProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  useEffect(() => {
    onShown?.();
  }, [onShown]);

  const lookupRooms = useMemo<readonly Room[]>(() => rooms ?? (room ? [room] : []), [room, rooms]);

  // One pass over the room's threads while the panel is open, again only when they change.
  const activity = useMemo(() => buildThreadPeopleActivity(records.values()), [records]);
  const toOption = (userId: string, threadCount: number): PersonOption => {
    let displayName: string | undefined;
    let avatarMxc: string | undefined;
    for (const candidate of lookupRooms) {
      if (!candidate.getMember?.(userId)) continue;
      if (!displayName) displayName = getMemberDisplayName(candidate, userId) || undefined;
      if (!avatarMxc) avatarMxc = getMemberAvatarMxc(candidate, userId) || undefined;
      if (displayName && avatarMxc) break;
    }
    if (!displayName) {
      for (const candidate of lookupRooms) {
        const name = getMemberDisplayName(candidate, userId);
        if (name) {
          displayName = name;
          break;
        }
      }
    }
    const user = mx.getUser?.(userId);
    const resolvedAvatarMxc = avatarMxc ?? (user?.avatarUrl || undefined);
    return {
      userId,
      displayName: displayName || user?.displayName || getMxIdLocalPart(userId) || userId,
      avatarUrl: resolvedAvatarMxc
        ? (mxcUrlToHttp(mx, resolvedAvatarMxc, authenticatedMedia, 32, 32, 'crop') ?? undefined)
        : undefined,
      agent: isMindroomAgentUserId(userId),
      threadCount,
    };
  };
  const listed = useMemo(
    () => activity.map((person) => toOption(person.userId, person.threadCount)),
    // toOption reads only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, lookupRooms, mx, authenticatedMedia]
  );
  // A chosen person no thread shows any more stays listed, so the choice can be undone.
  const listedIds = new Set(listed.map((person) => person.userId));
  const rawPeople = [
    ...listed,
    ...(selected ?? []).filter((userId) => !listedIds.has(userId)).map((id) => toOption(id, 0)),
  ];
  const nameCounts = new Map<string, number>();
  rawPeople.forEach((person) => {
    const key = normalizeDisplayNameKey(person.displayName);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  });
  const people = rawPeople.map((person) => {
    const key = normalizeDisplayNameKey(person.displayName);
    return (nameCounts.get(key) ?? 0) > 1 && !person.displayName.endsWith(` (${person.userId})`)
      ? { ...person, disambiguator: person.userId }
      : person;
  });
  const chosen = new Set(selected);

  return (
    <ThreadFilterPanel
      name="people"
      optionAttribute="data-person-option"
      label={t('mindroomUi.threads.threadPeopleFilter.ariaLabel')}
      searchLabel={t('mindroomUi.threads.threadPeopleFilter.search')}
      noMatchLabel={t('mindroomUi.threads.threadPeopleFilter.noMatch')}
      options={(query) =>
        people
          .filter((person) => matchesThreadPersonSearch(person, query))
          .map((person) => ({
            id: person.userId,
            checked: chosen.has(person.userId),
            count: person.threadCount,
            content: (
              <>
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
                {person.disambiguator && (
                  <Text
                    as="span"
                    size="T200"
                    className={css.OptionCount}
                    data-person-disambiguator="true"
                  >
                    {person.disambiguator}
                  </Text>
                )}
                {person.agent && (
                  <Text as="span" size="L400" className={css.Marker}>
                    {t('threadActions.agent')}
                  </Text>
                )}
              </>
            ),
          }))
      }
      onToggle={onToggle}
      onClear={chosen.size > 0 ? onClear : undefined}
    />
  );
}

/**
 * The filter bar's People dropdown: a search field over a checkbox for everyone who took part in
 * the room's threads. A thread stays when any checked person took part in it.
 */
export function ThreadPeopleFilter(props: ThreadPeopleFilterProps) {
  const { t } = useTranslation();
  const count = props.selected?.length ?? 0;

  return (
    <ThreadFilterDropdown
      name="people"
      label={t('mindroomUi.threads.threadPeopleFilter.label')}
      count={count}
      ariaLabel={
        count > 0
          ? t('mindroomUi.threads.threadPeopleFilter.ariaLabelActive', { number: count })
          : t('mindroomUi.threads.threadPeopleFilter.ariaLabel')
      }
    >
      <PeoplePanel {...props} />
    </ThreadFilterDropdown>
  );
}
