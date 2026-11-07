/** Room ID to the IDs of the Spaces and chat rooms that list it as a child (`roomToParentsAtom`). */
type ParentsByRoom = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The Spaces above `roomId` at any depth, nearest first (parents, then grandparents), with the
 * chat rooms a sub-room sits under. A loop in the tree ends the walk; the room itself is never
 * listed.
 */
export const getAncestorSpaceIds = (parentsByRoom: ParentsByRoom, roomId: string): string[] => {
  const ancestors: string[] = [];
  const seen = new Set([roomId]);
  const visit = (id: string) =>
    parentsByRoom.get(id)?.forEach((parent) => {
      if (seen.has(parent)) return;
      seen.add(parent);
      ancestors.push(parent);
    });
  visit(roomId);
  // The list grows while it is read: each Space's parents go to its end, and get visited too.
  for (const id of ancestors) visit(id);
  return ancestors;
};

/** Whether `roomId` sits in `spaceId`, directly or through nested Spaces. */
export const isInSpace = (parentsByRoom: ParentsByRoom, roomId: string, spaceId: string): boolean =>
  getAncestorSpaceIds(parentsByRoom, roomId).includes(spaceId);
