/**
 * Per-origin cache of resolved Agent Policies, used by navigate-enrichment so
 * repeated same-host navigations don't re-fetch /agent.json. Opaque values (the
 * daemon is policy-agnostic). Session-lifetime: one instance per daemon process,
 * no TTL/eviction (origins-per-session are few; policies are stable in-session).
 */
export interface PolicyCache {
  get(origin: string): unknown | undefined;
  set(origin: string, value: unknown): void;
}

export function createPolicyCache(): PolicyCache {
  const map = new Map<string, unknown>();
  return {
    get: (origin) => map.get(origin),
    set: (origin, value) => {
      map.set(origin, value);
    },
  };
}
