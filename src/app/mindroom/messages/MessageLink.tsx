import React, { ComponentPropsWithoutRef, useState } from 'react';

const failedIcons = new Map<string, number>();
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_FAILED_ICONS = 128;

const getIconUrl = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
      return undefined;
    }
    const hostname = url.hostname.replace(/\.$/, '');
    // Send only public-looking DNS names, never paths, credentials, IPs, or local names.
    const labels = hostname.split('.');
    if (
      hostname.length > 253 ||
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      !/[a-z]/i.test(labels[labels.length - 1]) ||
      /\.(?:localhost|local|internal|lan|home|arpa|test|invalid|example|onion)$/i.test(hostname) ||
      hostname === 'matrix.to'
    ) {
      return undefined;
    }
    // A stable URL per hostname lets the browser coalesce requests and reuse its
    // persistent HTTP image cache (the service currently sends a 30-day max-age).
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return undefined;
  }
};

const iconStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '1em',
  height: '1em',
  objectFit: 'contain',
  verticalAlign: '-0.125em',
  marginInlineEnd: '0.25em',
  // Favicons often contain dark artwork with a transparent background.
  backgroundColor: '#fff',
  borderRadius: '0.15em',
  padding: '1px',
  boxSizing: 'border-box',
};

function SiteIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const retryAt = failedIcons.get(src);
  if (failed || (retryAt !== undefined && retryAt > Date.now())) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      data-link-favicon=""
      width={16}
      height={16}
      style={iconStyle}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => {
        failedIcons.delete(src);
        failedIcons.set(src, Date.now() + FAILURE_BACKOFF_MS);
        if (failedIcons.size > MAX_FAILED_ICONS) {
          failedIcons.delete(failedIcons.keys().next().value);
        }
        setFailed(true);
      }}
    />
  );
}

export function MessageLink({
  children,
  showFavicon = false,
  ...props
}: ComponentPropsWithoutRef<'a'> & { showFavicon?: boolean }) {
  const iconUrl = showFavicon ? getIconUrl(props.href) : undefined;
  return (
    <a {...props}>
      {iconUrl && <SiteIcon key={iconUrl} src={iconUrl} />}
      {children}
    </a>
  );
}
