import React, { CSSProperties, ReactNode, useState } from 'react';
import classNames from 'classnames';
import { AvatarFallback, AvatarImage, color } from 'folds';
import * as css from './UserAvatar.css';

// Fallback fills rotate through the theme's accent containers, picked by a stable hash of the ID.
// Read on first use, not at import, so importing the avatar never needs the folds theme.
const getFallbackColors = () => [
  { background: color.Primary.Container, foreground: color.Primary.OnContainer },
  { background: color.Secondary.Container, foreground: color.Secondary.OnContainer },
  { background: color.Success.Container, foreground: color.Success.OnContainer },
  { background: color.Warning.Container, foreground: color.Warning.OnContainer },
  { background: color.Critical.Container, foreground: color.Critical.OnContainer },
];

const hashId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

/** The fallback fill and text color for an avatar of this user or room ID. */
export const getAvatarFallbackStyle = (id: string): CSSProperties => {
  const colors = getFallbackColors();
  const fill = colors[hashId(id) % colors.length];
  return { backgroundColor: fill.background, color: fill.foreground };
};

/**
 * Whether the image at `src` failed to load. A new `src` gets a fresh attempt, even one that
 * failed before (media URLs change once authenticated media is available, and may change back).
 */
export const useImageFailed = (src: string | undefined): [boolean, () => void] => {
  const [state, setState] = useState({ src, failed: false });
  if (state.src !== src) {
    setState({ src, failed: false });
  }
  const failed = state.src === src && state.failed;
  return [failed, () => setState({ src, failed: true })];
};







};

/** A user's avatar image, or a colored fallback while there is none or it fails to load. */
export function UserAvatar({ userId, src, alt, className, renderFallback }: UserAvatarProps) {
  const [failed, setFailed] = useImageFailed(src);



















    />
  );
}
