// A scripted stand-in for Pi: the daemon spawns it (FAIRY_PI_BIN) with the
// piBridge port/token injected. It speaks the piBridge line protocol and runs a
// fixed sequence of browser tool calls — no LLM. The booking script is passed via
// FAIRY_FAKE_PI_SCRIPT (a JSON array of {tool,args}); navigate URL via FAIRY_FAKE_PI_URL.
import { createConnection } from "node:net";
import { existsSync } from "node:fs";

const PORT = Number(process.env.FAIRY_PI_BRIDGE_PORT ?? 0);
const TOKEN = process.env.FAIRY_PI_BRIDGE_TOKEN ?? "";
const STEPS: Array<{ tool: string; args: Record<string, unknown> }> =
  JSON.parse(process.env.FAIRY_FAKE_PI_SCRIPT ?? "[]");
// Optional go-signal: a file the spec creates AFTER binding the tab, so the tool
// script never races ahead of the bind (no fixed-delay guess).
const GO_FILE = process.env.FAIRY_FAKE_PI_GO ?? "";

if (!PORT) { console.error("fake-pi: FAIRY_PI_BRIDGE_PORT not set"); process.exit(2); }

const sock = createConnection({ host: "127.0.0.1", port: PORT });
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let buf = "";
let nextId = 0;

sock.on("connect", () => sock.write(JSON.stringify({ type: "auth", token: TOKEN }) + "\n"));
sock.on("data", (d: Buffer) => {
  buf += d.toString();
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as { id?: string; ok?: boolean; result?: unknown; error?: string };
    if (msg.id === undefined) continue; // auth_ok ack
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error ?? "tool error"));
  }
});
sock.on("error", (e) => { console.error("fake-pi socket error:", e.message); process.exit(3); });

function call(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const id = `fp-${++nextId}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sock.write(JSON.stringify({ id, tool, args }) + "\n");
  });
}

async function run() {
  // Wait for the bind go-signal (the spec writes GO_FILE after agent:taskStart
  // succeeds) so the script never drives tools before the tab is bound. Falls back
  // to a fixed settle when no signal is configured.
  if (GO_FILE) {
    const deadline = Date.now() + 30_000;
    while (!existsSync(GO_FILE)) {
      if (Date.now() > deadline) { console.error("fake-pi: go-signal never arrived"); process.exit(4); }
      await new Promise((r) => setTimeout(r, 50));
    }
  } else {
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    for (const step of STEPS) {
      await call(step.tool, step.args);
      await new Promise((r) => setTimeout(r, 150)); // let the page settle between actions
    }
  } catch (err) {
    console.error("fake-pi: step failed:", (err as Error).message);
    process.exit(1);
  }
  console.log("fake-pi: script complete");
  sock.end();
  process.exit(0);
}
// give the socket a moment to connect+auth before driving
sock.once("connect", () => { void run(); });
