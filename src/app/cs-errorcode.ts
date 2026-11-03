// Matrix client-server API error codes (`errcode`). Grouped by where the specification defines
// them: its "Common error codes" list first, then the codes individual endpoints document
// (accounts, parameters, rooms, third-party identifiers). Alphabetical inside each group.
export enum ErrorCode {
  // Common error codes: the caller is not allowed to do this.



  M_USER_LOCKED = 'M_USER_LOCKED',
  M_USER_SUSPENDED = 'M_USER_SUSPENDED',

  // Common error codes: the request itself is wrong or the server cannot serve it.







  // Per-API codes: accounts, registration and authentication.







  // Per-API codes: request parameters and size limits.





  // Per-API codes: rooms.









  // Per-API codes: third-party identifiers and captchas.






}
