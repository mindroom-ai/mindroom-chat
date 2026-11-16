import { useMemo, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAgentCaller } from '../calls/agent/agentCaller';
import { useAgentCallOffer } from '../calls/agent/useAgentCallOffer';
import { APP_LANGUAGES } from '../i18n/i18nLanguages';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { getRoomCommands } from '../navigation/roomCommands';
import { settingsModalAtom } from '../navigation/settingsModal';
import { settingsAtom } from '../preferences/settings';
import { getSettingDefinition, getShownSettings } from '../preferences/settingsRegistry';
import { LAYOUT_CHOICES } from '../settings/pages/Appearance';
import { useSettingsContext } from '../settings/useSettingsContext';
import { useSettingsSearchValues } from '../settings/useSettingsSearchValues';
import { SHORTCUTS, type ShortcutId } from '../shortcuts/shortcuts';
import { hasShortcutHandler, runShortcut } from '../shortcuts/useShortcut';
import {
  THEMES,
  deploymentThemeAtom,
  themePreviewAtom,
  themeSettingsAtom,
  useChosenTheme,
  withSystemTheme,
} from '../theme/useTheme';
import {
  COMMAND_PALETTE_PAGE_ICONS,
  type CommandPaletteChoice,
  getCommandPalettePageRows,
  tagCommandPalettePageRows,
} from './commandPalettePages';
import { getCommandPaletteSettingRows } from './commandPaletteSettings';
import type {
  CommandPaletteActionItem,
  CommandPalettePage,
  CommandPalettePageId,
  Executable,
} from './commandPaletteTypes';

export type CommandPaletteCommands = {
  /** Rows for the first list, beside the fixed actions. */
  actions: Executable<CommandPaletteActionItem>[];
  /** The rows only typed text finds, searched with the actions: every setting and page choice. */
  commands: Executable<CommandPaletteActionItem>[];
  pages: Record<CommandPalettePageId, CommandPalettePage>;
};

type CommandPaletteCommandsOptions = {
  room: Room;
  inRoom: boolean;
  threadId: string | undefined;
};

// The shortcuts offered as commands, with their ranks: among the least used actions, below the
// quick tour and above Logout.
const SHORTCUT_COMMANDS: readonly (readonly [ShortcutId, number])[] = [
  ['help', 15],
  ['nextUnread', 14],
  ['previousUnread', 13],
  ['roomList', 12],
];

/** A choice of a page and what choosing it does. */
type Choice = CommandPaletteChoice & { choose: () => void; preview?: () => () => void };

const choiceRows = (
  pageId: CommandPalettePageId,
  choices: readonly Choice[]
): Executable<CommandPaletteActionItem>[] =>
  getCommandPalettePageRows(pageId, choices).map((row, index) => ({
    ...row,
    onSelect: choices[index]?.choose,
    preview: choices[index]?.preview,
  }));

/**
 * The palette's rows that change things: every setting shown, the Theme, Message Layout and App
 * Language pages, a call to each voice agent of the open room, the open room header's commands,
 * and the shortcuts that have a handler. `room` is the open room, or the source's stand-in room
 * while none is open (`inRoom` false). Each row writes what the Settings page or button it stands
 * for writes, and the rows are rebuilt from the stored values, so a state shown is the stored one.
 */
export const useCommandPaletteCommands = ({
  room,
  inRoom,
  threadId,
}: CommandPaletteCommandsOptions): CommandPaletteCommands => {
  const { t, i18n } = useTranslation();
  const store = useStore();
  const settings = useAtomValue(settingsAtom);
  const { useSystemTheme } = useAtomValue(themeSettingsAtom);
  // The chosen theme, not the one shown for a look: the check mark stays on what is stored.
  const themeId = useChosenTheme().id;
  const languageCode = useAppLanguageCode();
  const searchValues = useSettingsSearchValues();
  // The context is a new object on every render; the settings it shows keep their list until
  // one of them comes or goes, so the rows and the search built on them stay too.
  const shownIds = getShownSettings(useSettingsContext())
    .map((setting) => setting.id)
    .join('\n');
  const shownSettings = useMemo(
    () => shownIds.split('\n').flatMap((id) => getSettingDefinition(id) ?? []),
    [shownIds]
  );
  // The agents the room header's call button offers. Hooks run with the stand-in room too; its
  // rows are left out below.
  const candidates = useAgentCallOffer(room, threadId);
  const { call } = useAgentCaller({ announce: true });
  // The header's commands and the shortcuts with a handler, read once as the palette opens: what
  // they belong to sits behind the palette while it is open.
  const [roomCommands] = useState(getRoomCommands);
  const [shortcutCommands] = useState(() =>
    SHORTCUT_COMMANDS.filter(([id]) => hasShortcutHandler(id))
  );
  // The steps to an unread room have nowhere to go while no room is unread.
  const someUnread = useAtomValue(roomToUnreadAtom).size > 0;

  const settingRows = useMemo(
    () =>
      getCommandPaletteSettingRows(shownSettings, settings, t, searchValues).map(
        ({ item, setting, switch: settingSwitch }): Executable<CommandPaletteActionItem> => ({
          ...item,
          onSelect: settingSwitch
            ? () => {
                const current = store.get(settingsAtom);
                store.set(settingsAtom, {
                  ...current,
                  [settingSwitch.key]: !current[settingSwitch.key],
                });
              }
            : () =>
                store.set(settingsModalAtom, {
                  initialPage: setting.page,
                  initialSetting: setting.id,
                  requestId: `palette:${setting.id}`,
                }),
        })
      ),
    [searchValues, settings, shownSettings, store, t]
  );

  const themePage = useMemo<CommandPalettePage>(() => {
    const choices = THEMES.map(
      (theme): Choice => ({
        value: theme.id,
        title: t(`options.themeName.${theme.name}`),
        current: theme.id === themeId,
        // As the fixed pick in Settings: the chosen theme, and the system theme off.
        choose: () =>
          store.set(settingsAtom, {
            ...store.get(settingsAtom),
            themeId: theme.id,
            useSystemTheme: false,
          }),
        // The whole app shows the highlighted theme; nothing is stored until it is chosen.
        preview: () => {
          store.set(themePreviewAtom, theme.id);
          return () => store.set(themePreviewAtom, undefined);
        },
      })
    );
    const systemTheme: Executable<CommandPaletteActionItem> = {
      id: 'theme:system',
      kind: 'action',
      title: t('settings.general.appearance.systemTheme'),
      icon: COMMAND_PALETTE_PAGE_ICONS.theme,
      state: useSystemTheme ? 'on' : 'off',
      keepOpen: true,
      sortRank: choices.length + 1,
      onSelect: () =>
        store.set(
          settingsAtom,
          withSystemTheme(
            store.get(settingsAtom),
            store.get(deploymentThemeAtom),
            !store.get(themeSettingsAtom).useSystemTheme
          )
        ),
    };
    return {
      title: t('settings.general.appearance.theme'),
      items: [systemTheme, ...choiceRows('theme', choices)],
    };
  }, [store, t, themeId, useSystemTheme]);

  const { messageLayout } = settings;
  const messageLayoutPage = useMemo<CommandPalettePage>(
    () => ({
      title: t('settings.general.messages.messageLayout'),
      items: choiceRows(
        'message-layout',
        LAYOUT_CHOICES.map(([layout, key]) => ({
          value: String(layout),
          title: t(key),
          current: layout === messageLayout,
          choose: () =>
            store.set(settingsAtom, { ...store.get(settingsAtom), messageLayout: layout }),
        }))
      ),
    }),
    [messageLayout, store, t]
  );

  const languagePage = useMemo<CommandPalettePage>(
    () => ({
      title: t('settings.general.language.appLanguage'),
      items: choiceRows(
        'language',
        APP_LANGUAGES.map(({ code, nativeName }) => ({
          value: code,
          title: nativeName,
          lang: code,
          current: code === languageCode,
          choose: () => {
            void i18n.changeLanguage(code);
          },
        }))
      ),
    }),
    [i18n, languageCode, t]
  );

  const pages = useMemo(
    () => ({ theme: themePage, 'message-layout': messageLayoutPage, language: languagePage }),
    [languagePage, messageLayoutPage, themePage]
  );

  // The settings, then the pages' choices as typed text finds them, each tagged with its page's
  // title.
  const commands = useMemo(
    () => [
      ...settingRows,
      ...[themePage, messageLayoutPage, languagePage].flatMap((page) =>
        tagCommandPalettePageRows(page.title, page.items)
      ),
    ],
    [languagePage, messageLayoutPage, settingRows, themePage]
  );

  const actions = useMemo(() => {
    // A call is about a conversation.
    const callRows = inRoom
      ? candidates.map(
          ({ userId, displayName }): Executable<CommandPaletteActionItem> => ({
            id: `call-agent:${userId}`,
            kind: 'action',
            title: t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: displayName }),
            description: room.name,
            icon: Icons.Phone,
            sortRank: 75,
            keywords: ['voice', 'agent'],
            // A call that does not start is reported by the account's call notices.
            onSelect: () => {
              void call({ agentUserId: userId, displayName, roomId: room.roomId, threadId });
            },
          })
        )
      : [];
    // The open room's header commands, so none without a room open. A room command closes the
    // palette: it was read once, so the palette could not show what the command changed. It runs
    // what the header offers under its name at that moment, and nothing once the header is gone:
    // what was read as the palette opened may belong to a room that is no longer the open one.
    const roomCommandRows = inRoom
      ? roomCommands.map(
          ({ id, label, icon, shortcut, pressed }): Executable<CommandPaletteActionItem> => ({
            id: `room-command:${id}`,
            kind: 'action',
            title: label,
            description: room.name,
            icon,
            shortcut,
            state: pressed === undefined ? undefined : pressed ? 'on' : 'off',
            sortRank: 45,
            onSelect: () =>
              getRoomCommands()
                .find((command) => command.id === id)
                ?.run(),
          })
        )
      : [];
    const shortcutRows = shortcutCommands
      .filter(([id]) => someUnread || (id !== 'nextUnread' && id !== 'previousUnread'))
      .map(
        ([id, sortRank]): Executable<CommandPaletteActionItem> => ({
          id: `shortcut:${id}`,
          kind: 'action',
          title: t(SHORTCUTS[id].labelKey),
          shortcut: id,
          sortRank,
          onSelect: () => {
            runShortcut(id, new KeyboardEvent('keydown'));
          },
        })
      );
    return [...callRows, ...roomCommandRows, ...shortcutRows];
  }, [call, candidates, inRoom, room, roomCommands, shortcutCommands, someUnread, t, threadId]);

  return useMemo(() => ({ actions, commands, pages }), [actions, commands, pages]);
};
