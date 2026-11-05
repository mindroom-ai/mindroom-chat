import { useMemo } from 'react';
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
import { buildThreadPeopleActivity, matchesThreadPersonSearch } from '../../event-store/threads/threadPeopleFilter';
import type { ThreadRecord } from '../../event-store/threads/types';

export type ThreadPeopleFilterProps = {
  room: Room;
  /** The room's thread records before filtering: whoever took part in any of them is listed. */
  records: ReadonlyMap<string, ThreadRecord>;
  selected: readonly string[] | undefined;
  onToggle: (userId: string) => void;
  /** Unchecks everyone. */
  onClear: () => void;
};

type PersonOption = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  agent: boolean;
  threadCount: number;
};

function PeoplePanel({ room, records, selected, onToggle, onClear }: ThreadPeopleFilterProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();

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
  const people = [
    ...listed,
    ...(selected ?? []).filter((userId) => !listedIds.has(userId)).map((id) => toOption(id, 0)),
  ];
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
