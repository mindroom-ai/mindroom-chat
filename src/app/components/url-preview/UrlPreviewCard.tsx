import React, { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, Text, as, color, config } from 'folds';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import * as css from './UrlPreviewCard.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/mediaUrl';

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




    useCallback(() => mx.getUrlPreview(url, ts), [mx, url, ts])
  );

  useEffect(() => {
    loadPreview().catch(() => undefined);
  }, [loadPreview]);

  if (previewState.status === AsyncStatus.Error) return null;

  let content: ReactNode;
  if (previewState.status === AsyncStatus.Success) {
    const preview = previewState.data;
    const title = preview['og:title'];
    const description = preview['og:description'];
    const image = preview['og:image'];
    const imageSrc =
      typeof image === 'string'
        ? mxcUrlToHttp(mx, image, useAuthentication, 256, 256, 'scale', false) ?? undefined
        : undefined;
    content = (
      <>
        {imageSrc && (
          <UrlPreviewImg src={imageSrc} alt={typeof title === 'string' ? title : ''} title={url} />
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
            {getSiteName(url, preview)}
          </Text>
          <Text truncate priority="400">
            <b>{typeof title === 'string' && title ? title : url}</b>
          </Text>
          {typeof description === 'string' && description && (
















    </UrlPreview>
  );
});

type Overflow = { back: boolean; forward: boolean; hasCards: boolean };

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












            onClick={() => scrollBy(-1)}
          >
            <Icon size="300" src={Icons.ArrowLeft} />
          </IconButton>
        </>
      )}















            onClick={() => scrollBy(1)}
          >
            <Icon size="300" src={Icons.ArrowRight} />
          </IconButton>
        </>
      )}
    </Box>
  );
});
