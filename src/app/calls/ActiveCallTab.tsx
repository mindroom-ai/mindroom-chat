import { useSetAtom } from 'jotai';
import type { MouseEvent } from 'react';
import { Icon } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../ui/sidebar/SidebarItem';
import { callHomeRoomId, callPanelRoomAtom, type ActiveCall } from './callStore';
import { useActiveCallShortcut } from './useActiveCallShortcut';
import { focusHandOffAtom, useCallViewFloats, useExpandCallWindow } from './window/callWindowState';
import * as css from './CallTab.css';

/**
 * The rail's green call button: the call view, open. On desktop the floating window shows over
 * the page the person is on, out of its bar, and the button's focus goes to the window's handle;
 * docked, and on phones, the button goes back to the call's conversation with its panel open.
 */
export function ActiveCallTab({ active }: { active: ActiveCall }) {
  const { label, icon, speaking, openHome } = useActiveCallShortcut(active);
  const setPanelRoom = useSetAtom(callPanelRoomAtom);
  const setFocusHandOff = useSetAtom(focusHandOffAtom);
  const floats = useCallViewFloats();
  const expandWindow = useExpandCallWindow();

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    if (floats) {
      setPanelRoom(callHomeRoomId(active));
      setFocusHandOff({ to: 'window', from: document.activeElement });
      expandWindow();
    } else openHome(event.currentTarget);
  };

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            data-call-tab=""
            data-speaking={speaking}
            className={css.CallTab}
            onClick={open}
          >
            <Icon src={icon} filled />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
