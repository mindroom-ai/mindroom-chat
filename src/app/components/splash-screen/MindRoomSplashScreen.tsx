import React, { ReactNode } from 'react';
import { MindRoomParticleBackground } from '../particle-background';
import { SplashScreen } from './SplashScreen';

type MindRoomSplashScreenProps = {
  children: ReactNode;
};

export function MindRoomSplashScreen({ children }: MindRoomSplashScreenProps) {
  return <SplashScreen background={<MindRoomParticleBackground />}>{children}</SplashScreen>;
}
