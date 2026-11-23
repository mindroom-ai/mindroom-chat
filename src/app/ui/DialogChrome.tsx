import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
  useCallback,
  useRef,
} from 'react';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconButton } from './glass/GlassPrimitives';
import { InsetScrollbar } from './InsetScrollbar';
import * as css from './DialogChrome.css';

type DialogCloseButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label' | 'type' | 'onClick'
> & {
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  iconSize?: '100' | '200';
};

/** Quiet Glass pill close button shared by sheet and dialog headers. */
export const DialogCloseButton = forwardRef<HTMLButtonElement, DialogCloseButtonProps>(
  function DialogCloseButton({ label, iconSize = '200', className, ...props }, ref) {
    return (
      <IconButton
        {...props}
        ref={ref}
        type="button"
        size="300"
        radii="Pill"
        className={classNames(css.CloseTouchIcon, className)}
        aria-label={label}
      >
        <Icon size={iconSize} src={Icons.Cross} />
      </IconButton>
    );
  }
);

type SheetScrollAreaProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  'id' | 'role' | 'aria-labelledby' | 'onKeyDown'
> & {
  children: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  /** Allows vertical scroll chaining to an outer scroll container on short viewports. */
  chainOverscroll?: boolean;
  /** Applied to the outer scroll frame; use `viewportClassName` for the scrollable viewport. */
  className?: string;
  /** Applied to the scrollable viewport; must not establish a containing block (`position`/`transform`). */
  viewportClassName?: string;
};

/** Scrollable list viewport with an overlay InsetScrollbar for picker sheets and dialogs. */
export function SheetScrollArea({
  children,
  scrollRef,
  chainOverscroll = false,
  className,
  viewportClassName,
  ...viewportProps
}: SheetScrollAreaProps) {
  const { t } = useTranslation();
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const setScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      internalScrollRef.current = node;
      if (typeof scrollRef === 'function') scrollRef(node);
      else if (scrollRef) scrollRef.current = node;
    },
    [scrollRef]
  );

  return (
    <div className={classNames(css.SheetScrollFrame, className)}>
      <div
        {...viewportProps}
        ref={setScrollNode}
        className={classNames(
          css.SheetScrollViewport,
          chainOverscroll && css.SheetScrollChain,
          viewportClassName
        )}
        data-y-scrollbar-width={0}
      >
        <div ref={contentRef}>{children}</div>
        {/* Inside the viewport so wheel events over the track scroll it; placed by the frame so it stays put. */}
        <InsetScrollbar
          scrollRef={internalScrollRef}
          contentRef={contentRef}
          label={t('sharedUi.pageScroll.scrollbar')}
          className={css.SheetScrollbar}
          tabIndex={-1}
        />
      </div>
    </div>
  );
}
