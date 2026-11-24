import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  createContext,
  useContext,
  useId,
} from 'react';

const HIGHLIGHT_MS = 1200;
const HIGHLIGHT_ATTRIBUTE = 'data-footnote-highlight';
const highlightTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Per-message scope prefix for footnote DOM IDs (`fn1`, `fnref1`, `fnref1:1`), so multiple
 * messages with footnotes in the same timeline never collide on DOM IDs.
 */
export const FootnoteScopeContext = createContext<string | undefined>(undefined);

/** Scopes a footnote ID (`fn1`, `fnref1`) under `scopeId`, or keeps it as-is when unscoped. */
export const scopeFootnoteId = (scopeId: string | undefined, id: string): string =>
  scopeId ? `${scopeId}-${id}` : id;

/**
 * Provides a stable per-message footnote ID scope. By default reuses an enclosing scope so split
 * halves of one message share IDs; pass `isolate` for independent embedded Markdown blocks.
 */
export function FootnoteScopeProvider({
  children,
  isolate = false,
}: {
  children: ReactNode;
  isolate?: boolean;
}) {
  const existing = useContext(FootnoteScopeContext);
  const generated = useId();
  const scope = (!isolate && existing) || `fn-${generated.replace(/:/g, '_')}`;
  return <FootnoteScopeContext value={scope}>{children}</FootnoteScopeContext>;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const pulseFootnoteTarget = (target: HTMLElement): void => {
  const previous = highlightTimers.get(target);
  if (previous !== undefined) clearTimeout(previous);
  target.setAttribute(HIGHLIGHT_ATTRIBUTE, '');
  highlightTimers.set(
    target,
    setTimeout(() => {
      target.removeAttribute(HIGHLIGHT_ATTRIBUTE);
      highlightTimers.delete(target);
    }, HIGHLIGHT_MS)
  );
};

export type FootnoteLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'href' | 'id' | 'target' | 'rel'
> & {
  /** Unscoped footnote fragment (`#fn1`, `#fnref1`, `#fnref1:1`). */
  href: string;
  /** Unscoped footnote anchor ID (`fnref1`, `fnref1:1`), when this link is a jump target. */
  footnoteId?: string;
  /** True for the return arrow inside a footnote definition (`class="footnote-backref"`). */
  backref?: boolean;
};

/**
 * In-message footnote jump link (ref or backref): scopes `id` and `href` to the enclosing
 * message, scrolls and focuses the target smoothly without mutating `window.location.hash`, and
 * never renders external-link warnings or favicons.
 */
export function FootnoteLink({
  href,
  footnoteId,
  backref = false,
  onClick,
  children,
  'aria-label': ariaLabel,
  title,
  ...props
}: FootnoteLinkProps) {
  const scopeId = useContext(FootnoteScopeContext);
  const scopedId = footnoteId ? scopeFootnoteId(scopeId, footnoteId) : undefined;
  const scopedTargetId = scopeFootnoteId(scopeId, href.slice(1));

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    const target = document.getElementById(scopedTargetId);
    if (!target) return;
    target.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
    target.focus({ preventScroll: true });
    pulseFootnoteTarget(target);
  };

  return (
    <a
      {...props}
      id={scopedId}
      href={`#${scopedTargetId}`}
      aria-label={ariaLabel ?? (backref ? 'Back to reference' : undefined)}
      title={title ?? (backref ? 'Back to reference' : undefined)}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

export type FootnoteItemProps = Omit<ComponentPropsWithoutRef<'li'>, 'id'> & {
  /** Unscoped footnote definition ID (`fn1`). */
  footnoteId?: string;
};

/** A footnote definition `<li>` with a message-scoped DOM ID and programmatic focus target. */
export function FootnoteItem({ footnoteId, tabIndex, ...props }: FootnoteItemProps) {
  const scopeId = useContext(FootnoteScopeContext);
  const scopedId = footnoteId ? scopeFootnoteId(scopeId, footnoteId) : undefined;
  return <li {...props} id={scopedId} tabIndex={scopedId ? -1 : tabIndex} />;
}
