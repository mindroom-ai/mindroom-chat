// @vitest-environment jsdom
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceTranscript } from './VoiceTranscript';

vi.mock('./VoiceTranscript.css', () => ({
  Transcript: 'Transcript',
  Lines: 'Lines',
  Line: 'Line',
}));

const ECHO = { msgtype: 'm.text', 'com.mindroom.visible_router_voice_echo': true };

describe('VoiceTranscript', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (content: Record<string, unknown>) => {
    act(() => {
      renderer = create(<VoiceTranscript content={content} senderName="Router" />);
    });
    return renderer!.root;
  };
  const text = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(text).join('');

  it('shows the transcript without its microphone, and who transcribed it', () => {
    const root = render({ ...ECHO, body: '🎤 Invented words for the test' });
    expect(text(root.findByProps({ className: 'Transcript' }))).toBe(
      'Invented words for the testTranscribed by Router'
    );
    expect(root.findAll((node) => node.props.role === 'status')).toHaveLength(0);
  });

  it('draws the formatted transcript through renderBody, without its microphone', () => {
    const renderBody = vi.fn(({ customBody }: { body: string; customBody?: string }) => customBody);
    act(() => {
      renderer = create(
        <VoiceTranscript
          content={{
            ...ECHO,
            body: '🎤 @agent:example.org Invented words',
            format: 'org.matrix.custom.html',
            formatted_body:
              '<p>🎤 <a href="https://matrix.to/#/@agent:example.org">@Agent</a> Invented words</p>',
          }}
          senderName="Router"
          renderBody={renderBody}
        />
      );
    });
    expect(renderBody).toHaveBeenCalledWith({
      body: '@agent:example.org Invented words',
      customBody:
        '<p><a href="https://matrix.to/#/@agent:example.org">@Agent</a> Invented words</p>',
    });
  });

  it('keeps the transcript in the direction of its own text', () => {
    const root = render({ ...ECHO, body: '🎤 مرحبا' });
    expect(root.findAll((node) => node.props.dir === 'rtl').length).toBeGreaterThan(0);
  });

  it('shimmers while the router still transcribes, announced as a status', () => {
    const root = render({ ...ECHO, body: 'Router agent is transcribing…' });
    const status = root.find((node) => node.props.role === 'status');
    expect(status.props['aria-label']).toBe('Transcribing…');
    expect(status.findAllByProps({ className: 'Line' })).toHaveLength(2);
    expect(text(status)).toBe('Transcribing…');
    expect(text(status)).not.toContain('Router agent');
  });
});
