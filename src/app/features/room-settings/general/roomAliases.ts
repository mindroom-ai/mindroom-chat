/**
 * `m.room.canonical_alias` content (Matrix spec): `alias`, the main published address, and
 * `alt_aliases`, the other published ones. These helpers return the content after one change.
 */
export type PublishedAliases = { alias?: string; alt_aliases?: string[] };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The published addresses in `content`, main first, each once. */
export const readPublished = (content: Record<string, unknown> | undefined): string[] => {
  const main = typeof content?.alias === 'string' && content.alias ? [content.alias] : [];
  return [...new Set([...main, ...strings(content?.alt_aliases)])];
};

export const readMain = (content: Record<string, unknown> | undefined): string | undefined =>
  typeof content?.alias === 'string' && content.alias ? content.alias : undefined;

const build = (main: string | undefined, others: string[]): PublishedAliases => {
  const rest = [...new Set(others.filter((alias) => alias !== main))];
  const next: PublishedAliases = {};
  if (main) next.alias = main;
  if (rest.length > 0) next.alt_aliases = rest;
  return next;
};

const others = (content: Record<string, unknown> | undefined) => strings(content?.alt_aliases);

/** Publishes `alias`; the first published address becomes the main one. */
export const publishAlias = (
  content: Record<string, unknown> | undefined,
  alias: string
): PublishedAliases => {
  const main = readMain(content);
  return main ? build(main, [...others(content), alias]) : build(alias, others(content));
};

/** Stops publishing `alias`, main or not. */
export const unpublishAlias = (
  content: Record<string, unknown> | undefined,
  alias: string
): PublishedAliases => {
  const main = readMain(content);
  return build(
    main === alias ? undefined : main,
    others(content).filter((item) => item !== alias)
  );
};

/** Makes `alias` the main address; the previous main one stays published. */
export const setMainAlias = (
  content: Record<string, unknown> | undefined,
  alias: string
): PublishedAliases => {
  const main = readMain(content);
  return build(alias, [...(main ? [main] : []), ...others(content)]);
};

/** Keeps the main address published, but no longer as the main one. */
export const unsetMainAlias = (content: Record<string, unknown> | undefined): PublishedAliases => {
  const main = readMain(content);
  return build(undefined, [...(main ? [main] : []), ...others(content)]);
};
