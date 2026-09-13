import sanitizeHtml, { type Attributes, type Transformer } from 'sanitize-html';

const MAX_TAG_NESTING = 100;

const SAFE_HREF_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const allowedTags = [
  'p',
  'div',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'br',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'pre',
  'code',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'sup',
  'sub',
  'a',
];

const nonTextTags = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'meta',
  'link',
  'base',
  'noscript',
  'mx-reply',
  'details',
  'summary',
  'img',
  'think',
  'debug',
  'system',
  'plan',
  'analysis',
  'research',
];

const hasRawWhitespace = (value: string): boolean => /\s/.test(value);

const isSafeHref = (href: string): boolean => {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('//') || hasRawWhitespace(trimmedHref)) {
    return false;
  }

  try {
    const url = new URL(trimmedHref);
    return SAFE_HREF_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
};

const transformAnchorTag: Transformer = (tagName, attribs) => {
  const href = attribs.href;
  if (typeof href !== 'string' || !isSafeHref(href)) {
    return {
      tagName,
      attribs: {} as Attributes,
    };
  }

  return {
    tagName,
    attribs: {
      href: href.trim(),
      target: '_blank',
      rel: 'noreferrer noopener',
    },
  };
};

export const sanitizeMindroomMessageExtraHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      ol: ['start', 'type'],
      code: ['class'],
      pre: ['class'],
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto'],
    },
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    allowedClasses: {
      code: ['language-*'],
      pre: ['language-*'],
    },
    transformTags: {
      a: transformAnchorTag,
    },
    nonTextTags,
    nestingLimit: MAX_TAG_NESTING,
  });
