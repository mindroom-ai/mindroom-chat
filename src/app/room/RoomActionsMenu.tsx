import { Fragment, Suspense, forwardRef, useCallback, useState, type ReactNode } from 'react';
import { Line, toRem } from 'folds';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuGroup } from '../ui/MenuEntry';
import { ROOM_ACTIONS, type RoomActionDialog, type RoomActionProps } from './roomActions';
import * as css from './RoomActionsMenu.css';

type RoomActionsMenuProps = RoomActionProps & {
  /**
   * What only works inside the open room (the room header's menu): the header's actions that its
   * row leaves to the menu (src/app/room/roomHeaderActions.tsx). A section of its own, before the
   * room's actions.
   */
  roomEntries?: ReactNode;
};

const menuStyle = { minWidth: toRem(200), maxWidth: toRem(280) } as const;

/**
 * A room's menu, the same wherever it opens: the room's actions (`ROOM_ACTIONS`), after the
 * open room's own entries when the room header opens it. Rows are 44 px on touch screens. The
 * ref reaches the menu element, which the focus trap around it needs to close on Escape and
 * outside clicks.
 */
export const RoomActionsMenu = forwardRef<HTMLDivElement, RoomActionsMenuProps>(
  function RoomActionsMenu({ roomEntries, ...actionProps }, ref) {
    return (
      <Menu ref={ref} className={css.RoomMenu} style={menuStyle}>
        {roomEntries && (
          <>
            <MenuGroup>{roomEntries}</MenuGroup>
            <Line variant="Surface" size="300" />
          </>
        )}
        {ROOM_ACTIONS.map((group, index) => (
          <Fragment key={group[0]?.id ?? index}>
            {index > 0 && <Line variant="Surface" size="300" />}
            <MenuGroup>
              {group.map(({ id, Entry }) => (
                <Entry key={id} {...actionProps} />
              ))}
            </MenuGroup>
          </Fragment>
        ))}
      </Menu>
    );
  }
);

/**
 * The dialog a room menu's entry opened (invite, Jump to Time, leave and the like), which stays
 * after the menu closes: render `dialog` where the menu's button is.
 */
export const useRoomActionDialog = () => {
  const [render, setRender] = useState<{ dialog: RoomActionDialog }>();
  const close = useCallback(() => setRender(undefined), []);
  const showDialog = useCallback((dialog: RoomActionDialog) => setRender({ dialog }), []);
  const dialog = render && <Suspense fallback={null}>{render.dialog(close)}</Suspense>;
  return { dialog, showDialog };
};
