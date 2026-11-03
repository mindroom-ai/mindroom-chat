import { atom } from 'jotai';
import type { CallEmbed } from '../plugins/call';

/** The call this tab has joined, if any; at most one call runs at a time. */
export const callEmbedAtom = atom<CallEmbed | undefined>(undefined);
