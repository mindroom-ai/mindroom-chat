import produce from 'immer';
import { atom, useSetAtom } from 'jotai';
import { MatrixClient, RoomMemberEvent, RoomMemberEventHandlerMap } from 'matrix-js-sdk';
import { useEffect } from 'react';
import { useSetting } from './hooks/settings';
import { settingsAtom } from './settings';

export const TYPING_TIMEOUT_MS = 5000; // 5 seconds

export type TypingReceipt = {
  userId: string;
  ts: number;
};
export type IRoomIdToTypingMembers = Map<string, TypingReceipt[]>;

type TypingMemberPutAction = {
  type: 'PUT';
  roomId: string;
  userId: string;
  ts: number;
  // Whether the SDK still reports the member as typing.
  isTyping: () => boolean;
};
type TypingMemberDeleteAction = {
  type: 'DELETE';
  roomId: string;
  userId: string;
};
type TypingMembersResetAction = {
  type: 'RESET';
};
export type IRoomIdToTypingMembersAction =
  | TypingMemberPutAction
  | TypingMemberDeleteAction
  | TypingMembersResetAction;

const baseRoomIdToTypingMembersAtom = atom<IRoomIdToTypingMembers>(new Map());

const putTypingMember = (
  roomToMembers: IRoomIdToTypingMembers,
  action: TypingMemberPutAction
): IRoomIdToTypingMembers => {
  let typingMembers = roomToMembers.get(action.roomId) ?? [];

  typingMembers = typingMembers.filter((receipt) => receipt.userId !== action.userId);
  typingMembers.push({
    userId: action.userId,
    ts: action.ts,
  });
  roomToMembers.set(action.roomId, typingMembers);
  return roomToMembers;
};

const deleteTypingMember = (
  roomToMembers: IRoomIdToTypingMembers,
  action: TypingMemberDeleteAction
): IRoomIdToTypingMembers => {
  let typingMembers = roomToMembers.get(action.roomId) ?? [];

  typingMembers = typingMembers.filter((receipt) => receipt.userId !== action.userId);
  if (typingMembers.length === 0) {
    roomToMembers.delete(action.roomId);
  } else {
    roomToMembers.set(action.roomId, typingMembers);
  }
  return roomToMembers;
};

export const roomIdToTypingMembersAtom = atom<
  IRoomIdToTypingMembers,
  [IRoomIdToTypingMembersAction],
  undefined
>(
  (get) => get(baseRoomIdToTypingMembersAtom),
  (get, set, action) => {
    if (action.type === 'RESET') {
      set(baseRoomIdToTypingMembersAtom, new Map());
      return;
    }

    const rToTyping = get(baseRoomIdToTypingMembersAtom);

    if (action.type === 'PUT') {
      set(
        baseRoomIdToTypingMembersAtom,
        produce(rToTyping, (draft) => putTypingMember(draft, action))
      );

      // Keep the receipt while the SDK reports the member as typing: the SDK emits
      // only changes, and the server times typing out itself. A gappy sync swaps in
      // fresh, non-typing members without an event, so recheck to avoid a stuck one.
      const { roomId, userId, ts, isTyping } = action;
      const expire = () => {
        const receipts = get(baseRoomIdToTypingMembersAtom).get(roomId);
        if (receipts?.find((receipt) => receipt.userId === userId)?.ts !== ts) return;
        if (isTyping()) {
          setTimeout(expire, TYPING_TIMEOUT_MS);
          return;
        }
        set(
          baseRoomIdToTypingMembersAtom,
          produce(get(baseRoomIdToTypingMembersAtom), (draft) =>
            deleteTypingMember(draft, { type: 'DELETE', roomId, userId })
          )
        );
      };
      setTimeout(expire, TYPING_TIMEOUT_MS);
    }

    if (
      action.type === 'DELETE' &&
      rToTyping.get(action.roomId)?.find((receipt) => receipt.userId === action.userId)
    ) {
      set(
        baseRoomIdToTypingMembersAtom,
        produce(rToTyping, (draft) => deleteTypingMember(draft, action))
      );
    }
  }
);

export const useBindRoomIdToTypingMembersAtom = (
  mx: MatrixClient,
  typingMembersAtom: typeof roomIdToTypingMembersAtom
) => {
  const setTypingMembers = useSetAtom(typingMembersAtom);
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  useEffect(() => {
    setTypingMembers({ type: 'RESET' });

    const handleTypingEvent: RoomMemberEventHandlerMap[RoomMemberEvent.Typing] = (
      event,
      member
    ) => {
      if (hideActivity) {
        return;
      }
      setTypingMembers({
        type: member.typing ? 'PUT' : 'DELETE',
        roomId: member.roomId,
        userId: member.userId,
        ts: Date.now(),
        isTyping: () => mx.getRoom(member.roomId)?.getMember(member.userId)?.typing === true,
      });
    };

    mx.on(RoomMemberEvent.Typing, handleTypingEvent);
    return () => {
      mx.removeListener(RoomMemberEvent.Typing, handleTypingEvent);
    };
  }, [mx, setTypingMembers, hideActivity]);
};
