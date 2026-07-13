import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MindRoomParticleBackground } from './MindRoomParticleBackground';

vi.mock('@basnijholt/particular-drift/react', () => ({
  ParticularDriftCanvas: ({
    className,
    options,
    style,
  }: {
    className?: string;
    options?: unknown;
    style?: React.CSSProperties;
  }) => React.createElement('canvas', { className, 'data-options': options, style }),
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

  it('can carry its layout styles across a document portal', () => {
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<MindRoomParticleBackground selfContained />);
    });

    const background = renderer!.root.findByType('div');
    const canvas = renderer!.root.findByType('canvas');

    expect(background.props.style).toMatchObject({
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    });
    expect(canvas.props.style).toMatchObject({
      width: '100%',
      height: '100%',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
  });
});
