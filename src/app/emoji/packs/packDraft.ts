import {
  ImageUsage,
  type PackContent,
  type PackImage,
  type PackImages,
  type PackMeta,
} from '../custom';

// Edits to an image pack before they are applied. Every function returns new content and keeps
// the fields it does not touch, including ones this client does not know.

/** How images of a pack (or one image) are used; `both` is also what no `usage` means. */
export type UsageOption = 'emoticon' | 'sticker' | 'both';

export const usageToOption = (usage: readonly string[] | undefined): UsageOption => {
  const emoticon = usage?.includes(ImageUsage.Emoticon);
  const sticker = usage?.includes(ImageUsage.Sticker);
  if (emoticon && !sticker) return 'emoticon';
  if (sticker && !emoticon) return 'sticker';
  return 'both';
};

export const optionToUsage = (option: UsageOption): ImageUsage[] => {
  if (option === 'emoticon') return [ImageUsage.Emoticon];
  if (option === 'sticker') return [ImageUsage.Sticker];
  return [ImageUsage.Emoticon, ImageUsage.Sticker];
};

/**
 * A shortcode other clients can type between colons: not empty, and without whitespace or
 * colons.
 */
export const isValidShortcode = (shortcode: string): boolean => /^[^\s:]+$/.test(shortcode);

const imagesOf = (pack: PackContent): PackImages =>
  pack.images && typeof pack.images === 'object' ? pack.images : {};

/** `wanted`, or `wanted-2`, `wanted-3` and so on: the first one `taken` does not hold. */
export const freeShortcode = (taken: ReadonlySet<string>, wanted: string): string => {
  const base = wanted || 'image';
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

/** The pack with `images` added after its own; a shortcode already in use gets a suffix. */
export const addPackImages = (
  pack: PackContent,
  images: ReadonlyArray<{ shortcode: string; image: PackImage }>
): PackContent => {
  const next: PackImages = { ...imagesOf(pack) };
  const taken = new Set(Object.keys(next));
  images.forEach(({ shortcode, image }) => {
    const free = freeShortcode(taken, shortcode);
    taken.add(free);
    next[free] = image;
  });
  return { ...pack, images: next };
};

/** What the edit form of one image changes. */
export type PackImageChanges = {
  shortcode: string;
  body: string;
  /** `undefined` follows the pack's usage. */
  usage: UsageOption | undefined;
};

/**
 * The pack with the image under `from` changed: renamed in place (the order stays), its body
 * (an empty one removed) and its own usage (removed to follow the pack). Returns undefined when
 * another image has the new shortcode.
 */
export const changePackImage = (
  pack: PackContent,
  from: string,
  changes: PackImageChanges
): PackContent | undefined => {
  const images = imagesOf(pack);
  const current = images[from];
  if (!current) return pack;
  if (changes.shortcode !== from && Object.prototype.hasOwnProperty.call(images, changes.shortcode))
    return undefined;

  const changed: PackImage = { ...current };
  delete changed.body;
  delete changed.usage;
  const body = changes.body.trim();
  if (body) changed.body = body;
  if (changes.usage) changed.usage = optionToUsage(changes.usage);
  const next: PackImages = {};
  Object.entries(images).forEach(([shortcode, image]) => {
    if (shortcode === from) next[changes.shortcode] = changed;
    else next[shortcode] = image;
  });
  return { ...pack, images: next };
};

/** The pack without the images under `shortcodes`. */
export const removePackImages = (
  pack: PackContent,
  shortcodes: ReadonlySet<string>
): PackContent => {
  if (shortcodes.size === 0) return pack;
  const next: PackImages = {};
  Object.entries(imagesOf(pack)).forEach(([shortcode, image]) => {
    if (!shortcodes.has(shortcode)) next[shortcode] = image;
  });
  return { ...pack, images: next };
};

/** What the pack details form changes; an empty string removes the field. */
export type PackMetaChanges = {
  name: string;
  attribution: string;
  avatarUrl: string | undefined;
};

/** The pack with its name, attribution and avatar set; its usage and other fields stay. */
export const changePackMeta = (pack: PackContent, changes: PackMetaChanges): PackContent => {
  const meta: PackMeta = { ...pack.pack };
  delete meta.display_name;
  delete meta.avatar_url;
  delete meta.attribution;
  const name = changes.name.trim();
  const attribution = changes.attribution.trim();
  if (name) meta.display_name = name;
  if (changes.avatarUrl) meta.avatar_url = changes.avatarUrl;
  if (attribution) meta.attribution = attribution;
  return { ...pack, pack: meta };
};
