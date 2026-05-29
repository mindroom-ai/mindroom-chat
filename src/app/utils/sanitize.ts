import sanitizeHtml, { Transformer } from 'sanitize-html';
import { mindroomCustomHtmlSanitizerPolicy } from '../mindroom/html/customHtmlPolicy';

const MAX_TAG_NESTING = 100;

type AttributePolicy = Record<string, string[]>;
type ClassPolicy = Record<string, string[]>;
type StylePolicy = Record<string, Record<string, RegExp[]>>;

export type CustomHtmlSanitizerPolicy = {
  allowedTags?: string[];
  allowedAttributes?: AttributePolicy;
  allowedClasses?: ClassPolicy;
  allowedStyles?: StylePolicy;
  transformTags?: Record<string, Transformer>;
  nonTextTags?: string[];
};

const mergeList = <T>(base: T[], extension: T[] | undefined): T[] =>
  extension ? [...base, ...extension] : base;

const mergeRecordOfLists = <T>(
  base: Record<string, T[]>,
  extension: Record<string, T[]> | undefined
): Record<string, T[]> => {
  if (!extension) return base;

  return Object.entries(extension).reduce(
    (merged, [key, values]) => ({
      ...merged,
      [key]: [...(merged[key] ?? []), ...values],
    }),
    { ...base }
  );
};

const mergeStylePolicy = (base: StylePolicy, extension: StylePolicy | undefined): StylePolicy => {
  if (!extension) return base;

  return Object.entries(extension).reduce(
    (merged, [selector, properties]) => ({
      ...merged,
      [selector]: {
        ...(merged[selector] ?? {}),
        ...properties,
      },
    }),
    { ...base }
  );
};

const basePermittedHtmlTags = [
  'font',
  'del',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'p',
  'a',
  'ul',
  'ol',
  'sup',
  'sub',
  'li',
  'b',
  'i',
  'u',
  'strong',
  'em',
  'strike',
  's',
  'code',
  'hr',
  'br',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'pre',
  'span',
  'img',
  'details',
  'summary',
];

const urlSchemes = ['https', 'http', 'ftp', 'mailto', 'magnet'];

const basePermittedTagToAttributes: AttributePolicy = {
  font: ['style', 'data-mx-bg-color', 'data-mx-color', 'color'],
  span: [
    'style',
    'data-mx-bg-color',
    'data-mx-color',
    'data-mx-spoiler',
    'data-mx-pill',
    'data-mx-ping',
    'data-md',
  ],
  blockquote: ['data-md'],
  h1: ['data-md'],
  h2: ['data-md'],
  h3: ['data-md'],
  h4: ['data-md'],
  h5: ['data-md'],
  h6: ['data-md'],
  pre: ['data-md', 'class'],
  ol: ['start', 'type', 'data-md'],
  ul: ['data-md'],
  a: ['name', 'target', 'href', 'rel', 'data-md'],
  img: ['width', 'height', 'alt', 'title', 'src', 'data-mx-emoticon'],
  code: ['class', 'data-md'],
  strong: ['data-md'],
  i: ['data-md'],
  em: ['data-md'],
  u: ['data-md'],
  s: ['data-md'],
  del: ['data-md'],
};

const baseAllowedClasses: ClassPolicy = {
  code: ['language-*'],
};

const baseAllowedStyles: StylePolicy = {
  '*': {
    color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
    'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
  },
};

const transformFontTag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    style: `background-color: ${attribs['data-mx-bg-color']}; color: ${attribs['data-mx-color']}`,
  },
});

const transformSpanTag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    style: `background-color: ${attribs['data-mx-bg-color']}; color: ${attribs['data-mx-color']}`,
  },
});

const transformATag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    rel: 'noreferrer noopener',
    target: '_blank',
  },
});

const transformImgTag: Transformer = (tagName, attribs) => {
  const { src } = attribs;
  if (typeof src === 'string' && src.startsWith('mxc://') === false) {
    return {
      tagName: 'a',
      attribs: {
        href: src,
        rel: 'noreferrer noopener',
        target: '_blank',
      },
      text: attribs.alt || src,
    };
  }
  return {
    tagName,
    attribs: {
      ...attribs,
    },
  };
};

export const sanitizeCustomHtml = (
  customHtml: string,
  policy: CustomHtmlSanitizerPolicy = mindroomCustomHtmlSanitizerPolicy
): string =>
  sanitizeHtml(customHtml, {
    allowedTags: mergeList(basePermittedHtmlTags, policy.allowedTags),
    allowedAttributes: mergeRecordOfLists(basePermittedTagToAttributes, policy.allowedAttributes),
    disallowedTagsMode: 'discard',
    allowedSchemes: urlSchemes,
    allowedSchemesByTag: {
      a: urlSchemes,
    },
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    allowedClasses: mergeRecordOfLists(baseAllowedClasses, policy.allowedClasses),
    allowedStyles: mergeStylePolicy(baseAllowedStyles, policy.allowedStyles),
    transformTags: {
      font: transformFontTag,
      span: transformSpanTag,
      a: transformATag,
      img: transformImgTag,
      ...policy.transformTags,
    },
    nonTextTags: mergeList(
      ['style', 'script', 'textarea', 'option', 'noscript', 'mx-reply'],
      policy.nonTextTags
    ),
    nestingLimit: MAX_TAG_NESTING,
  });

export const sanitizeText = (body: string) => {
  const tagsToReplace: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return body.replace(/[&<>'"]/g, (tag) => tagsToReplace[tag] || tag);
};
