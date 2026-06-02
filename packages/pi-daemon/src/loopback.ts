/** Hosts the daemon's servers may bind — it must never be reachable off-machine. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Whether `host` is a loopback address the daemon is allowed to bind. Every
 * daemon server defaults to `127.0.0.1`; an explicitly-provided host is checked
 * against this so an exported option can't accidentally expose the control
 * plane / bridge on a public interface (e.g. `0.0.0.0`).
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
