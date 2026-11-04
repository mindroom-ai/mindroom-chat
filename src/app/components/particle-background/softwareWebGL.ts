/**
 * Renderer names of WebGL implementations that rasterize on the CPU: SwiftShader (Chromium's
 * fallback, also behind ANGLE's Vulkan backend), Mesa's llvmpipe, lavapipe and softpipe, and
 * Windows' WARP ("Microsoft Basic Render Driver").
 */
const CPU_RENDERER_PATTERN = /swiftshader|llvmpipe|lavapipe|softpipe|basic render driver/i;

type RendererInfo = { UNMASKED_RENDERER_WEBGL?: number };

/** The context's renderer name, unmasked where the browser allows it. */
const readRendererName = (gl: WebGL2RenderingContext): string | undefined => {
  if (typeof gl.getParameter !== 'function') return undefined;
  const info = gl.getExtension('WEBGL_debug_renderer_info') as RendererInfo | null;
  const parameter = info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER;
  if (parameter === undefined) return undefined;
  const name: unknown = gl.getParameter(parameter);
  return typeof name === 'string' ? name : undefined;
};

/**
 * Whether WebGL2 draws on the CPU in this browser, so the particle background should use its
 * light settings. A browser that refuses a context with `failIfMajorPerformanceCaveat` counts,
 * and so does one that creates it on a CPU rasterizer without reporting the caveat: headless
 * Chromium runs WebGL on SwiftShader through ANGLE's Vulkan backend, and Firefox on llvmpipe
 * ignores the attribute. There the full animation keeps the main thread waiting on every frame,
 * which held the startup splash for tens of seconds.
 */
export function rendersWebGLOnCpu(): boolean {
  if (typeof document === 'undefined') return false;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document
      .createElement('canvas')
      .getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (gl === null) return true;
    const renderer = readRendererName(gl);
    return renderer !== undefined && CPU_RENDERER_PATTERN.test(renderer);
  } catch {
    // This runs at the top of the app: a patched getContext must not take it down.
    return false;
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // The probe context is dropped with its canvas anyway.
    }
  }
}
