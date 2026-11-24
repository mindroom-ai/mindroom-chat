export const MINDROOM_MESSAGE_EXTRAS_KEY = 'com.mindroom.message_extras';

export const MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS = 8;
export const MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS = 120;
export const MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS = 16 * 1024;

export const MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN = 'text/plain';
export const MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN = 'text/markdown';
export const MINDROOM_MESSAGE_EXTRAS_TEXT_HTML = 'text/html';

export type MessageExtraContentType =
  | typeof MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN
  | typeof MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN
  | typeof MINDROOM_MESSAGE_EXTRAS_TEXT_HTML;

export type MessageExtrasVersion = 1 | 2;

export type MessageExtrasSection = {
  title: string;
  contentType: MessageExtraContentType;
  content: string;
  collapsed: boolean;
};

export type MessageExtras = {
  version: MessageExtrasVersion;
  sections: MessageExtrasSection[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const isSupportedContentType = (
  value: unknown,
  version: MessageExtrasVersion
): value is MessageExtraContentType => {
  if (
    value === MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN ||
    value === MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN
  ) {
    return true;
  }

  return version === 2 && value === MINDROOM_MESSAGE_EXTRAS_TEXT_HTML;
};

const parseSection = (
  section: unknown,
  version: MessageExtrasVersion
): MessageExtrasSection | undefined => {
  if (!isPlainObject(section)) return undefined;

  const title = typeof section.title === 'string' ? section.title.trim() : '';
  if (!title) return undefined;

  if (!isSupportedContentType(section.content_type, version)) return undefined;
  if (typeof section.content !== 'string') return undefined;
  if (section.content.length > MINDROOM_MESSAGE_EXTRAS_MAX_CONTENT_CHARS) return undefined;

  return {
    title: title.slice(0, MINDROOM_MESSAGE_EXTRAS_MAX_TITLE_CHARS),
    contentType: section.content_type,
    content: section.content,
    collapsed: section.collapsed !== false,
  };
};

export const parseMessageExtras = (content: unknown): MessageExtras | null => {
  try {
    if (!isPlainObject(content)) return null;

    const extras = content[MINDROOM_MESSAGE_EXTRAS_KEY];
    if (!isPlainObject(extras)) return null;
    if (extras.version !== 1 && extras.version !== 2) return null;
    if (!Array.isArray(extras.sections)) return null;

    const version = extras.version;
    const sections = extras.sections
      .slice(0, MINDROOM_MESSAGE_EXTRAS_MAX_SECTIONS)
      .map((section) => parseSection(section, version))
      .filter((section): section is MessageExtrasSection => !!section);

    if (sections.length === 0) return null;

    return {
      version,
      sections,
    };
  } catch {
    return null;
  }
};

export const hasMessageExtras = (content: unknown): boolean =>
  parseMessageExtras(content) !== null;
