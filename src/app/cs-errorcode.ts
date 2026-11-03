// Matrix client-server API error codes (`errcode`). Grouped by where the specification defines
// them: its "Common error codes" list first, then the codes individual endpoints document
// (accounts, parameters, rooms, third-party identifiers). Alphabetical inside each group.
// Source: Client-Server API, section "Standard error response".
export const ErrorCode = {
  // Common error codes: the caller is not allowed to do this.
  M_FORBIDDEN: 'M_FORBIDDEN',
  M_MISSING_TOKEN: 'M_MISSING_TOKEN',
  M_UNKNOWN_TOKEN: 'M_UNKNOWN_TOKEN',
  M_USER_LOCKED: 'M_USER_LOCKED',
  M_USER_SUSPENDED: 'M_USER_SUSPENDED',

  // Common error codes: the request itself is wrong or the server cannot serve it.
  M_BAD_JSON: 'M_BAD_JSON',
  M_LIMIT_EXCEEDED: 'M_LIMIT_EXCEEDED',
  M_NOT_FOUND: 'M_NOT_FOUND',
  M_NOT_JSON: 'M_NOT_JSON',
  M_UNKNOWN: 'M_UNKNOWN',
  M_UNRECOGNIZED: 'M_UNRECOGNIZED',

  // Per-API codes: accounts, registration and authentication.
  M_EXCLUSIVE: 'M_EXCLUSIVE',
  M_INVALID_USERNAME: 'M_INVALID_USERNAME',
  M_UNAUTHORIZED: 'M_UNAUTHORIZED',
  M_USER_DEACTIVATED: 'M_USER_DEACTIVATED',
  M_USER_IN_USE: 'M_USER_IN_USE',
  M_WEAK_PASSWORD: 'M_WEAK_PASSWORD',

  // Per-API codes: request parameters and size limits.
  M_INVALID_PARAM: 'M_INVALID_PARAM',
  M_MISSING_PARAM: 'M_MISSING_PARAM',
  M_RESOURCE_LIMIT_EXCEEDED: 'M_RESOURCE_LIMIT_EXCEEDED',
  M_TOO_LARGE: 'M_TOO_LARGE',

  // Per-API codes: rooms.
  M_BAD_STATE: 'M_BAD_STATE',
  M_CANNOT_LEAVE_SERVER_NOTICE_ROOM: 'M_CANNOT_LEAVE_SERVER_NOTICE_ROOM',
  M_GUEST_ACCESS_FORBIDDEN: 'M_GUEST_ACCESS_FORBIDDEN',
  M_INCOMPATIBLE_ROOM_VERSION: 'M_INCOMPATIBLE_ROOM_VERSION',
  M_INVALID_ROOM_STATE: 'M_INVALID_ROOM_STATE',
  M_ROOM_IN_USE: 'M_ROOM_IN_USE',
  M_UNSUPPORTED_ROOM_VERSION: 'M_UNSUPPORTED_ROOM_VERSION',

  // Per-API codes: third-party identifiers and captchas.
  M_CAPTCHA_INVALID: 'M_CAPTCHA_INVALID',
  M_CAPTCHA_NEEDED: 'M_CAPTCHA_NEEDED',
  M_SERVER_NOT_TRUSTED: 'M_SERVER_NOT_TRUSTED',
  M_THREEPID_AUTH_FAILED: 'M_THREEPID_AUTH_FAILED',
  M_THREEPID_DENIED: 'M_THREEPID_DENIED',
  M_THREEPID_IN_USE: 'M_THREEPID_IN_USE',
  M_THREEPID_MEDIUM_NOT_SUPPORTED: 'M_THREEPID_MEDIUM_NOT_SUPPORTED',
  M_THREEPID_NOT_FOUND: 'M_THREEPID_NOT_FOUND',
} as const;

/** Any of the error code strings above. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
