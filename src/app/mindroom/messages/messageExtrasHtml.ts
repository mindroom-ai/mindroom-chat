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

const svgTags = [
  'svg',
  'g',
  'defs',
  'marker',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
];

const svgAttributes = [
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-family',
  'font-weight',
  'marker-end',
  'marker-start',
  'marker-mid',
  'id',
  'class',
];

const allowedSvgAttributes = Object.fromEntries(
  svgTags.map((tag) => [tag, svgAttributes])
) as Record<string, string[]>;

const allowedSvgClasses = Object.fromEntries(svgTags.map((tag) => [tag, [/.+/]])) as Record<
  string,
  RegExp[]
>;

const svgTransformTags = Object.fromEntries(svgTags.map((tag) => [tag, transformSvgTag])) as Record<
  string,
  Transformer
>;

const forbiddenSvgTags = [
  'foreignObject',
  'foreignobject',
  'use',
  'image',
  'animate',
  'animateTransform',
  'animatetransform',
  'animateMotion',
  'animatemotion',
  'set',
];

const forbiddenSvgAttributes = new Set(['href', 'xlink:href', 'style']);

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
  ...forbiddenSvgTags,
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

function transformSvgTag(tagName: string, attribs: Attributes) {
  const sanitizedAttributes = Object.fromEntries(
    Object.entries(attribs).filter(([attrName]) => {
      const normalizedAttrName = attrName.toLowerCase();
      return (
        !normalizedAttrName.startsWith('on') && !forbiddenSvgAttributes.has(normalizedAttrName)
      );
    })
  );

  return {
    tagName,
    attribs: sanitizedAttributes as Attributes,
  };
}

export const sanitizeMindroomMessageExtraHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...allowedTags, ...svgTags],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      ol: ['start', 'type'],
      code: ['class'],
      pre: ['class'],
      ...allowedSvgAttributes,
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
      ...allowedSvgClasses,
    },
    transformTags: {
      a: transformAnchorTag,
      ...svgTransformTags,
    },
    nonTextTags,
    nestingLimit: MAX_TAG_NESTING,
    parser: {
      lowerCaseAttributeNames: false,
    },
  });
