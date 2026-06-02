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

export { redactConfig, isPiConfig, mergeProviderKeys } from "./settings";
export type { SettingsStore, RedactedConfig, RedactedProvider } from "./settings";

export { createFileSettingsStore } from "./settingsStore";
export type { FileSettingsStoreOptions } from "./settingsStore";

export { createDaemon } from "./daemon";
export type { DaemonOptions, DaemonPorts, RunningDaemon, PiBridgeInfo } from "./daemon";

export { ConversationServer } from "./conversationServer";
export type { ConversationServerOptions } from "./conversationServer";

export { isLoopbackHost } from "./loopback";

export { acquireSingleInstanceLock } from "./singleInstance";
export type { SingleInstanceLockOptions, LockHandle } from "./singleInstance";

export { createPairingStore } from "./pairing";
export type { PairingStore, PairingStoreOptions } from "./pairing";

export { timingSafeStrEqual } from "./secureCompare";

export { PiBridgeServer } from "./piBridgeServer";
export type { PiBridgeServerOptions } from "./piBridgeServer";

export { PiBridgeSession } from "./piBridgeSession";
export type { PiBridgeSessionOptions, ToolRelay } from "./piBridgeSession";

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
