export const MINDROOM_MESSAGE_EXTRAS_KEY = 'com.mindroom.message_extras';

export const MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS = 8;
export const MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS = 120;
export const MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS = 16 * 1024;

export const MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN = 'text/plain';
export const MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN = 'text/markdown';

export type MindroomMessageExtraContentType =
  | typeof MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN
  | typeof MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN;

export type MindroomMessageExtrasSection = {
  title: string;
  contentType: MindroomMessageExtraContentType;
  content: string;
  collapsed: boolean;
};

export type MindroomMessageExtras = {
  version: 1;
  sections: MindroomMessageExtrasSection[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const isSupportedContentType = (value: unknown): value is MindroomMessageExtraContentType =>
  value === MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN || value === MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN;

const parseSection = (section: unknown): MindroomMessageExtrasSection | undefined => {
  if (!isPlainObject(section)) return undefined;

  const title = typeof section.title === 'string' ? section.title.trim() : '';
  if (!title) return undefined;

  if (!isSupportedContentType(section.content_type)) return undefined;
  if (typeof section.content !== 'string') return undefined;
  if (section.content.length > MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS) return undefined;

  return {
    title: title.slice(0, MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS),
    contentType: section.content_type,
    content: section.content,
    collapsed: section.collapsed !== false,
  };
};

export const parseMindroomMessageExtras = (content: unknown): MindroomMessageExtras | null => {
  try {
    if (!isPlainObject(content)) return null;

    const extras = content[MINDROOM_MESSAGE_EXTRAS_KEY];
    if (!isPlainObject(extras)) return null;
    if (extras.version !== 1) return null;
    if (!Array.isArray(extras.sections)) return null;

    const sections = extras.sections
      .slice(0, MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS)
      .map(parseSection)
      .filter((section): section is MindroomMessageExtrasSection => !!section);

    if (sections.length === 0) return null;

    return {
      version: 1,
      sections,
    };
  } catch {
    return null;
  }
};

export const hasMindroomMessageExtras = (content: unknown): boolean =>
  parseMindroomMessageExtras(content) !== null;
