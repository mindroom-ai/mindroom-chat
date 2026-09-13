import React from 'react';
import { MindRoomParticleBackground } from './particle-background';

type CallBackgroundProps = {
  visible: boolean;
};

export function CallBackground({ visible }: CallBackgroundProps) {
  return visible ? <MindRoomParticleBackground /> : null;
}
