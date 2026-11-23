import { MatrixClient } from 'matrix-js-sdk';
import { sendEncryptedToDeviceRequest } from '../matrix/runtimeToDeviceTransport';
import { ModelRuntime } from './modelDeviceTrust';
import { MODEL_REQUEST } from './modelProtocol';

export const sendModelRequest = (
  mx: MatrixClient,
  devices: ModelRuntime[],
  content: Record<string, unknown>,
  signal: AbortSignal,
  answered: (runtimeId: string) => boolean
): Promise<void> =>
  sendEncryptedToDeviceRequest(mx, MODEL_REQUEST, devices, content, signal, answered);
