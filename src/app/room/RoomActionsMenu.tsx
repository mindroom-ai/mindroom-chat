import { Fragment, Suspense, useCallback, useState, type ReactNode, type Ref } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { Line, toRem } from 'folds';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { usePluginClientConfig } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins } from '../plugins/registry';
import { usePluginRoomActions, type PluginRoomDialog } from '../plugins/roomActions';
import { ROOM_ACTIONS, type RoomActionDialog, type RoomActionProps } from './roomActions';
import * as scrollableMenuCss from '../ui/ScrollableMenu.css';

type RoomActionsMenuProps = RoomActionProps & {
  /**
   * Actions specific to the open room's header, including those with row shortcuts on phones.
   * A section of its own, before the room's actions.
   */
  roomEntries?: ReactNode;
  ref?: Ref<HTMLDivElement>;
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
 * entries client plugins add in a group of their own before Remove from, Archive and Leave, and
 * their critical ones at the end of the last group, after Leave; all of them after the open room's
 * own entries when the room header opens it. Its rows are as tall as a message menu's. The ref
 * reaches the menu element, which the focus trap around it needs to close on Escape and outside
 * clicks.
 */
export function RoomActionsMenu({ roomEntries, ref, ...actionProps }: RoomActionsMenuProps) {
  const { t } = useTranslation();
  const { room, close, showDialog } = actionProps;
  const pluginEntries = usePluginRoomActions(registeredPlugins, usePluginClientConfig(), room);
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
    <Menu ref={ref} className={scrollableMenuCss.ScrollableMenu} style={menuStyle}>
      <div className={scrollableMenuCss.ScrollableMenuRows}>
        {roomEntries && (
          <>
            <MenuGroup label={t('featureUi.roomActions.viewSection')}>{roomEntries}</MenuGroup>
            <Line variant="Surface" size="300" />
          </>
        )}
        {ROOM_ACTIONS.map((group, index) => {
          const isExit = group.id === 'exit';
          return (
            <Fragment key={group.id}>
              {index > 0 && <Line variant="Surface" size="300" />}
              {isExit && ordinaryRows.length > 0 && (
                <>
                  <MenuGroup>{ordinaryRows}</MenuGroup>
                  <Line variant="Surface" size="300" />
                </>
              )}
              <MenuGroup label={group.labelKey ? t(group.labelKey) : undefined}>
                {group.actions.map(({ id, Entry }) => (
                  <Entry key={id} {...actionProps} />
                ))}
                {isExit && criticalRows}
              </MenuGroup>
            </Fragment>
          );
        })}
      </div>
    </Menu>
  );
}

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
