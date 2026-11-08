import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, Text, as, color, config } from 'folds';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import * as css from './UrlPreviewCard.css';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { useAvatarImage } from '../../avatars/useAvatarImage';
import { ImageOverlay } from '../content/ImageOverlay';
import { revealDirectionControls } from '../../ui/directional';

const linkStyles = { color: color.Success.Main };

const getSiteName = (url: string, preview: IPreviewUrlResponse): string => {
  const siteName = preview['og:site_name'];
  if (typeof siteName === 'string' && siteName) return siteName;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

type UrlPreviewCardProps = {
  url: string;
  ts: number;
};

/** The homeserver's preview of one link; renders nothing when the server has none. */
export const UrlPreviewCard = as<'div', UrlPreviewCardProps>(({ url, ts, ...cardProps }, ref) => {
  const useAuthentication = useMediaAuthentication();
  const mx = useMatrixClient();
  const [previewState, loadPreview] = useAsyncCallback(
    useCallback(() => mx.getUrlPreview(url, ts), [mx, url, ts])
  );
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    loadPreview().catch(() => undefined);
  }, [loadPreview]);

  // The preview's picture is homeserver media: the card shows a thumbnail and a click opens the
  // whole picture. Both load with the access token when no service worker adds it.
  const preview = previewState.status === AsyncStatus.Success ? previewState.data : undefined;
  const imageMxc = typeof preview?.['og:image'] === 'string' ? preview['og:image'] : undefined;
  const thumbnail = useAvatarImage(
    imageMxc
      ? mxcUrlToHttp(mx, imageMxc, useAuthentication, 256, 256, 'scale', false) ?? undefined
      : undefined
  );
  const original = useAvatarImage(
    imageMxc && viewerOpen ? mxcUrlToHttp(mx, imageMxc, useAuthentication) ?? undefined : undefined
  );

  if (previewState.status === AsyncStatus.Error) return null;

  let content: ReactNode;
  if (preview) {
    const title = preview['og:title'];
    const description = preview['og:description'];
    const imageAlt = typeof title === 'string' ? title : '';
    // The page's words show their direction controls, as message text does; the viewer gets the
    // title as it is, to save the picture under it.
    content = (
      <>
        {thumbnail.imageSrc && (
          <button
            type="button"
            className={css.UrlPreviewImageButton}
            onClick={() => setViewerOpen(true)}
          >
            <UrlPreviewImg
              src={thumbnail.imageSrc}
              alt={revealDirectionControls(imageAlt)}
              title={url}
              onError={thumbnail.onImageError}
            />
          </button>
        )}
        {viewerOpen && (
          <ImageOverlay
            src={original.imageSrc}
            alt={imageAlt || url}
            requestClose={() => setViewerOpen(false)}
          />
        )}
        <UrlPreviewContent>
          <Text
            style={linkStyles}
            truncate
            as="a"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            size="T200"
            priority="300"
          >
            {revealDirectionControls(getSiteName(url, preview))}
          </Text>
          <Text truncate priority="400">
            <b>{revealDirectionControls(typeof title === 'string' && title ? title : url)}</b>
          </Text>
          {typeof description === 'string' && description && (
            <UrlPreviewDescription>{revealDirectionControls(description)}</UrlPreviewDescription>
          )}
        </UrlPreviewContent>
      </>
    );
  } else {
    // Idle or loading: the card keeps its size so the row does not jump when the preview lands.
    content = (
      <Box grow="Yes" alignItems="Center" justifyContent="Center">
        <Spinner size="400" variant="Secondary" />
      </Box>
    );
  }

  return (
    <UrlPreview ref={ref} {...cardProps}>
      {content}
    </UrlPreview>
  );
});

type Overflow = { back: boolean; forward: boolean; hasCards: boolean };

type HolderEdgeProps = { side: 'Left' | 'Right'; label: string; onClick: () => void };

/** The fade over one edge of the row and the arrow that scrolls toward it. */
function HolderEdge({ side, label, onClick }: HolderEdgeProps) {
  return (
    <>
      <div className={css.UrlPreviewHolderGradient({ position: side })} />
      <IconButton
        aria-label={label}
        onClick={onClick}
        className={css.UrlPreviewHolderBtn({ position: side })}
        size="300"
        radii="Pill"
        variant="Secondary"
        outlined
      >
        <Icon size="300" src={side === 'Left' ? Icons.ArrowLeft : Icons.ArrowRight} />
      </IconButton>
    </>
  );
}

/** Horizontal row of link previews with arrow buttons where more cards are out of view. */
export const UrlPreviewHolder = as<'div'>(({ children, style, ...props }, ref) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({
    back: false,
    forward: false,
    hasCards: true,
  });

  const measure = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const hasCards = (scroll.firstElementChild?.childElementCount ?? 0) > 0;
    const width = scroll.clientWidth;
    const maxScroll = Math.max(0, scroll.scrollWidth - width);
    // RTL layouts report negative offsets; elastic overscroll can leave either range briefly.
    const sign = getComputedStyle(scroll).direction === 'rtl' ? -1 : 1;
    const position = Math.min(maxScroll, Math.max(0, sign * scroll.scrollLeft));
    const scrollable = width > 0 && maxScroll > 1;
    const next = {
      back: scrollable && position > 1,
      forward: scrollable && maxScroll - position > 1,
      hasCards,
    };
    setOverflow((current) =>
      current.back === next.back &&
      current.forward === next.forward &&
      current.hasCards === next.hasCards
        ? current
        : next
    );
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', measure);
    };
  }, [measure]);

  const scrollBy = (direction: 1 | -1) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const sign = getComputedStyle(scroll).direction === 'rtl' ? -1 : 1;
    scroll.scrollTo({
      left: scroll.scrollLeft + direction * sign * (scroll.clientWidth / 1.3),
      behavior: 'smooth',
    });
  };

  return (
    <Box
      direction="Column"
      style={{
        position: 'relative',
        marginTop: overflow.hasCards ? config.space.S200 : '0px',
        ...style,
      }}
      {...props}
      ref={ref}
    >
      {overflow.back && (
        <HolderEdge
          side="Left"
          label={t('sharedUi.urlPreviewHolder.previous')}
          onClick={() => scrollBy(-1)}
        />
      )}
      <Scroll ref={scrollRef} direction="Horizontal" size="0" visibility="Hover" hideTrack>
        <Box shrink="No" alignItems="Center" gap="200">
          {children}
        </Box>
      </Scroll>
      {overflow.forward && (
        <HolderEdge
          side="Right"
          label={t('sharedUi.urlPreviewHolder.next')}
          onClick={() => scrollBy(1)}
        />
      )}
    </Box>
  );
});
