import type { ChildNode } from 'domhandler';
import { Element } from 'html-react-parser';
import type { Settings } from '../preferences/settings';

export const shouldShowLinkFavicons = (
  {
    mediaAutoLoad = false,
    urlPreview = false,
    encUrlPreview = false,
  }: Partial<Pick<Settings, 'mediaAutoLoad' | 'urlPreview' | 'encUrlPreview'>>,
  encrypted: boolean
): boolean => mediaAutoLoad === true && (encrypted ? encUrlPreview === true : urlPreview === true);

export const containsSpoiler = (nodes: ChildNode[]): boolean =>
  nodes.some(
    (node) =>
      node instanceof Element &&
      ('data-mx-spoiler' in node.attribs || containsSpoiler(node.children))
  );
