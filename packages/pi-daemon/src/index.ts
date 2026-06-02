// Public API of @fairy/pi-daemon.

export { resolvePaths } from "./paths";
export type { DaemonPaths, ResolvePathsInput } from "./paths";

export { encodeLine, LineDecoder } from "./ndjson";
export type { LineErrorHandler } from "./ndjson";

export { JsonLineProcess } from "./jsonLineProcess";
export type {
  ChildLike,
  ReadableLine,
  Spawner,
  JsonLineHandlers,
} from "./jsonLineProcess";

export { PiSession } from "./piSession";
export type { AgentEvent, PiSessionHandlers } from "./piSession";

export { buildAuth, buildSettings, writePiConfig } from "./piConfig";
export type { PiConfig, ProviderConfig, PiAuth } from "./piConfig";

export { mintToken, writeToken, TOKEN_FILENAME } from "./tokenStore";

export { redactConfig } from "./settings";
export type { SettingsStore, RedactedConfig, RedactedProvider } from "./settings";

export { isAllowedOrigin } from "./origin";

export { HttpServer } from "./httpServer";
export type { HttpServerOptions } from "./httpServer";

export { RequestCorrelator } from "./bridge";
export type { ToolRequest, ToolResponse, CorrelatorOptions } from "./bridge";

export { AuthenticatedSession } from "./authenticatedSession";
export type { BridgeConnection, AuthenticatedSessionOptions } from "./authenticatedSession";

export { BridgeSession } from "./bridgeSession";
export type { BridgeSessionOptions } from "./bridgeSession";

export { WsServer } from "./wsServer";
export type { WsServerOptions } from "./wsServer";

export { BridgeServer } from "./bridgeServer";
export type { BridgeServerOptions } from "./bridgeServer";

export { BeatMapper } from "./beatMapper";
export type { PanelBeat, PanelAgentId, PanelRun } from "./beatMapper";

export { ConversationController } from "./conversation";
export type { ConversationControllerOptions } from "./conversation";

export { ConversationSession } from "./conversationSession";
export type { ConversationDriver, ConversationSessionOptions } from "./conversationSession";
