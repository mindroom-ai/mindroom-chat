/** `m.space.child` content. */
type SpaceChildContent = {
  via: string[];
  order?: string;
  suggested?: boolean;
};

type HierarchyItemBase = {
  roomId: string;
  content: SpaceChildContent;
  /** When the child was added (the child event's timestamp). */
  ts: number;
  /** Nesting below the top space; 0 for the top space itself. */
  depth?: number;
};

type HierarchyItemSpace = HierarchyItemBase & {
  space: true;
  parentId?: string;
};

type HierarchyItemRoom = HierarchyItemBase & {






