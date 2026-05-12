import React from 'react';
import { ParticularDriftCanvas } from '@basnijholt/particular-drift/react';

import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import * as css from './MindRoomParticleBackground.css';
import { PARTICLE_BACKGROUND_COLOR, PARTICLE_COLOR } from './particleBackgroundTheme';

export function MindRoomParticleBackground() {
  return (
    <div className={css.ParticleBackground} aria-hidden="true">
      <ParticularDriftCanvas
        className={css.ParticleCanvas}
        imageUrl={MINDROOM_CLIENT_BRANDING.logoSrc}
        options={{
          imageFit: 'contain',
          interactive: true,
          cursorMode: 'repel',
          cursorRadius: 0.14,
          cursorStrength: 1.25,
          backgroundColor: PARTICLE_BACKGROUND_COLOR,
          particleColor: PARTICLE_COLOR,
          particleCount: 80000,
          particleOpacity: 0.46,
          particleSize: 1.15,
          particleSpeed: 10,
          attractionStrength: 96,
          edgeThreshold: 0.32,
          flowFieldScale: 4,
          maxDevicePixelRatio: 1.25,
        }}
      />
    </div>
  );
}
