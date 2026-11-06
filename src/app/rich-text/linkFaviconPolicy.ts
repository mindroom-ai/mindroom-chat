import type { ChildNode } from 'domhandler';
import { Element } from 'html-react-parser';
import type { Settings } from '../preferences/settings';

// Each icon is a request to a third party that names the linked site, so encrypted rooms never
// show icons; the deployment also has to allow them (RenderBody's LinkFaviconContext).
export const shouldShowLinkFavicons = (
  {
    mediaAutoLoad = false,
    urlPreview = false,
  }: Partial<Pick<Settings, 'mediaAutoLoad' | 'urlPreview'>>,
  encrypted: boolean
): boolean => !encrypted && mediaAutoLoad === true && urlPreview === true;

export const containsSpoiler = (nodes: ChildNode[]): boolean =>
  nodes.some(
    (node) =>
      node instanceof Element &&
      ('data-mx-spoiler' in node.attribs || containsSpoiler(node.children))
  );
