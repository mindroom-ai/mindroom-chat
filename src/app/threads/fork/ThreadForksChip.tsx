import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Icon, Text, config, type RectCords } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import type { Room } from 'matrix-js-sdk';
import { ForkIcon } from '../../messages/ForkIcon';
import * as reactionCss from '../../messages/reactions/Reaction.css';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { PopOut } from '../../ui/directional';
import { useThreadTitle } from './ThreadForkDivider';
import type { ThreadFork } from './useThreadForks';

function ForkEntry({ room, fork, onOpen }: { room: Room; fork: ThreadFork; onOpen: () => void }) {
  const title = useThreadTitle(room, fork.threadId, undefined, undefined);
  const time = useRelativeTime(fork.ts, 'compact');
  const language = useAppLanguageCode();
  return (
    <MenuEntry
      role="menuitem"
      label={title}
      icon={ForkIcon}
      after={
        <Text
          as="span"
          size="T200"
          priority="300"
          title={new Date(fork.ts).toLocaleString(language)}
        >
          {time}
        </Text>
      }
      data-fork-thread-id={fork.threadId}
      onSelect={onOpen}
    />
  );
}

/**
 * "2 forks" under the message a thread was forked at, beside its reactions. Its menu lists each
 * fork with its title and when it was made, and opens the one chosen.
 */
export function ThreadForksChip({ room, forks }: { room: Room; forks: ThreadFork[] }) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const [anchor, setAnchor] = useState<RectCords>();
  // A click outside or Escape closes it; the trap then lets the click through.
  const closeMenu = () => {
    setAnchor(undefined);
    return true;
  };
  return (
    <>
      <button
        type="button"
        className={reactionCss.Reaction}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        data-thread-forks-chip
        // Never flush under the message, as the thread badge keeps off it.
        style={{ marginBlockStart: config.space.S200 }}
        onClick={(evt) => setAnchor(evt.currentTarget.getBoundingClientRect())}
      >
        <Icon size="100" src={ForkIcon} aria-hidden="true" />
        <Text as="span" size="L400">
          {t('threadFork.forkCount', { count: forks.length })}
        </Text>
      </button>
      {anchor && (
        <PopOut
          anchor={anchor}
          offset={4}
          align="Start"
          position="Bottom"
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: false,
                clickOutsideDeactivates: closeMenu,
                escapeDeactivates: closeMenu,
              }}
            >
              <Menu role="menu" aria-label={t('threadFork.forkCount', { count: forks.length })}>
                <MenuGroup>
                  {forks.map((fork) => (
                    <ForkEntry
                      key={fork.threadId}
                      room={room}
                      fork={fork}
                      onOpen={() => {
                        setAnchor(undefined);
                        navigateRoomThread(room.roomId, fork.threadId);
                      }}
                    />
                  ))}
                </MenuGroup>
              </Menu>
            </FocusTrap>
          }
        />
      )}
    </>
  );
}
