import React from 'react';
import { ParticularDriftCanvas } from '@basnijholt/particular-drift/react';
import type { ParticularDriftUserOptions } from '@basnijholt/particular-drift';
import classNames from 'classnames';

import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import * as css from './MindRoomParticleBackground.css';
import { PARTICLE_THEMES } from './particleBackgroundTheme';
import { useParticleThemeKind } from './useParticleThemeKind';

const DESKTOP_PARTICLE_COUNT = 80000;
const BALANCED_PARTICLE_COUNT = 52000;
const LOW_END_PARTICLE_COUNT = 28000;

export function resolveMindRoomParticleCount() {
  if (typeof window === 'undefined') {
    return BALANCED_PARTICLE_COUNT;
  }

  const coarsePointer = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;
  const hardwareConcurrency = window.navigator.hardwareConcurrency ?? 4;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const effectivePixelArea = window.innerWidth * window.innerHeight * devicePixelRatio ** 2;

  if (coarsePointer || hardwareConcurrency <= 4) {
    return LOW_END_PARTICLE_COUNT;
  }

  if (hardwareConcurrency <= 8 || devicePixelRatio > 1.5 || effectivePixelArea > 4_000_000) {
    return BALANCED_PARTICLE_COUNT;
  }

  return DESKTOP_PARTICLE_COUNT;
}

/**
 * Whether the browser reports a major performance caveat for WebGL2. Chromium
 * reports one for its software fallback (SwiftShader, as in headless Chromium,
 * or WARP), which draws every frame on the CPU while the main thread waits to
 * read each frame back, so the full animation delays the app starting behind
 * the splash. Firefox (by default) and Safari ignore the attribute.
 */
export function hasWebGLPerformanceCaveat() {
  if (typeof document === 'undefined') return false;
  const gl = document
    .createElement('canvas')
    .getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return gl === null;
}

// Fewer, bolder particles at CSS resolution: the CPU draws them in a fraction of
// the time and the logo still reads.
const SOFTWARE_PARTICLE_OPTIONS: ParticularDriftUserOptions = {
  particleCount: 10000,
  particleSize: 1.5,
  particleOpacity: 0.6,
  maxDevicePixelRatio: 1,
};

type MindRoomParticleBackgroundProps = {
  position?: 'absolute' | 'fixed';
  selfContained?: boolean;
};

export function MindRoomParticleBackground({
  position = 'absolute',
  selfContained = false,
}: MindRoomParticleBackgroundProps) {
  const software = React.useMemo(hasWebGLPerformanceCaveat, []);
  const particleCount = React.useMemo(resolveMindRoomParticleCount, []);
  const particleTheme = PARTICLE_THEMES[useParticleThemeKind()];
  const options = React.useMemo<ParticularDriftUserOptions>(
    () => ({
      imageFit: 'contain',
      interactive: true,
      cursorMode: 'repel',
      cursorRadius: 0.14,
      cursorStrength: 1.25,
      backgroundColor: particleTheme.backgroundColor,
      particleColor: particleTheme.particleColor,
      particleCount,
      particleOpacity: 0.46,
      particleSize: 1.15,
      particleSpeed: 10,
      attractionStrength: 96,
      edgeThreshold: 0.32,
      flowFieldScale: 4,
      maxDevicePixelRatio: 1.25,
      ...(software ? SOFTWARE_PARTICLE_OPTIONS : {}),
    }),
    [particleCount, particleTheme, software]
  );

  return (
    <div
      className={classNames(
        css.ParticleBackground,
        position === 'fixed' && css.ParticleBackgroundFixed
      )}
      style={
        selfContained
          ? {
              position,
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              background: particleTheme.backgroundRadialGradient,
            }
          : undefined
      }
      aria-hidden="true"
    >
      <ParticularDriftCanvas
        className={css.ParticleCanvas}
        imageUrl={MINDROOM_CLIENT_BRANDING.logoSrc}
        options={options}
        style={
          selfContained
            ? {
                width: '100%',
                height: '100%',
                opacity: 1,
                pointerEvents: 'auto',
                touchAction: 'none',
              }
            : undefined
        }
      />
    </div>
  );
}
