import { atom } from 'jotai';
import type { DesktopPairInvite } from './desktopPairingProtocol';

export type IncomingPairInvite = {
  invite: DesktopPairInvite;
  senderDeviceId: string;
  senderEd25519: string;
  receivedAt: number;
};

/** Incoming verified browser-to-Mac pairing invite awaiting user consent on this Mac. */
export const incomingPairInviteAtom = atom<IncomingPairInvite | null>(null);
