import { Fragment, Suspense, forwardRef, useCallback, useState, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Line, toRem } from 'folds';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins } from '../plugins/registry';
import { usePluginRoomActions, type PluginRoomDialog } from '../plugins/roomActions';
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

type PluginDialogProps = { dialog: PluginRoomDialog; close: () => void };

// Calls the plugin's function inside the boundary around it, so a throw there is caught too.
function PluginDialogContent({ dialog, close }: PluginDialogProps) {
  return <>{dialog(close)}</>;
}

/**
 * A plugin's dialog. One that throws is logged and reported with the plugin's tag, and closes, so
 * the next dialog of the menu starts afresh.
 */
function PluginDialog({ tag, dialog, close }: PluginDialogProps & { tag: string }) {
  return (
    <ErrorBoundary
      fallback={null}
      onError={(thrown: unknown, info) => {
        // eslint-disable-next-line no-console
        console.error(`[plugin ${tag}] its room action's dialog failed`, thrown);
        reportBoundaryError(pluginFailure(tag, thrown), info.componentStack);
        close();
      }}
    >
      <PluginDialogContent dialog={dialog} close={close} />
    </ErrorBoundary>
  );
}

/**
 * A room's menu, the same wherever it opens: the room's actions (`ROOM_ACTIONS`), with the
 * entries client plugins add after their first group, in a group of their own, and their critical
 * ones at the end of the last group, after Leave; all of them after the open room's own entries
 * when the room header opens it. Rows are 44 px on touch screens. The ref reaches the menu element,
 * which the focus trap around it needs to close on Escape and outside clicks.
 */
export const RoomActionsMenu = forwardRef<HTMLDivElement, RoomActionsMenuProps>(
  function RoomActionsMenu({ roomEntries, ...actionProps }, ref) {
    const { room, close, showDialog } = actionProps;
    const pluginEntries = usePluginRoomActions(registeredPlugins, useOptionalClientConfig(), room);
    // A plugin's entry closes the menu, then runs with the menu's dialog.
    const pluginRows = (critical: boolean) =>
      pluginEntries
        .filter((entry) => entry.critical === critical)
        .map(({ id, tag, label, icon, run }) => (
          <MenuEntry
            key={id}
            icon={icon}
            label={label}
            critical={critical}
            onSelect={() => {
              close();
              run((dialog) =>
                showDialog((done) => <PluginDialog tag={tag} dialog={dialog} close={done} />)
              );
            }}
          />
        ));
    const ordinaryRows = pluginRows(false);
    const criticalRows = pluginRows(true);
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
              {index === ROOM_ACTIONS.length - 1 && criticalRows}
            </MenuGroup>
            {index === 0 && ordinaryRows.length > 0 && (
              <>
                <Line variant="Surface" size="300" />
                <MenuGroup>{ordinaryRows}</MenuGroup>
              </>
            )}
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
