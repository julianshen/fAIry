/**
 * The single seam between the browser-tool handlers and Chrome DevTools.
 *
 * Every tool the agent can run reduces to one or more CDP commands. The
 * handlers depend only on this interface, so they stay pure and unit-testable
 * with a fake; the real `chrome.debugger` adapter (attach to the active tab,
 * `sendCommand`) is the one untestable-without-a-browser piece and lives apart
 * as coverage-excluded glue.
 */
export interface CdpClient {
  /**
   * Send a CDP command to the active tab and resolve its result. Mirrors
   * `chrome.debugger.sendCommand` / the POC's `webContents.debugger.sendCommand`.
   * Rejects if the command errors.
   */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
