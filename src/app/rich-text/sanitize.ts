import sanitizeHtml, { type IOptions, type Transformer } from 'sanitize-html';

/** Escapes text for use as HTML content or a quoted attribute value. */
export const sanitizeText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// The tags and attributes the Matrix specification recommends for `org.matrix.custom.html`
// (client-server API, "m.room.message msgtypes"), grouped by role and alphabetical inside a
// group. `strike` and `font` are deprecated there but still arrive from older clients. The
// attributes add `data-md`, which records the Markdown that produced an element so the composer
// can turn a message back into Markdown when editing.
const INLINE_TAGS = ['b', 'code', 'del', 'em', 'font', 'i', 's', 'span', 'strike', 'strong', 'u'];
const SCRIPT_TAGS = ['sub', 'sup'];
const BLOCK_TAGS = ['blockquote', 'br', 'details', 'div', 'hr', 'p', 'pre', 'summary'];
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const LIST_TAGS = ['li', 'ol', 'ul'];
const TABLE_TAGS = ['caption', 'table', 'tbody', 'td', 'th', 'thead', 'tr'];
const EMBED_TAGS = ['a', 'img'];
const FORMATTING_TAGS = [
  ...INLINE_TAGS,
  ...SCRIPT_TAGS,
  ...BLOCK_TAGS,
  ...HEADING_TAGS,
  ...LIST_TAGS,
  ...TABLE_TAGS,
  ...EMBED_TAGS,
];

// Colour attributes of `font` and `span`; `colorToStyle` turns them into inline CSS.
const MATRIX_COLOR_ATTRIBUTES = ['data-mx-bg-color', 'data-mx-color'];

const PERMITTED_URL_SCHEMES = ['https', 'http', 'ftp', 'mailto', 'magnet'];
// Schemes a deployment may never add: they run script, read local files or embed documents.
const FORBIDDEN_URL_SCHEMES = new Set([
  'javascript',
  'vbscript',
  'data',
  'file',
  'blob',
  'about',
  'filesystem',
  'jar',
  'view-source',
  'chrome',
  'resource',
]);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const withDataMd = (tags: string[]): Record<string, string[]> =>
  Object.fromEntries(tags.map((tag) => [tag, ['data-md']]));

const BASE_ATTRIBUTES: Record<string, string[]> = {
  ...withDataMd(['b', 'i', 'u', 'strong', 'em', 'del', 's', 'strike', 'code', 'pre', 'blockquote']),
  ...withDataMd(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'p', 'hr']),
  font: [...MATRIX_COLOR_ATTRIBUTES, 'color', 'style', 'data-md'],
  span: [...MATRIX_COLOR_ATTRIBUTES, 'data-md', 'data-mx-spoiler', 'style'],
  // `rel` and `target` are kept for the values `linkInNewTab` writes.
  a: ['data-md', 'href', 'name', 'rel', 'target'],
  img: ['alt', 'data-mx-emoticon', 'height', 'src', 'title', 'width'],
  ol: ['data-md', 'start'],
  // `data-label` names a code block (the label row above it).
  code: ['class', 'data-md', 'data-label'],
  div: ['data-md'],
  details: ['open'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
};

const PASTE_MARKER_ATTRIBUTES = [
  'data-mindroom-paste-marker',
  'data-mindroom-paste-id',
  'data-mindroom-paste-chars',
  'data-mindroom-paste-file',
];

/**
 * What MindRoom messages need on top of the Matrix formatting tags: the agents' block tags
 * (`<think>`, `<plan>`, ...; rendered as collapsible blocks), Matrix math (`data-mx-maths`), and
 * the paste attachment markers the composer writes. Styles, URL schemes and the link
 * transformers stay the base rules'.
 */
export const customHtmlSanitizerPolicy: {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
} = {
  allowedTags: ['think', 'debug', 'system', 'plan', 'analysis', 'research'],
  allowedAttributes: {
    span: ['data-mx-maths', ...PASTE_MARKER_ATTRIBUTES],
    div: ['data-mx-maths'],
  },
};

const BASE_STYLES: Record<string, Record<string, RegExp[]>> = {
  '*': {
    color: [HEX_COLOR],
    'background-color': [HEX_COLOR],
  },
};

// A Matrix colour attribute becomes the CSS the renderer shows; other values are dropped.
const colorToStyle: Transformer = (tagName, attribs) => {
  const declarations: string[] = [];
  const color = attribs['data-mx-color'] ?? (tagName === 'font' ? attribs.color : undefined);
  const background = attribs['data-mx-bg-color'];
  if (color && HEX_COLOR.test(color)) declarations.push(`color:${color}`);
  if (background && HEX_COLOR.test(background)) declarations.push(`background-color:${background}`);
  if (attribs.style) declarations.push(attribs.style);
  return {
    tagName,
    attribs: declarations.length ? { ...attribs, style: declarations.join(';') } : attribs,
  };
};

const linkInNewTab: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: { ...attribs, target: '_blank', rel: 'noreferrer noopener' },
});

// Images come only from the media repository (`mxc://`); a relative or other URL would make every
// reader's browser fetch from wherever the sender chose.
const mxcImageOnly: Transformer = (tagName, attribs) => {
  if (/^mxc:\/\//i.test(attribs.src ?? '')) return { tagName, attribs };
  const { src: _src, ...rest } = attribs;
  return { tagName, attribs: rest };
};

/** The URL an image's non-`mxc://` source loads from, or undefined to drop the image. */
type ImageSource = (src: string) => string | undefined;

// `value` as an absolute `https:` URL without a username or password, or undefined.
const httpsImageUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
};

// With a caller's `imageSource`, an image whose source is not `mxc://` keeps the URL it returns
// for that source, when that is an absolute `https:` URL without credentials; otherwise it has none.
const mappedImage =
  (imageSource: ImageSource): Transformer =>
  (tagName, attribs) => {
    const src = attribs.src ?? '';
    if (/^mxc:\/\//i.test(src)) return { tagName, attribs };
    const { src: _src, ...rest } = attribs;
    const mapped = src ? httpsImageUrl(imageSource(src)) : undefined;
    return { tagName, attribs: mapped ? { ...rest, src: mapped } : rest };
  };

const BASE_TRANSFORMS: Record<string, Transformer> = {
  a: linkInNewTab,
  img: mxcImageOnly,
  font: colorToStyle,
  span: colorToStyle,
};

const union = (...lists: Array<readonly string[] | undefined>): string[] => [
  ...new Set(lists.flatMap((list) => list ?? [])),
];

const mergeAttributes = (
  base: Record<string, string[]>,
  extra: IOptions['allowedAttributes']
): Record<string, sanitizeHtml.AllowedAttribute[]> => {
  const merged: Record<string, sanitizeHtml.AllowedAttribute[]> = { ...base };
  if (!extra) return merged;
  Object.entries(extra).forEach(([tag, attributes]) => {
    const names = new Set(
      merged[tag]?.map((item) => (typeof item === 'string' ? item : item.name))
    );
    merged[tag] = [
      ...(merged[tag] ?? []),
      ...attributes.filter((item) => !names.has(typeof item === 'string' ? item : item.name)),
    ];
  });
  return merged;
};

const mergeStyles = (
  base: Record<string, Record<string, RegExp[]>>,
  extra: IOptions['allowedStyles']
): Record<string, Record<string, RegExp[]>> => {
  const merged: Record<string, Record<string, RegExp[]>> = {};
  Object.entries(base).forEach(([selector, properties]) => {
    merged[selector] = { ...properties };
  });
  Object.entries(extra ?? {}).forEach(([selector, properties]) => {
    const target = merged[selector] ?? {};
    Object.entries(properties).forEach(([property, patterns]) => {
      target[property] = [...(target[property] ?? []), ...patterns];
    });
    merged[selector] = target;
  });
  return merged;
};

const toTransformer = (transform: string | Transformer): Transformer =>
  typeof transform === 'string' ? sanitizeHtml.simpleTransform(transform, {}) : transform;

// A caller's transform runs first; the base transform of the resulting tag runs last, so a
// custom policy cannot undo the link, colour and image rules.
const mergeTransforms = (
  base: Record<string, Transformer>,
  extra: IOptions['transformTags']
): Record<string, Transformer> => {
  const tags = union(Object.keys(base), Object.keys(extra ?? {}));
  return Object.fromEntries(
    tags.map((tag) => {
      const custom = extra?.[tag];
      const transformer: Transformer = (tagName, attribs) => {
        const first = custom ? toTransformer(custom)(tagName, attribs) : { tagName, attribs };
        const last = base[first.tagName];
        return last ? { ...first, ...last(first.tagName, first.attribs) } : first;
      };
      return [tag, transformer];
    })
  );
};

/** Valid URI schemes from deployment configuration, without the dangerous ones. */
const normalizeAdditionalSchemes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const scheme = entry
      .trim()
      .toLowerCase()
      .replace(/:(?:\/\/)?$/, '');
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || FORBIDDEN_URL_SCHEMES.has(scheme)) return [];
    return [scheme];
  });
};

/**
 * The schemes a link may use: the web, mail and magnet ones, and the configured extras without
 * the forbidden ones. Messages written in Markdown accept the same.
 */
export const allowedLinkSchemes = (additionalAllowedUriSchemes?: unknown): string[] =>
  union(PERMITTED_URL_SCHEMES, normalizeAdditionalSchemes(additionalAllowedUriSchemes));

export type SanitizeCustomHtmlOptions = {
  /** Additions to the allowlist; they extend the base rules and never replace them. */
  policy?: IOptions;
  /** Extra link schemes, such as `obsidian`, from the client configuration. */
  additionalAllowedUriSchemes?: unknown;
  /**
   * Maps an image's source that is not `mxc://` to the `https:` URL it loads from; without it,
   * or when it returns no absolute `https:` URL without credentials, the image is dropped.
   */
  imageSource?: ImageSource;
};

const buildOptions = ({
  policy,
  additionalAllowedUriSchemes,
  imageSource,
}: SanitizeCustomHtmlOptions): IOptions => {
  const withCustomAttributes = mergeAttributes(
    BASE_ATTRIBUTES,
    customHtmlSanitizerPolicy.allowedAttributes
  );
  return {
    allowedTags: union(
      FORMATTING_TAGS,
      customHtmlSanitizerPolicy.allowedTags,
      policy?.allowedTags || undefined
    ),
    allowedAttributes: mergeAttributes(
      withCustomAttributes as Record<string, string[]>,
      policy?.allowedAttributes
    ),
    allowedStyles: mergeStyles(BASE_STYLES, policy?.allowedStyles),
    allowedClasses: {
      code: ['language-*'],
      ...(policy?.allowedClasses ?? {}),
    },
    allowedSchemes: allowedLinkSchemes(additionalAllowedUriSchemes),
    allowedSchemesByTag: { img: imageSource ? ['mxc', 'https'] : ['mxc'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    transformTags: mergeTransforms(
      imageSource ? { ...BASE_TRANSFORMS, img: mappedImage(imageSource) } : BASE_TRANSFORMS,
      policy?.transformTags
    ),
    // Reply fallbacks (MSC2781) and executable or invisible content are dropped with their text.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'mx-reply'],
    // An image left without a source (`mxc://`, or what `imageSource` returned) is dropped.
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    disallowedTagsMode: 'discard',
  };
};

const defaultOptions = buildOptions({});

/** Sanitizes `formatted_body` HTML to what the client renders. */
export const sanitizeCustomHtml = (
  customHtml: string,
  options?: SanitizeCustomHtmlOptions
): string => sanitizeHtml(customHtml, options ? buildOptions(options) : defaultOptions);
