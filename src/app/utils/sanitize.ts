import sanitizeHtml, { type IOptions, type Transformer } from 'sanitize-html';
import { mindroomCustomHtmlSanitizerPolicy } from '../mindroom/html/customHtmlPolicy';

/** Escapes text for use as HTML content or a quoted attribute value. */
export const sanitizeText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// The Matrix specification's recommended tags and attributes for `org.matrix.custom.html`
// ("m.room.message msgtypes"), plus `data-md`, which records the Markdown that produced an
// element so the composer can turn a message back into Markdown when editing.
const FORMATTING_TAGS = [
  'font',
  'del',
  's',







































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




  code: ['class', 'data-md'],
  div: ['data-md'],
  details: ['open'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
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

const BASE_TRANSFORMS: Record<string, Transformer> = {
  a: linkInNewTab,
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
// custom policy cannot undo the link and colour rules.
const mergeTransforms = (extra: IOptions['transformTags']): Record<string, Transformer> => {
  const tags = union(Object.keys(BASE_TRANSFORMS), Object.keys(extra ?? {}));
  return Object.fromEntries(
    tags.map((tag) => {
      const custom = extra?.[tag];
      const transformer: Transformer = (tagName, attribs) => {
        const first = custom ? toTransformer(custom)(tagName, attribs) : { tagName, attribs };
        const base = BASE_TRANSFORMS[first.tagName];
        return base ? { ...first, ...base(first.tagName, first.attribs) } : first;
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

export type SanitizeCustomHtmlOptions = {
  /** Additions to the allowlist; they extend the base rules and never replace them. */
  policy?: IOptions;
  /** Extra link schemes, such as `obsidian`, from the client configuration. */
  additionalAllowedUriSchemes?: unknown;
};

const buildOptions = ({
  policy,
  additionalAllowedUriSchemes,
}: SanitizeCustomHtmlOptions): IOptions => {
  const withMindroom = mergeAttributes(
    BASE_ATTRIBUTES,
    mindroomCustomHtmlSanitizerPolicy.allowedAttributes
  );
  return {
    allowedTags: union(
      FORMATTING_TAGS,
      mindroomCustomHtmlSanitizerPolicy.allowedTags,
      policy?.allowedTags || undefined
    ),
    allowedAttributes: mergeAttributes(
      withMindroom as Record<string, string[]>,
      policy?.allowedAttributes
    ),
    allowedStyles: mergeStyles(BASE_STYLES, policy?.allowedStyles),
    allowedClasses: {
      code: ['language-*'],
      ...(policy?.allowedClasses ?? {}),
    },
    allowedSchemes: union(
      PERMITTED_URL_SCHEMES,
      normalizeAdditionalSchemes(additionalAllowedUriSchemes)
    ),
    allowedSchemesByTag: { img: ['mxc'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    transformTags: mergeTransforms(policy?.transformTags),
    // Reply fallbacks (MSC2781) and executable or invisible content are dropped with their text.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'mx-reply'],
    disallowedTagsMode: 'discard',
  };
};

const defaultOptions = buildOptions({});

/** Sanitizes `formatted_body` HTML to what the client renders. */
export const sanitizeCustomHtml = (
  customHtml: string,
  options?: SanitizeCustomHtmlOptions
): string => sanitizeHtml(customHtml, options ? buildOptions(options) : defaultOptions);
