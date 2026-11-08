// `@mindroom/client-sdk/matrix`, the client SDK's subpath for plugins that read the signed-in
// account's Matrix data (docs/architecture.md "Client plugins"): the account's client, a room's
// members as the app follows them, and the app's answer to whether a MindRoom agent is among them.
// Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
export { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';
export { useRoomMembers } from '../app/matrix/hooks/useRoomMembers';
export { hasActiveMindroomAgent } from '../app/matrix/protocol/agentIdentity';
