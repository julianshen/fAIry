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

export { RequestCorrelator } from "./bridge";
export type { ToolRequest, ToolResponse, CorrelatorOptions } from "./bridge";

export { BridgeSession } from "./bridgeSession";
export type { BridgeConnection, BridgeSessionOptions } from "./bridgeSession";
