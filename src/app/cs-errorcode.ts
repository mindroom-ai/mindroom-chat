// Matrix client-server API error codes (`errcode`). Grouped by where the specification defines
// them: its "Common error codes" list first, then the codes individual endpoints document
// (accounts, parameters, rooms, third-party identifiers). Alphabetical inside each group.
// Source: Client-Server API, section "Standard error response".





  M_USER_LOCKED = 'M_USER_LOCKED',
  M_USER_SUSPENDED = 'M_USER_SUSPENDED',

  // Common error codes: the request itself is wrong or the server cannot serve it.





































  M_THREEPID_MEDIUM_NOT_SUPPORTED = 'M_THREEPID_MEDIUM_NOT_SUPPORTED',
  M_THREEPID_NOT_FOUND = 'M_THREEPID_NOT_FOUND',
}
