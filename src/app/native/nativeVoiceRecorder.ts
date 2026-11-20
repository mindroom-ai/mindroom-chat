import { Capacitor, registerPlugin } from '@capacitor/core';
import { randomUuid } from '../lib/randomUuid';

/** Plugin `MindRoomVoiceRecorder` (Mac Catalyst, whose WebKit has no media capture):
 *  start({ nonce }) resolving { id }; level, pause, resume, stop, cancel and keep({ id }) act on
 *  that recording only; level resolves { level } from 0 to 1 and rejects once the recording ended,
 *  also by itself; stop resolves { path } of its `.m4a` once it is whole; cancel deletes it, keep
 *  lets go of it without deleting; orphans resolves the files no window or process holds;
 *  rejections carry `code`. */
type MindRoomVoiceRecorderPlugin = {
  start(options: { nonce: string }): Promise<{ id: string }>;
  level(options: { id: string }): Promise<{ level: number }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
  keep(options: { id: string }): Promise<void>;
  orphans(): Promise<{ recordings: { id: string; path: string; startedAt: number }[] }>;
};

const START_ERROR_NAMES: Record<string, string> = {
  PERMISSION_DENIED: 'NotAllowedError',
  NO_MICROPHONE: 'NotFoundError',
};

let voiceRecorderPlugin: MindRoomVoiceRecorderPlugin | undefined;

const getVoiceRecorderPlugin = (): MindRoomVoiceRecorderPlugin => {
  if (!voiceRecorderPlugin) {
    voiceRecorderPlugin = registerPlugin<MindRoomVoiceRecorderPlugin>('MindRoomVoiceRecorder');
  }
  return voiceRecorderPlugin;
};

/** A file of the native recorder, read through Capacitor; undefined when it is empty or not
 *  answered. */
const readNativeFile = async (path: string): Promise<Blob | undefined> => {
  const response = await fetch(Capacitor.convertFileSrc(path), {
    signal: AbortSignal.timeout(5_000),
  });
  // Capacitor answers a local media file without an HTTP status, which WebKit reports as 0.
  if (!response.ok && response.status !== 0) return undefined;
  const data = await response.blob();
  return data.size > 0 ? data : undefined;
};

export const isNativeVoiceRecorderAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomVoiceRecorder');

/** The part of `MediaRecorder` the voice capture session drives, over the native recorder. */
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'recording';

  readonly mimeType = 'audio/mp4';

  private newestLevel = 0;

  /** The `dataavailable` listeners attached now: audio no one takes stays on disk. */
  private readonly takers = new Set<EventListenerOrEventListenerObject>();

  constructor(private readonly id: string) {
    super();
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (type === 'dataavailable' && listener) this.takers.add(listener);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    if (type === 'dataavailable' && listener) this.takers.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  /** The level the native recorder answered last, 0 before the first; asks it for the next. */
  level(): number {
    if (this.state === 'recording') {
      getVoiceRecorderPlugin()
        .level({ id: this.id })
        .then(
          ({ level }) => {
            this.newestLevel = level;
          },
          // It ended by itself (its device changed, or its file could not be written).
          () => this.endBySelf()
        );
    }
    return this.newestLevel;
  }

  pause(): void {
    this.transition('paused', (plugin) => plugin.pause({ id: this.id }));
  }

  resume(): void {
    this.transition('recording', (plugin) => plugin.resume({ id: this.id }));
  }

  /** Raises `dataavailable` (an Event with `data: Blob`) when there is audio, then `stop`. */
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.deliver().then(
      (taken) => this.end(taken),
      () => this.end(false)
    );
  }

  private transition(
    state: 'recording' | 'paused',
    call: (plugin: MindRoomVoiceRecorderPlugin) => Promise<void>
  ): void {
    if (this.state === 'inactive') return;
    this.state = state;
    // A transition the native recorder refuses would leave a wrong duration: end the recording.
    call(getVoiceRecorderPlugin()).catch(() => this.endBySelf());
  }

  private endBySelf(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.end(false);
  }

  /** True once a listener took the audio. */
  private async deliver(): Promise<boolean> {
    const { path } = await getVoiceRecorderPlugin().stop({ id: this.id });
    const data = await readNativeFile(path);
    if (!data || this.takers.size === 0) return false;
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
    return true;
  }

  /** Every way out, once (`state` is `inactive` by then): the native side deletes a file a
   *  listener took, and keeps any other for `listNativeVoiceOrphans`. */
  private end(taken: boolean): void {
    const plugin = getVoiceRecorderPlugin();
    (taken ? plugin.cancel({ id: this.id }) : plugin.keep({ id: this.id })).catch(() => undefined);
    this.dispatchEvent(new Event('stop'));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (): Promise<NativeVoiceRecorder> => {
  // The plugin reads this name back from the page after the microphone prompt, and records only
  // for the newest start of the page that is still loaded.
  const nonce = randomUuid();
  Object.assign(globalThis, { mindroomVoiceStart: nonce });
  try {
    const { id } = await getVoiceRecorderPlugin().start({ nonce });
    return new NativeVoiceRecorder(id);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};

export type NativeVoiceOrphan = { id: string; file: File; startedAt: number };

/** The recordings a killed app, a reloaded page or a closed window left on disk, oldest first;
 *  none off the Mac app. One that cannot be read is left out. Each stays on disk until
 *  `forgetNativeVoiceRecording`. */
export const listNativeVoiceOrphans = async (): Promise<NativeVoiceOrphan[]> => {
  if (!isNativeVoiceRecorderAvailable()) return [];
  const { recordings } = await getVoiceRecorderPlugin().orphans();
  const orphans = await Promise.all(
    recordings.map(async ({ id, path, startedAt }): Promise<NativeVoiceOrphan | undefined> => {
      const data = await readNativeFile(path).catch(() => undefined);
      return data && { id, file: new File([data], `${id}.m4a`, { type: 'audio/mp4' }), startedAt };
    })
  );
  return orphans
    .filter((orphan): orphan is NativeVoiceOrphan => orphan !== undefined)
    .sort((a, b) => a.startedAt - b.startedAt);
};

/** Deletes the file of a recording `listNativeVoiceOrphans` listed. Rejects while another window
 *  holds it, or when it could not be deleted. */
export const forgetNativeVoiceRecording = async (id: string): Promise<void> => {
  await getVoiceRecorderPlugin().cancel({ id });
};
