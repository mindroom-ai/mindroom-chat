import type { MatrixEvent } from 'matrix-js-sdk';
import type { IImageInfo } from '../../../types/matrix/common';
import { ImageUsage, PackAddress, PackContent, PackImage, PackMeta } from './types';

const ALL_USAGES: ImageUsage[] = [ImageUsage.Emoticon, ImageUsage.Sticker];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The known usages in `value`, or undefined when it names none. */
const readUsage = (value: unknown): ImageUsage[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const usage = ALL_USAGES.filter((known) => value.includes(known));
  return usage.length > 0 ? usage : undefined;
};

/** The pack's name, avatar and default usage, read defensively from any content. */
export class PackMetaReader {
  readonly meta: PackMeta;

  constructor(meta: unknown) {
    this.meta = isRecord(meta) ? (meta as PackMeta) : {};
  }

  get name(): string | undefined {
    const name = this.meta.display_name;
    return typeof name === 'string' && name.trim() !== '' ? name : undefined;
  }

  get avatar(): string | undefined {
    const avatar = this.meta.avatar_url;
    return typeof avatar === 'string' && avatar !== '' ? avatar : undefined;
  }

  get attribution(): string | undefined {
    const attribution = this.meta.attribution;
    return typeof attribution === 'string' && attribution !== '' ? attribution : undefined;
  }

  /** What the pack's images are used as unless an image says otherwise. */
  get usage(): ImageUsage[] {
    return readUsage(this.meta.usage) ?? ALL_USAGES;
  }
}

/** One image of a pack. */
export class PackImageReader {
  readonly shortcode: string;

  readonly image: PackImage;

  private readonly packUsage: ImageUsage[];

  constructor(shortcode: string, image: PackImage, packUsage: ImageUsage[]) {
    this.shortcode = shortcode;
    this.image = image;
    this.packUsage = packUsage;
  }

  get url(): string {
    return this.image.url;
  }

  /** The description to show for the image, such as its alt text. */
  get body(): string | undefined {
    const { body } = this.image;
    return typeof body === 'string' && body !== '' ? body : undefined;
  }

  get info(): IImageInfo | undefined {
    return isRecord(this.image.info) ? this.image.info : undefined;
  }

  /** What this image is used as: its own usage, else the pack's. */
  get usage(): ImageUsage[] {
    return readUsage(this.image.usage) ?? this.packUsage;
  }
}

/**
 * The images of a pack by shortcode. Anyone who may edit a shared pack can publish any JSON, so
 * entries that are not objects with a URL are left out rather than breaking every picker.
 */
export class PackImagesReader {
  readonly collection: Map<string, PackImageReader>;

  constructor(images: unknown, packUsage: ImageUsage[]) {
    this.collection = new Map();
    if (!isRecord(images)) return;
    Object.keys(images).forEach((shortcode) => {
      const image = images[shortcode];
      if (!isRecord(image) || typeof image.url !== 'string' || image.url === '') return;
      this.collection.set(shortcode, new PackImageReader(shortcode, image as PackImage, packUsage));
    });
  }

  getImages(usage: ImageUsage): PackImageReader[] {
    return [...this.collection.values()].filter((image) => image.usage.includes(usage));
  }
}

/**
 * An image pack: a room pack (with its `address`) or the user's own pack (without one). `id`
 * tells packs apart, such as the pack event's ID or the user's ID.
 */
export class ImagePack {
  readonly id: string;

  readonly content: PackContent;

  readonly address: PackAddress | undefined;

  readonly meta: PackMetaReader;

  readonly images: PackImagesReader;

  constructor(id: string, content: PackContent, address: PackAddress | undefined) {
    this.id = id;
    this.content = isRecord(content) ? content : {};
    this.address = address;
    this.meta = new PackMetaReader(this.content.pack);
    this.images = new PackImagesReader(this.content.images, this.meta.usage);
  }

  /** A pack from its state event (a room pack) or account data event (the user's pack). */
  static fromMatrixEvent(id: string, event: MatrixEvent): ImagePack {
    const roomId = event.getRoomId();
    const stateKey = event.getStateKey();
    const address = roomId && stateKey !== undefined ? { roomId, stateKey } : undefined;
    return new ImagePack(id, event.getContent<PackContent>(), address);
  }

  /** Whether the pack was deleted: its event has neither `pack` nor `images`. */
  get deleted(): boolean {
    return this.content.pack === undefined && this.content.images === undefined;
  }

  getImages(usage: ImageUsage): PackImageReader[] {
    return this.images.getImages(usage);
  }

  /** The pack's avatar, else its first image for that usage. */
  getAvatarUrl(usage: ImageUsage): string | undefined {
    return this.meta.avatar ?? this.getImages(usage)[0]?.url;
  }
}
