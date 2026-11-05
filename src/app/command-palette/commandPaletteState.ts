import { atom } from 'jotai';
import type { CommandPaletteTab } from './commandPaletteTypes';

/** The tab the open palette starts on; undefined while it is closed. */
export const commandPaletteOpenAtom = atom<CommandPaletteTab | undefined>(undefined);
