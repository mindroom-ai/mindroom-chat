// @vitest-environment jsdom
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AvatarModelMark, ModelBadge } from './ModelBadge';
import { getAiRunInfo } from '../../matrix/protocol/aiRun';

vi.mock('./ModelBadge.css', () => ({
  Badge: 'Badge',
  Frame: 'Frame',
  Label: 'Label',
  Mark: 'Mark',
}));

const avatar = <img alt="Agent" />;
const markOf = (info: Parameters<typeof AvatarModelMark>[0]['info']) =>
  create(<AvatarModelMark info={info}>{avatar}</AvatarModelMark>).root;

describe('ModelBadge', () => {
  it.each([
    ['  my Friendly Model  ', 'my Friendly Model', 'my Friendly Model · friendly_alias (openai)'],
    [undefined, 'Friendly Alias', 'friendly_alias (openai)'],
    ['   ', 'Friendly Alias', 'friendly_alias (openai)'],
    [42, 'Friendly Alias', 'friendly_alias (openai)'],
  ])(
    'renders model display name %s with an alias fallback',
    (displayName, expectedLabel, details) => {
      const info = getAiRunInfo({
        'io.mindroom.ai_run': {
          version: 1,
          model: { config: 'friendly_alias', display_name: displayName, provider: 'openai' },
        },
      });
      const renderer = create(<ModelBadge info={info!} />);

      expect(renderer.root.findByProps({ className: 'Label' }).children).toEqual([expectedLabel]);
      const badge = renderer.root.findByType('button');
      expect(badge.props['aria-label']).toBe(`Model: ${details}`);
      // A hover, focus or tap shows the full name.
      expect(renderer.root.findByProps({ tip: details })).toBeDefined();
    }
  );

  it('uses the Anthropic mark for Claude models routed through Vertex AI', () => {
    const info = { modelConfig: 'fable', modelProvider: 'vertexai', modelId: 'claude-fable-5' };
    const badge = create(<ModelBadge info={info} />).root.findByType('button');
    expect(badge.props['aria-label']).toBe('Model: fable (vertexai / claude-fable-5)');
    expect(badge.findByProps({ className: 'Label' }).children).toEqual(['Fable']);
    expect(badge.findAllByType('svg')).toHaveLength(0);

    // The provider's logo sits on the avatar's corner, hidden from screen readers.
    const frame = markOf(info).findByProps({ className: 'Frame' });
    expect(frame.findByType('img').props.alt).toBe('Agent');
    const mark = frame.findByProps({ className: 'Mark' });
    expect(mark.props['aria-hidden']).toBe('true');
    const icon = mark.findByType('svg');
    expect(icon.props.viewBox).toBe('0 0 24 24');
    expect(icon.props.fill).toBe('currentColor');
    expect(icon.findByType('path').props.d).toContain('17.3041 3.541');
  });

  it('shows the avatar without a mark when the run names no model', () => {
    const root = markOf({ runId: 'run-1' });

    expect(root.findByType('img').props.alt).toBe('Agent');
    expect(root.findAllByProps({ className: 'Mark' })).toHaveLength(0);
    expect(create(<ModelBadge info={{ runId: 'run-1' }} />).toJSON()).toBeNull();
  });

  it.each([
    ['vertexai', 'publishers/anthropic/models/claude-fable-5'],
    ['bedrock', 'anthropic.claude-fable-5'],
  ])('recognizes provider-prefixed Claude model IDs from %s', (modelProvider, modelId) => {
    const icon = markOf({ modelConfig: 'fable', modelProvider, modelId }).findByType('svg');

    expect(icon.props.fill).toBe('currentColor');
    expect(icon.findByType('path').props.d).toContain('17.3041 3.541');
  });

  it.each(['anti-claude-detector', 'foo/claude/bar', 'claudette-5'])(
    'keeps the generic provider icon for unrelated model ID %s',
    (modelId) => {
      const anthropicPaths = markOf({ modelConfig: 'fable', modelProvider: 'vertexai', modelId })
        .findByType('svg')
        .findAllByType('path')
        .filter((path) => String(path.props.d).includes('17.3041 3.541'));

      expect(anthropicPaths).toHaveLength(0);
    }
  );
});
