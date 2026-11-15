import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  effectiveSecretRequestStatus,
  parseSecretRequestContent,
  secretRequestPath,
  type SecretRequest,
} from './secretRequest';

const inner = (overrides: Record<string, unknown> = {}) => ({
  request_id: 'req-1',
  requester_id: '@person:example.org',
  service: 'openrouter',
  display_name: 'OpenRouter',
  hosts: ['openrouter.ai'],
  reason: 'To call models',
  status: 'pending',
  expires_at: 1_000,
  ...overrides,
});

const content = (value: unknown) => ({
  msgtype: 'm.notice',
  body: 'Key needed',
  [MINDROOM_SECRET_REQUEST_KEY]: value,
});

describe('parseSecretRequestContent', () => {
  it('parses the backend contract object', () => {
    expect(parseSecretRequestContent(content(inner()))).toEqual({
      requestId: 'req-1',
      requesterId: '@person:example.org',
      service: 'openrouter',
      displayName: 'OpenRouter',
      hosts: ['openrouter.ai'],
      reason: 'To call models',
      status: 'pending',
      expiresAt: 1_000,
    });
  });

  it('prefers m.new_content', () => {
    const edited = {
      ...content(inner()),
      'm.new_content': content(inner({ status: 'saved' })),
    };
    expect(parseSecretRequestContent(edited)?.status).toBe('saved');
  });

  it('rejects an unknown status', () => {
    expect(parseSecretRequestContent(content(inner({ status: 'done' })))).toBeNull();
  });

  it('rejects non-array or non-string hosts', () => {
    expect(parseSecretRequestContent(content(inner({ hosts: 'openrouter.ai' })))).toBeNull();
    expect(parseSecretRequestContent(content(inner({ hosts: [1] })))).toBeNull();
  });

  it('rejects missing or mistyped fields and non-objects', () => {
    expect(parseSecretRequestContent(content(inner({ expires_at: '1000' })))).toBeNull();
    expect(parseSecretRequestContent(content(inner({ request_id: undefined })))).toBeNull();
    expect(parseSecretRequestContent({ body: 'x' })).toBeNull();
    expect(parseSecretRequestContent(null)).toBeNull();
    expect(parseSecretRequestContent('text')).toBeNull();
  });
});

describe('effectiveSecretRequestStatus', () => {
  const request = (status: SecretRequest['status']): SecretRequest => ({
    requestId: 'r',
    requesterId: '@p:e',
    service: 's',
    displayName: 'S',
    hosts: [],
    reason: '',
    status,
    expiresAt: 1_000,
  });

  it('turns pending into expired at and past expiresAt', () => {
    expect(effectiveSecretRequestStatus(request('pending'), 999)).toBe('pending');
    expect(effectiveSecretRequestStatus(request('pending'), 1_000)).toBe('expired');
    expect(effectiveSecretRequestStatus(request('pending'), 2_000)).toBe('expired');
  });

  it('keeps final statuses', () => {
    expect(effectiveSecretRequestStatus(request('saved'), 2_000)).toBe('saved');
    expect(effectiveSecretRequestStatus(request('declined'), 2_000)).toBe('declined');
  });
});

describe('secretRequestPath', () => {
  it('encodes room and request IDs', () => {
    expect(secretRequestPath('!room:server', 'a/b')).toBe(
      '/api/rooms/!room%3Aserver/secret-requests/a%2Fb'
    );
  });
});
