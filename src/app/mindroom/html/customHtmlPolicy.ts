/** The parts of a `sanitize-html` policy MindRoom adds to the client's base sanitizer. */
type MindroomCustomHtmlSanitizerPolicy = {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
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
 * transformers stay the base sanitizer's.
 */
export const mindroomCustomHtmlSanitizerPolicy: MindroomCustomHtmlSanitizerPolicy = {
  allowedTags: ['think', 'debug', 'system', 'plan', 'analysis', 'research'],
  allowedAttributes: {
    span: ['data-mx-maths', ...PASTE_MARKER_ATTRIBUTES],
    div: ['data-mx-maths'],
  },
};
