import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { roomIdToTypingMembersAtom, TypingReceipt } from '../state/typingMembers';

const EMPTY: TypingReceipt[] = [];

/** Who is typing in the room, from the typing notices the client received. */
export const useRoomTypingMember = (roomId: string): TypingReceipt[] => {
  const typingAtom = useMemo(
    () => selectAtom(roomIdToTypingMembersAtom, (typing) => typing.get(roomId) ?? EMPTY),
    [roomId]
  );
  return useAtomValue(typingAtom);
};
