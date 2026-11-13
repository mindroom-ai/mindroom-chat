import React from 'react';
import { ParticularDriftCanvas } from '@basnijholt/particular-drift/react';
import type { ParticularDriftUserOptions } from '@basnijholt/particular-drift';
import classNames from 'classnames';

import { MINDROOM_CLIENT_BRANDING } from '../branding/clientBranding';
import * as css from './ParticleBackground.css';
import { PARTICLE_THEMES } from './particleBackgroundTheme';
import { rendersWebGLOnCpu } from './softwareWebGL';
import { useParticleThemeKind } from './useParticleThemeKind';

// Where WebGL2 runs on the GPU, the count follows the kind of screen, not the CPU cores.
const DESKTOP_PARTICLE_COUNT = 120000;
const HIGH_DENSITY_PARTICLE_COUNT = 80000;
const TOUCH_PARTICLE_COUNT = 40000;

export function resolveMindRoomParticleCount() {
  if (typeof window === 'undefined') {
    return HIGH_DENSITY_PARTICLE_COUNT;
  }

  const coarsePointer = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const effectivePixelArea = window.innerWidth * window.innerHeight * devicePixelRatio ** 2;

  if (coarsePointer) {
    return TOUCH_PARTICLE_COUNT;
  }

  if (devicePixelRatio > 1.5 || effectivePixelArea > 4_000_000) {
    return HIGH_DENSITY_PARTICLE_COUNT;
  }

  return DESKTOP_PARTICLE_COUNT;
}

// Fewer, bolder particles at three quarters of CSS resolution and at most 30 frames
// a second, so the CPU draws them in a fraction of the time and the logo still reads.
// Particle size is in canvas pixels, so it shrinks with the resolution.
const SOFTWARE_PARTICLE_OPTIONS: ParticularDriftUserOptions = {
  particleCount: 10000,
  particleSize: 1.125,
  particleOpacity: 0.7,
  maxDevicePixelRatio: 0.75,
  maxFramesPerSecond: 30,
};

type MindRoomParticleBackgroundProps = {
  position?: 'absolute' | 'fixed';
  selfContained?: boolean;
};

export function MindRoomParticleBackground({
  position = 'absolute',
  selfContained = false,
}: MindRoomParticleBackgroundProps) {
  const software = React.useMemo(rendersWebGLOnCpu, []);
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
