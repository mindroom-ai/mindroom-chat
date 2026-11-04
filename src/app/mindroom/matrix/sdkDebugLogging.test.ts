import { logger } from 'matrix-js-sdk/lib/logger';
import { afterEach, expect, it, vi } from 'vitest';
import { quietSdkDebugLogging } from './sdkDebugLogging';

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  vi.restoreAllMocks();
});

const spyOnConsole = () => ({
  debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  trace: vi.spyOn(console, 'trace').mockImplementation(() => undefined),
  info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
});

it('drops debug and trace lines, from methods bound afterwards and from child loggers too', () => {
  const output = spyOnConsole();
  restore = quietSdkDebugLogging();

  // As the timeline set does when it loads: it keeps `logger.log` and calls it later.
  const boundLog = logger.log.bind(logger);
  const child = logger.getChild('[sync]');
  logger.debug('root debug');
  boundLog('bound debug');
  child.debug('child debug');
  child.trace('child trace');
  child.getChild('[grandchild]').debug('grandchild debug');
  logger.info('root info');
  child.warn('child warning');

  expect(output.debug).not.toHaveBeenCalled();
  expect(output.trace).not.toHaveBeenCalled();
  expect(output.info).toHaveBeenCalledWith('root info');
  expect(output.warn).toHaveBeenCalledWith('[sync]', 'child warning');
});

it('logs debug lines again once restored', () => {
  const output = spyOnConsole();
  quietSdkDebugLogging()();

  logger.debug('root debug');
  logger.getChild('[restored]').debug('child debug');

  expect(output.debug).toHaveBeenCalledWith('root debug');
  expect(output.debug).toHaveBeenCalledWith('[restored]', 'child debug');
});
