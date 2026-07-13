import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CallBackground } from './CallBackground';

vi.mock('./particle-background', () => ({
  MindRoomParticleBackground: () =>
    React.createElement('div', { 'data-mindroom-particle-background': true }),
}));

describe('CallBackground', () => {
  it('reuses the MindRoom particle animation while the call is visible', () => {
    const renderer = create(<CallBackground visible />);

    expect(renderer.root.findByProps({ 'data-mindroom-particle-background': true })).toBeDefined();
  });

  it('does not run the WebGL background for a hidden call', () => {
    const renderer = create(<CallBackground visible={false} />);

    expect(
      renderer.root.findAllByProps({ 'data-mindroom-particle-background': true })
    ).toHaveLength(0);
  });
});
