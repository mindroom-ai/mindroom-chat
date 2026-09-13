import React from 'react';
import { ParticularDriftCanvas } from '@basnijholt/particular-drift/react';
import type { ParticularDriftUserOptions } from '@basnijholt/particular-drift';

import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import * as css from './MindRoomParticleBackground.css';
import { PARTICLE_BACKGROUND_COLOR, PARTICLE_COLOR } from './particleBackgroundTheme';

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

export function MindRoomParticleBackground() {
  const particleCount = React.useMemo(resolveMindRoomParticleCount, []);
  const options = React.useMemo<ParticularDriftUserOptions>(
    () => ({
      imageFit: 'contain',
      interactive: true,
      cursorMode: 'repel',
      cursorRadius: 0.14,
      cursorStrength: 1.25,
      backgroundColor: PARTICLE_BACKGROUND_COLOR,
      particleColor: PARTICLE_COLOR,
      particleCount,
      particleOpacity: 0.46,
      particleSize: 1.15,
      particleSpeed: 10,
      attractionStrength: 96,
      edgeThreshold: 0.32,
      flowFieldScale: 4,
      maxDevicePixelRatio: 1.25,
    }),
    [particleCount]
  );

  return (
    <div className={css.ParticleBackground} aria-hidden="true">
      <ParticularDriftCanvas
        className={css.ParticleCanvas}
        imageUrl={MINDROOM_CLIENT_BRANDING.logoSrc}
        options={options}
      />
    </div>
  );
}
