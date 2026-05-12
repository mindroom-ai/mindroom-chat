import React from 'react';
import { ParticularDriftCanvas } from '@basnijholt/particular-drift/react';

import * as css from './styles.css';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';

export function AuthParticleBackground() {
  return (
    <div className={css.AuthParticleBackground} aria-hidden="true">
      <ParticularDriftCanvas
        className={css.AuthParticleCanvas}
        imageUrl={MINDROOM_AUTH_BRANDING.logoSrc}
        options={{
          imageFit: 'contain',
          backgroundColor: '#0f0d2e',
          particleColor: '#dda290',
          particleCount: 120000,
          particleOpacity: 0.46,
          particleSize: 1.15,
          particleSpeed: 10,
          attractionStrength: 96,
          edgeThreshold: 0.32,
          flowFieldScale: 4,
          maxDevicePixelRatio: 1.5,
        }}
      />
    </div>
  );
}
