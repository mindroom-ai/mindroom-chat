// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { NavItemOptions } from './NavItem';
import * as css from './NavItem.css';

const render = (element: React.ReactElement) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(element);
  });
  return renderer.root.findByType('div');
};

describe('NavItemOptions', () => {
  it('stays in the row as plain trailing controls without `shown`', () => {
    const options = render(<NavItemOptions>x</NavItemOptions>);
    expect(options.props['data-shown']).toBeUndefined();
    expect(options.props.className).not.toContain(css.NavItemOptionsReveal);
  });

  it.each([true, false])('stays mounted over the row end with shown=%s', (shown) => {
    const options = render(<NavItemOptions shown={shown}>x</NavItemOptions>);
    expect(options.props['data-shown']).toBe(String(shown));
    expect(options.props.className).toContain(css.NavItemOptionsReveal);
    expect(options.props.className).toContain(css.NavItemOptions);
  });
});
