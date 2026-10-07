import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// `getContext` stands in for the browser's WebGL2: null when the browser reports a major
// performance caveat, as Chromium does for its software fallback.
const stubWebGL2 = (getContext: (type: string, attributes?: object) => unknown) =>
  vi.stubGlobal('document', {
    createElement: () => ({ getContext }),
    documentElement: { classList: { contains: () => false } },
  });

describe('MindRoomParticleBackground', () => {
  beforeEach(() => {
    stubWebGL2(() => ({ getExtension: () => ({ loseContext: () => undefined }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      particleCount: 52000,
      maxDevicePixelRatio: 1.25,
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

  it('animates fewer particles when the browser reports a WebGL2 performance caveat', () => {
    const getContext = vi.fn(() => null);
    stubWebGL2(getContext);
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<MindRoomParticleBackground />);
    });

    expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true });
    expect(renderer!.root.findByType('canvas').props['data-options']).toMatchObject({
      particleCount: 10000,
      particleSize: 1.5,
      particleOpacity: 0.6,
      maxDevicePixelRatio: 1,
    });
  });
});
