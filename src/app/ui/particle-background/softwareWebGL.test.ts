import { afterEach, describe, expect, it, vi } from 'vitest';

import { rendersWebGLOnCpu } from './softwareWebGL';

const UNMASKED_RENDERER = 0x9246;
const RENDERER = 0x1f01;

type ProbeContext = {
  loseContext: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
};

/** A document whose canvases answer `getContext` with a context naming `renderer`. */
const stubRenderer = (
  renderer: string | undefined,
  options: { unmasked?: boolean } = {}
): ProbeContext => {
  const loseContext = vi.fn();
  const unmasked = options.unmasked ?? true;
  const context = {
    RENDERER,
    getExtension: (name: string) => {
      if (name === 'WEBGL_lose_context') return { loseContext };
      if (name === 'WEBGL_debug_renderer_info' && unmasked) {
        return { UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER };
      }
      return null;
    },
    getParameter: (parameter: number) =>
      parameter === (unmasked ? UNMASKED_RENDERER : RENDERER) ? renderer : 'WebKit WebGL',
  };
  const getContext = vi.fn(() => context);
  vi.stubGlobal('document', { createElement: () => ({ getContext }) });
  return { loseContext, getContext };
};

describe('rendersWebGLOnCpu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts a browser that refuses a context with the performance caveat', () => {
    const getContext = vi.fn(() => null);
    vi.stubGlobal('document', { createElement: () => ({ getContext }) });

    expect(rendersWebGLOnCpu()).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true });
  });

  it("counts headless Chromium's SwiftShader behind ANGLE's Vulkan backend", () => {
    const probe = stubRenderer(
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
    );

    expect(rendersWebGLOnCpu()).toBe(true);
    expect(probe.loseContext).toHaveBeenCalledOnce();
  });

  it('counts Mesa and Windows CPU rasterizers, also from the masked renderer name', () => {
    stubRenderer('llvmpipe (LLVM 17.0.6, 256 bits)', { unmasked: false });
    expect(rendersWebGLOnCpu()).toBe(true);

    stubRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)');
    expect(rendersWebGLOnCpu()).toBe(true);
  });

  it('leaves a GPU renderer on the full animation and releases the probe context', () => {
    const probe = stubRenderer('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090, OpenGL ES 3.2)');

    expect(rendersWebGLOnCpu()).toBe(false);
    expect(probe.loseContext).toHaveBeenCalledOnce();
  });

  it('treats a context without a readable renderer as a GPU one', () => {
    stubRenderer(undefined);
    expect(rendersWebGLOnCpu()).toBe(false);

    const loseContext = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ getExtension: () => ({ loseContext }) }) }),
    });
    expect(rendersWebGLOnCpu()).toBe(false);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('never throws when the canvas API does', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => {
          throw new Error('blocked');
        },
      }),
    });

    expect(rendersWebGLOnCpu()).toBe(false);
  });
});
