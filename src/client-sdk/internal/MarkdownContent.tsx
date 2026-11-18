// HTML a plugin shows as the timeline shows an agent's reply, which `/ui` gives plugins as
// `MarkdownContent`. Not a subpath: only the SDK's own modules import it.
import { forwardRef, useMemo } from 'react';
import parse from 'html-react-parser';
import { useOptionalMatrixClient } from '../../app/matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../app/matrix/hooks/useMediaAuthentication';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../app/messages/html/react-custom-html-parser';

type MarkdownContentProps = {
  /** Sanitized HTML, as `useMarkdownHtml` or `sanitizeHtml` gives it. */
  html: string;
  className?: string;
};

/**
 * `html` drawn by the timeline's renderer for message HTML, in a `<div>` with `className` that
 * `ref` gets: tables scroll in their own box, links, mentions, code, math and spoilers render as in
 * a thread, and the `https:` images the sanitizer kept show. Outside the app (a fixture page, which
 * has no account) the HTML goes in as it is.
 */
export const MarkdownContent = forwardRef<HTMLDivElement, MarkdownContentProps>(
  function MarkdownContent({ html, className }, ref) {
    const mx = useOptionalMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const content = useMemo(
      () =>
        mx &&
        parse(
          html,
          getReactCustomHtmlParser(mx, undefined, {
            linkifyOpts: LINKIFY_OPTS,
            useAuthentication,
            httpsImages: true,
          })
        ),
      [html, mx, useAuthentication]
    );
    if (!mx) {
      // The plugin's HTML, sanitized by the app's policy.
      // eslint-disable-next-line react/no-danger
      return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return (
      <div ref={ref} className={className}>
        {content}
      </div>
    );
  }
);
