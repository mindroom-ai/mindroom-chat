import { find as findLinks } from 'linkifyjs';

// Finding links tokenizes the whole body, which costs far more than rendering a short message.
// A message renders again on every update of its row and mounts again each time it scrolls back
// into a virtualized list, with the same body, so the answer is kept for recent bodies.
const MAX_CACHED_BODIES = 500;
const cache = new Map<string, string[]>();

/** The http(s) URLs in a message body, once each, in order: the candidates for link previews. */
export const getBodyUrls = (body: string): string[] => {
  const cached = cache.get(body);
  if (cached) return cached;
  const urls = Array.from(
    new Set(
      findLinks(body)
        .filter((link) => link.isLink && link.type === 'url' && /^https?:/i.test(link.href))
        .map((link) => link.href)
    )
  );
  if (cache.size >= MAX_CACHED_BODIES) cache.delete(cache.keys().next().value as string);
  cache.set(body, urls);
  return urls;
};
