import { create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { ProviderModelIcon } from './ProviderModelIcon';

describe('ProviderModelIcon', () => {
  it.each([
    'gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'publishers/google/models/gemini-2.5-flash',
    'google.gemini-2.5-pro',
    'google:gemini-2.5-flash',
    'GEMINI-2.5-PRO',
  ])('uses the Google glyph for OpenAI-compatible model %s', (id) => {
    const renderer = create(<ProviderModelIcon provider="openai" id={id} size={20} />);

    expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-brand-google');
  });

  it.each([
    ['openai/gpt-6-sol', 'tabler-icon-brand-openai'],
    ['openai/o3', 'tabler-icon-brand-openai'],
    ['meta-llama/llama-5-scout', 'tabler-icon-brand-meta'],
    ['google/gemini-3-pro', 'tabler-icon-brand-google'],
  ])('uses the maker of an OpenRouter model %s', (id, glyph) => {
    const renderer = create(<ProviderModelIcon provider="openrouter" id={id} size={20} />);

    expect(renderer.root.findByType('svg').props.className).toContain(glyph);
  });

  it('uses the Anthropic mark for an OpenRouter Claude model', () => {
    const renderer = create(
      <ProviderModelIcon provider="openrouter" id="anthropic/claude-sonnet-5-5" size={20} />
    );

    expect(renderer.root.findByType('path').props.d).toMatch(/^M17\.3041/);
  });

  it('keeps the Azure mark for an Azure deployment of a GPT model', () => {
    const renderer = create(<ProviderModelIcon provider="azure" id="gpt-4o" size={20} />);

    expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-brand-azure');
  });

  it.each(['deepseek/deepseek-v4', 'constructor/model', '/gpt-6'])(
    'keeps the generic mark for an OpenRouter model without a known maker: %s',
    (id) => {
      const renderer = create(<ProviderModelIcon provider="openrouter" id={id} size={20} />);

      expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-sparkles');
    }
  );

  it.each(['gpt-4.1', 'anti-gemini-detector', 'google/gemini/model', 'geminized-model'])(
    'preserves the OpenAI glyph for unrelated model %s',
    (id) => {
      const renderer = create(<ProviderModelIcon provider="openai" id={id} size={20} />);

      expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-brand-openai');
    }
  );
});
