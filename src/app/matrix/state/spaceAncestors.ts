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
  // The list grows while it is read: each parent's parents go to its end, and get visited too.
  for (const id of ancestors) visit(id);
  return ancestors;
};

/** Whether `roomId` sits in `spaceId`, directly or through nested Spaces and chat rooms. */
export const isInSpace = (parentsByRoom: ParentsByRoom, roomId: string, spaceId: string): boolean =>
  getAncestorSpaceIds(parentsByRoom, roomId).includes(spaceId);

/**
 * Whether `roomId` reaches a parent matching `isTarget` directly or solely through parents
 * matching `canTraverse` (never crossing through another space).
 */
export const reachesSpaceDirectly = (
  roomId: string,
  parentsByRoom: ParentsByRoom,
  isTarget: (parentId: string) => boolean,
  canTraverse: (parentId: string) => boolean
): boolean => {
  const visited = new Set<string>([roomId]);
  const queue = [roomId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const parents = current ? parentsByRoom.get(current) : undefined;
    if (!parents) continue;
    for (const parentId of parents) {
      if (isTarget(parentId)) return true;
      if (visited.has(parentId) || !canTraverse(parentId)) continue;
      visited.add(parentId);
      queue.push(parentId);
    }
  }
  return false;
};
