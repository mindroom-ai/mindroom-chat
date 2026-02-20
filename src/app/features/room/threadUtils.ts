type ThreadEventLike = {
  getId(): string | undefined;
  threadRootId?: string;
};

export const eventBelongsToThread = (event: ThreadEventLike, threadId: string): boolean =>
  event.getId() === threadId || event.threadRootId === threadId;
