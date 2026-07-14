import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MindroomModelBadge } from './MindroomModelBadge';

vi.mock('./MindroomModelBadge.css', () => ({
  Badge: 'Badge',
  Icon: 'Icon',
  Label: 'Label',
}));

describe('MindroomModelBadge', () => {
  it('uses the Anthropic mark for Claude models routed through Vertex AI', () => {
    const renderer = create(
      <MindroomModelBadge
        info={{
          modelConfig: 'fable',
          modelProvider: 'vertexai',
          modelId: 'claude-fable-5',
        }}
      />
    );

    const badge = renderer.root.findByProps({
      'aria-label': 'Model: fable (vertexai / claude-fable-5)',
    });
    const icon = badge.findByType('svg');

    expect(icon.props.viewBox).toBe('0 0 24 24');
    expect(icon.props.fill).toBe('currentColor');
    expect(icon.findByType('path').props.d).toContain('17.3041 3.541');
    expect(badge.findByProps({ className: 'Label' }).children).toEqual(['Fable']);
  });
});
