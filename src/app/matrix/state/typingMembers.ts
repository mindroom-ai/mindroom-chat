/**
 * Who is typing in each room. The server's `m.typing` lists everyone typing, and the SDK reports
 * only changes, so a member stays listed until a list without them arrives. While anyone is
 * listed, a check every `TYPING_TIMEOUT_MS` drops members of rooms that no longer receive
 * `m.typing` (for example a room the user left).
 */
import { useEffect } from 'react';
import { atom, type WritableAtom, useStore } from 'jotai';
import {
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type RoomMember,
  RoomMemberEvent,
} from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';

/** How long a typing notice lasts; also the interval of the stale-member check. */
export const TYPING_TIMEOUT_MS = 30_000;

export type TypingReceipt = {
  userId: string;
  /** When the member started typing, as this client saw it. */
  ts: number;
  /** Whether the member still types, read from the live room. */
  isTyping: () => boolean;
};

type RoomIdToTypingMembers = Map<string, TypingReceipt[]>;

type TypingMembersAction =
  | {
      type: 'PUT';
      roomId: string;
      userId: string;
      ts: number;
      isTyping: () => boolean;
    }
  | { type: 'DELETE'; roomId: string; userId: string }
  /** Drops every receipt whose member stopped typing. */
  | { type: 'PRUNE' }
  | { type: 'RESET' };

type TypingMembersAtom = WritableAtom<RoomIdToTypingMembers, [TypingMembersAction], void>;

const typingMembersAtom = atom<RoomIdToTypingMembers>(new Map());

export const roomIdToTypingMembersAtom: TypingMembersAtom = atom<
  RoomIdToTypingMembers,
  [TypingMembersAction],
  void
>(
  (get) => get(typingMembersAtom),
  (get, set, action) => {
    const current = get(typingMembersAtom);
    if (action.type === 'RESET') {
      if (current.size > 0) set(typingMembersAtom, new Map());
      return;
    }
    if (action.type === 'PRUNE') {
      let changed = false;
      const next: RoomIdToTypingMembers = new Map();
      current.forEach((receipts, roomId) => {
        const typing = receipts.filter((receipt) => receipt.isTyping());
        if (typing.length !== receipts.length) changed = true;
        if (typing.length > 0) next.set(roomId, typing);
      });
      if (changed) set(typingMembersAtom, next);
      return;
    }

    const receipts = current.get(action.roomId) ?? [];
    const others = receipts.filter((receipt) => receipt.userId !== action.userId);
    const next = new Map(current);
    if (action.type === 'PUT') {
      next.set(action.roomId, [
        ...others,
        { userId: action.userId, ts: action.ts, isTyping: action.isTyping },
      ]);
    } else {
      if (others.length === receipts.length) return;
      if (others.length > 0) next.set(action.roomId, others);
      else next.delete(action.roomId);
    }
    set(typingMembersAtom, next);
  }
);

const isStillTyping = (mx: MatrixClient, roomId: string, userId: string): boolean => {
  const room = mx.getRoom(roomId);
  if (!room || !matchesEnum(room.getMyMembership(), KnownMembership.Join)) return false;
  return room.getMember(userId)?.typing === true;
};

/** Follows the account's typing notices; clears what the previous account left. */
export const useBindRoomIdToTypingMembersAtom = (
  mx: MatrixClient,
  typingAtom: TypingMembersAtom = roomIdToTypingMembersAtom
) => {
  const store = useStore();

  useEffect(() => {
    store.set(typingAtom, { type: 'RESET' });
    let checkTimer: ReturnType<typeof setTimeout> | undefined;

    const stopChecking = () => {
      if (checkTimer === undefined) return;
      clearTimeout(checkTimer);
      checkTimer = undefined;
    };
    const scheduleCheck = () => {
      if (checkTimer !== undefined) return;
      checkTimer = setTimeout(() => {
        checkTimer = undefined;
        store.set(typingAtom, { type: 'PRUNE' });
        if (store.get(typingAtom).size > 0) scheduleCheck();
      }, TYPING_TIMEOUT_MS);
    };

    const handleTyping = (_event: MatrixEvent, member: RoomMember) => {
      const { roomId, userId } = member;
      if (userId === mx.getUserId()) return;
      if (member.typing) {
        store.set(typingAtom, {
          type: 'PUT',
          roomId,
          userId,
          ts: Date.now(),
          isTyping: () => isStillTyping(mx, roomId, userId),
        });
        scheduleCheck();
        return;
      }
      store.set(typingAtom, { type: 'DELETE', roomId, userId });
      if (store.get(typingAtom).size === 0) stopChecking();
    };

    mx.on(RoomMemberEvent.Typing, handleTyping);
    return () => {
      mx.removeListener(RoomMemberEvent.Typing, handleTyping);
      stopChecking();
      store.set(typingAtom, { type: 'RESET' });
    };
  }, [mx, store, typingAtom]);
};
