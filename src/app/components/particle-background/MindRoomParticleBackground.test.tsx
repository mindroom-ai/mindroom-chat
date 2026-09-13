import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MindRoomParticleBackground } from './MindRoomParticleBackground';

vi.mock('@basnijholt/particular-drift/react', () => ({
  ParticularDriftCanvas: ({ className, options }: { className?: string; options?: unknown }) =>
    React.createElement('canvas', { className, 'data-options': options }),
}));

vi.mock('./MindRoomParticleBackground.css', () => ({
  ParticleBackground: 'particle-background',
  ParticleBackgroundFixed: 'particle-background-fixed',
  ParticleCanvas: 'particle-canvas',
}));

describe('MindRoomParticleBackground', () => {
  it('keeps pointer interaction enabled for direct touch gestures', () => {
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<MindRoomParticleBackground />);
    });

    const canvas = renderer!.root.findByType('canvas');
    expect(canvas.props.className).toBe('particle-canvas');
    expect(canvas.props['data-options']).toMatchObject({
      interactive: true,
      cursorMode: 'repel',
    });
  });
});
