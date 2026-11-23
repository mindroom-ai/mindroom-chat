type OrderGroup<Id extends string> = { id: Id; rootIds: string[] };

/**
 * New cards that the live order puts before all survivors lead the list, so a newest-first
 * list still shows arrivals at the top. Those after all survivors go last; those in between
 * follow their live predecessor without reordering the cards already shown.
 */
const holdOrder = (shownIds: readonly string[], liveIds: readonly string[]): string[] => {
  const live = new Set(liveIds);
  const kept = shownIds.filter((id) => live.has(id));
  const keptIds = new Set(kept);
  const firstKept = liveIds.findIndex((id) => keptIds.has(id));
  const lastKept = liveIds.findLastIndex((id) => keptIds.has(id));
  const leading: string[] = [];
  const trailing: string[] = [];
  liveIds.forEach((id, index) => {
    if (keptIds.has(id)) return;
    if (firstKept === -1 || index < firstKept) leading.push(id);
    else if (index > lastKept) trailing.push(id);
    else kept.splice(kept.indexOf(liveIds[index - 1] ?? '') + 1, 0, id);
  });
  return [...leading, ...kept, ...trailing];
};

/**
 * While held, keep each surviving card in its own shown group and order so it cannot move under
 * the pointer. A new card joins its live group. A shown header stays even if its group empties.
 * Use the fixed group order because the live list omits empty sections.
 */
export const step = <Id extends string>(
  shown: readonly OrderGroup<Id>[],
  live: OrderGroup<Id>[],
  held: boolean,
  groupOrder: readonly Id[]
): OrderGroup<Id>[] => {
  if (!held) return live;
  const shownIn = new Map(
    shown.flatMap(({ id, rootIds }) => rootIds.map((rootId) => [rootId, id] as const))
  );
  return groupOrder.flatMap((id) => {
    const members = live.flatMap((group) =>
      group.rootIds.filter((rootId) => (shownIn.get(rootId) ?? group.id) === id)
    );
    const shownGroup = shown.find((group) => group.id === id);
    if (!shownGroup) return members.length > 0 ? [{ id, rootIds: members }] : [];
    return [{ id, rootIds: holdOrder(shownGroup.rootIds, members) }];
  });
};
