/** `m.space.child` content. */
type SpaceChildContent = {
  via: string[];
  order?: string;
  suggested?: boolean;
};

/** Fields every lobby entry carries, whether it is a space or a room. */
type LobbyEntryFields = {
  roomId: string;
  content: SpaceChildContent;
  /** When the child was added (the child event's timestamp). */
  ts: number;
  /** Nesting below the top space; 0 for the top space itself. */
  depth?: number;
};

/**
 * One entry of a space's lobby: a space or a room below it. Only the top space has no parent;
 * every other entry names the space it sits in.
 */
export type HierarchyItem =
  | (LobbyEntryFields & { space: true; parentId?: string })
  | (LobbyEntryFields & { space?: false; parentId: string });
