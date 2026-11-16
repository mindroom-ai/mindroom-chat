import { useEffect, useRef } from 'react';
import type { IconSrc } from 'folds';
import type { ShortcutId } from '../shortcuts/shortcuts';

/** An action of the open room's header, which the command palette offers. */
export type RoomCommand = {
  id: string;
  label: string;
  icon: IconSrc;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  shortcut?: ShortcutId;
  run: () => void;
};

type CommandsRef = { current: readonly RoomCommand[] };

const NONE: readonly RoomCommand[] = [];
const offered: CommandsRef[] = [];

/** Offers `commands` while the calling component is mounted; the one mounted last is the one read. */
export const useRoomCommands = (commands: readonly RoomCommand[]): void => {
  const ref = useRef(commands);
  ref.current = commands;
  useEffect(() => {
    offered.push(ref);
    return () => {
      const index = offered.indexOf(ref);
      if (index >= 0) offered.splice(index, 1);
    };
  }, []);
};

/** The commands of the room header on screen now; none without one. */
export const getRoomCommands = (): readonly RoomCommand[] => offered.at(-1)?.current ?? NONE;
