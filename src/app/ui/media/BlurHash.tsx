import { CSSProperties, useEffect, useRef } from 'react';
import { decode, isBlurhashValid } from 'blurhash';

// The hash describes a few colour components, so a small canvas holds all of its detail;
// CSS stretches it over the media box.
const CANVAS_SIZE = 32;

// Pinned to every edge of the media box, under the media and its controls.
const fillBox: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'block',
  width: '100%',
  height: '100%',
};

/** Reads the BlurHash an image or video event carries in `info["xyz.amorgan.blurhash"]`. */
export const getInfoBlurHash = (info: unknown): string | undefined => {
  if (!info || typeof info !== 'object') return undefined;
  const hash = (info as Record<string, unknown>)['xyz.amorgan.blurhash'];
  return typeof hash === 'string' && isBlurhashValid(hash).result ? hash : undefined;
};

type BlurHashProps = {
  hash: string;
  className?: string;
};

/** The blurred colours of a picture, painted over its whole box while the picture loads. */
export function BlurHash({ hash, className }: BlurHashProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    try {
      const pixels = decode(hash, CANVAS_SIZE, CANVAS_SIZE);
      const image = context.createImageData(CANVAS_SIZE, CANVAS_SIZE);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    } catch {
      // An invalid hash leaves the box empty, as without a hash.
    }
  }, [hash]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      aria-hidden="true"
      data-blurhash=""
      className={className}
      style={fillBox}
    />
  );
}
