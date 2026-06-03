import type { DaemonConnection } from "./discovery";

const KEY = "connection";

/** Persist the paired daemon connection (token + WS ports) in extension storage. */
export async function saveConnection(conn: DaemonConnection): Promise<void> {
  await chrome.storage.local.set({ [KEY]: conn });
}

/** Read the paired connection, or null if the extension hasn't been paired yet. */
export async function loadConnection(): Promise<DaemonConnection | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as DaemonConnection | undefined) ?? null;
}
