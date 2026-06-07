import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createActionRecorder } from "./actionRecorder";
import { createDaemon, type PiBridgeInfo } from "./daemon";
import { coerceProposal } from "./proposal";
import { createHelperRegistry } from "./helperRegistry";
import { HttpServer } from "./httpServer";
import { createPairingStore } from "./pairing";
import { fakeActionsStore, fakeDomainSkills, fakeHelpers, fakeRecorder, fakeSkills, lineClient, RecordingChild, SilentChild, silentSpawn } from "./testFakes";
import type { SettingsStore } from "./settings";
import type { PiConfig } from "./piConfig";

const TOKEN = "tok";

function fakeStore(): SettingsStore {
  let cfg: PiConfig = { providers: [] };
  return { get: () => cfg, save: (c) => void (cfg = c) };
}

/** Connect, authenticate, return the first frame back. */
async function wsAuth(port: number): Promise<unknown> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(client, "open");
  client.send(JSON.stringify({ type: "auth", token: TOKEN }));
  const [raw] = (await once(client, "message")) as [Buffer];
  client.close();
  return JSON.parse(raw.toString());
}

describe("createDaemon", () => {
  it("starts the four loopback servers on distinct ports and authenticates each", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      const { bridge, piBridge, conversation, http } = daemon.ports;
      expect(new Set([bridge, piBridge, conversation, http]).size).toBe(4);

      const status = await fetch(`http://127.0.0.1:${http}/status`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(status.status).toBe(200);

      // bridge + conversation are WebSocket; piBridge is TCP (its own tests cover it).
      expect(await wsAuth(bridge)).toEqual({ type: "auth_ok" });
      expect(await wsAuth(conversation)).toEqual({ type: "auth_ok" });
    } finally {
      await daemon.close();
    }
  });

  it("spawns Pi for an authenticated conversation, pointed at the piBridge", async () => {
    const spawns: PiBridgeInfo[] = [];
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills(),
      actionsStore: fakeActionsStore(),
      recorder: fakeRecorder(),
      spawnPi: (bridge) => {
        spawns.push(bridge);
        return new SilentChild();
      },
    });
    try {
      const client = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      await once(client, "open");
      client.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(client, "message"); // auth_ok — Pi is spawned on auth (driver creation)
      expect(spawns).toEqual([{ port: daemon.ports.piBridge, token: TOKEN }]);
      client.close();
    } finally {
      await daemon.close();
    }
  });

  it("relays a Pi tool call through to the connected Chrome bridge", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      // Chrome side (executor): a WS client that answers every tool request.
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (req.id && req.tool) chrome.send(JSON.stringify({ id: req.id, ok: true, result: `did:${req.tool}` }));
      });

      // Pi side (requester): a TCP client through the piBridge.
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "navigate", args: { url: "https://x" } });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: "did:navigate" });

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("enriches a navigate result with domainSkillsAvailable + agentPolicy", async () => {
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills({ list: () => Promise.resolve(["pricing-quirks"]) }),
      actionsStore: fakeActionsStore(),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
    });
    try {
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      let policyCalls = 0;
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (!req.id || !req.tool) return;
        if (req.tool === "getAgentPolicy") policyCalls++;
        const result =
          req.tool === "getAgentPolicy"
            ? { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } }
            : { ok: true };
        chrome.send(JSON.stringify({ id: req.id, ok: true, result }));
      });

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      const enriched = {
        ok: true,
        domainSkillsAvailable: ["pricing-quirks"],
        agentPolicy: { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } },
      };
      pi.send({ id: "1", tool: "navigate", args: { url: "https://shop.example/p/1" } });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: enriched });

      // Second same-origin navigate: the per-origin policy cache (created once in
      // createDaemon) serves the policy, so getAgentPolicy is relayed only once.
      pi.send({ id: "2", tool: "navigate", args: { url: "https://shop.example/p/2" } });
      expect(await pi.next()).toEqual({ id: "2", ok: true, result: enriched });
      expect(policyCalls).toBe(1);

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("keeps the authenticated Chrome bridge when a second connection arrives unauthenticated", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      // Chrome #1 authenticates and answers tool calls — the active bridge.
      const chrome1 = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome1, "open");
      chrome1.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome1, "message"); // auth_ok
      chrome1.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (req.id && req.tool) chrome1.send(JSON.stringify({ id: req.id, ok: true, result: "from-1" }));
      });

      // Chrome #2 connects but never authenticates — must NOT displace #1.
      const chrome2 = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome2, "open");
      await new Promise((r) => setTimeout(r, 25));

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: "from-1" });

      chrome1.close();
      chrome2.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("reports 'no browser connected' after the Chrome bridge disconnects", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.close();
      await once(chrome, "close");
      await new Promise((r) => setTimeout(r, 25)); // let the server mark the session closed

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: false, error: "no browser connected" });
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("routes compact to the active authenticated conversation's Pi", async () => {
    const child = new RecordingChild();
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: () => child });
    try {
      // Authenticate a conversation: Pi (the recording child) is spawned and the
      // session becomes the active conversation (promoted on auth).
      const panel = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      await once(panel, "open");
      panel.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(panel, "message"); // auth_ok — onAuthenticated has run, so it's active

      // Pi's browser_compact arrives over the piBridge → router → active conversation → Pi.
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "compact", args: { customInstructions: "keep the plan" } });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: { ok: true } });
      expect(child.sent()).toContainEqual({ type: "compact", customInstructions: "keep the plan" });

      panel.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("a resolveProposal command saves a skill via domainSkills", async () => {
    const saved: Array<{ host: string; name: string; body: string }> = [];
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills({
        save: (host, name, body) => {
          // Mirror the real store's safeMdName rule so a missing ".md" is caught
          // here (the bare fake would mask it — Codex P1).
          if (!name.endsWith(".md")) return Promise.reject(new Error(`invalid skill name: ${name}`));
          saved.push({ host, name, body });
          return Promise.resolve({ name, host, body, bytes: body.length, updatedAt: 0 });
        },
      }),
      actionsStore: fakeActionsStore(),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
    });
    try {
      const panel = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      await once(panel, "open");
      panel.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(panel, "message"); // auth_ok
      panel.send(
        JSON.stringify({
          type: "resolveProposal",
          proposal: { kind: "skill", name: "checkout", content: "# n", host: "shop.example" },
          accept: true,
        }),
      );
      while (saved.length < 1) await new Promise((r) => setTimeout(r, 5));
      expect(saved[0]).toEqual({ host: "shop.example", name: "checkout.md", body: "# n" });
      panel.close();
    } finally {
      await daemon.close();
    }
  });

  it("a resolveProposal command saves an action via actionsStore", async () => {
    const saved: unknown[] = [];
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills(),
      actionsStore: fakeActionsStore({
        save: (input) => {
          saved.push(input);
          return { ...input, createdAt: 0 };
        },
      }),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
    });
    try {
      const panel = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      await once(panel, "open");
      panel.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(panel, "message"); // auth_ok
      panel.send(
        JSON.stringify({
          type: "resolveProposal",
          proposal: { kind: "action", name: "reorder", content: "re-buy", attach: "activeTab" },
          accept: true,
        }),
      );
      while (saved.length < 1) await new Promise((r) => setTimeout(r, 5));
      expect(saved[0]).toMatchObject({ name: "reorder", content: "re-buy", attach: "activeTab" });
      panel.close();
    } finally {
      await daemon.close();
    }
  });

  it("pushes an actions beat to the panel on auth", async () => {
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills(),
      actionsStore: fakeActionsStore({ list: () => [{ name: "reorder", content: "re-buy", attach: "none", createdAt: 0 }] }),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
    });
    try {
      const panel = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      // Buffer with a persistent listener: auth_ok and the actions beat arrive
      // back-to-back, so a per-iteration `once` could miss the beat that fired
      // between reads.
      let actions: { kind?: string; actions?: unknown } | undefined;
      panel.on("message", (raw: Buffer) => {
        const f = JSON.parse(raw.toString()) as { type?: string; beat?: { kind?: string; actions?: unknown } };
        if (f.type === "beat" && f.beat?.kind === "actions") actions = f.beat;
      });
      await once(panel, "open");
      panel.send(JSON.stringify({ type: "auth", token: TOKEN }));
      while (!actions) await new Promise((r) => setTimeout(r, 5));
      expect(actions).toEqual({ kind: "actions", actions: [{ name: "reorder", content: "re-buy", attach: "none" }] });
      panel.close();
    } finally {
      await daemon.close();
    }
  });

  it("routes callHelper: resolves the helper on the daemon, relays an evaluate to Chrome", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fairy-daemon-helpers-"));
    const helpers = createHelperRegistry(path.join(dir, "helpers.json"));
    helpers.save({ name: "double", expression: "(x) => x * 2" });
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers, domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      // Chrome answers `evaluate` and records the expression it was asked to run.
      let evaluated = "";
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string; args?: { expression?: string } };
        if (req.id && req.tool === "evaluate") {
          evaluated = req.args?.expression ?? "";
          chrome.send(JSON.stringify({ id: req.id, ok: true, result: { ok: true, value: 84 } }));
        }
      });

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "callHelper", args: { name: "double", args: [42] } });
      // the helper ran in the browser via a relayed evaluate, and the value came back
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: { ok: true, value: 84 } });
      expect(evaluated).toContain("(x) => x * 2"); // the daemon injected the helper source
      expect(evaluated).toContain("[42]"); // …and the call args

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records browser steps + callHelper (not other daemon tools) and replays them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fairy-daemon-wf-"));
    const recorder = createActionRecorder(path.join(dir, "workflows.json"));
    const helpers = createHelperRegistry(path.join(dir, "helpers.json"));
    helpers.save({ name: "h", expression: "() => 1" });
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers, domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder, spawnPi: silentSpawn });
    try {
      // Chrome answers every browser tool, counting navigate + evaluate (callHelper relays evaluate).
      const seen: Record<string, number> = {};
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (!req.id || !req.tool) return;
        seen[req.tool] = (seen[req.tool] ?? 0) + 1;
        chrome.send(JSON.stringify({ id: req.id, ok: true, result: { ok: true } }));
      });

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });

      // Record: navigate (browser → recorded) + callHelper (daemon tool that runs
      // in the page → recorded) + domainSkillSave (daemon write → NOT recorded).
      pi.send({ id: "1", tool: "workflowRecordStart", args: { name: "go" } });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: { recording: "go" } });
      pi.send({ id: "2", tool: "navigate", args: { url: "https://x.com" } });
      await pi.next();
      pi.send({ id: "2b", tool: "callHelper", args: { name: "h", args: [] } });
      await pi.next();
      pi.send({ id: "2c", tool: "domainSkillSave", args: { host: "x.com", name: "n.md", body: "b" } });
      await pi.next();
      pi.send({ id: "3", tool: "workflowRecordStop", args: {} });
      // steps:2 — navigate + callHelper; domainSkillSave excluded.
      expect(await pi.next()).toEqual({ id: "3", ok: true, result: { name: "go", steps: 2 } });
      expect(seen.navigate).toBe(1);
      expect(seen.evaluate).toBe(1); // callHelper relayed one evaluate

      // Replay: both steps re-dispatch (callHelper relays evaluate again), no re-recording.
      pi.send({ id: "4", tool: "workflowRun", args: { name: "go", stepDelayMs: 0 } });
      expect(await pi.next()).toEqual({
        id: "4",
        ok: true,
        result: {
          name: "go",
          steps: 2,
          results: [
            { tool: "navigate", ok: true },
            { tool: "callHelper", ok: true },
          ],
        },
      });
      expect(seen.navigate).toBe(2);
      expect(seen.evaluate).toBe(2); // replayed callHelper relayed evaluate again

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles a daemon-owned tool (skill) locally — not relayed, no browser needed", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      // No Chrome bridge connected: a browser tool would answer "no browser
      // connected", but a daemon-owned tool is served by the router.
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "skillPreamble", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: "# skills" });
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("answers a Pi tool call with 'no browser connected' when no Chrome bridge is present", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: false, error: "no browser connected" });
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("exposes the pairing endpoint when a pairing store is provided", async () => {
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills(),
      actionsStore: fakeActionsStore(),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
      pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.ports.http}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "PAIRCODE" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ token: TOKEN });
    } finally {
      await daemon.close();
    }
  });

  it("GET /info reports the live bridge + conversation ports", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.ports.http}/info`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        bridgePort: daemon.ports.bridge,
        conversationPort: daemon.ports.conversation,
      });
    } finally {
      await daemon.close();
    }
  });

  it("close() stops every server", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn });
    const httpPort = daemon.ports.http;
    await daemon.close();
    await expect(
      fetch(`http://127.0.0.1:${httpPort}/status`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    ).rejects.toBeDefined();
  });

  it("rejects and tears down the others if one server can't bind", async () => {
    const occupier = new HttpServer({ token: TOKEN, settings: fakeStore() });
    const taken = await occupier.listen();
    try {
      await expect(
        createDaemon({ token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(), domainSkills: fakeDomainSkills(), actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn, ports: { http: taken } }),
      ).rejects.toBeDefined();
    } finally {
      await occupier.close();
    }
  });
});

describe("coerceProposal", () => {
  it("coerces a valid skill proposal", () => {
    expect(coerceProposal({ kind: "skill", name: " checkout ", content: "# n", host: "shop.example" })).toEqual({
      kind: "skill",
      name: "checkout",
      content: "# n",
      host: "shop.example",
    });
  });

  it("coerces a valid action proposal and defaults an unknown attach to none", () => {
    expect(coerceProposal({ kind: "action", name: "reorder", content: "re-buy", attach: "wat" })).toEqual({
      kind: "action",
      name: "reorder",
      content: "re-buy",
      attach: "none",
      host: undefined,
    });
  });

  it("keeps an explicit attach + host on an action proposal", () => {
    expect(coerceProposal({ kind: "action", name: "r", content: "c", attach: "allTabs", host: "x.com" })).toEqual({
      kind: "action",
      name: "r",
      content: "c",
      attach: "allTabs",
      host: "x.com",
    });
  });

  it("rejects a non-object proposal", () => {
    expect(() => coerceProposal(null)).toThrow("invalid proposal");
    expect(() => coerceProposal(42)).toThrow("invalid proposal");
  });

  it("rejects a missing name or content", () => {
    expect(() => coerceProposal({ kind: "skill", content: "c", host: "h" })).toThrow("proposal name required");
    expect(() => coerceProposal({ kind: "skill", name: "n", host: "h" })).toThrow("proposal content required");
  });

  it("rejects a skill proposal without a host", () => {
    expect(() => coerceProposal({ kind: "skill", name: "n", content: "c" })).toThrow(
      "a skill proposal needs a valid host",
    );
  });

  it("rejects a skill proposal with a file-unsafe host (validated at the boundary)", () => {
    expect(() => coerceProposal({ kind: "skill", name: "n", content: "c", host: "../evil" })).toThrow(
      "a skill proposal needs a valid host",
    );
    expect(() => coerceProposal({ kind: "skill", name: "n", content: "c", host: "shop:8080" })).toThrow(
      "a skill proposal needs a valid host",
    );
  });

  it("rejects a name with newlines/control chars (UI safety)", () => {
    expect(() => coerceProposal({ kind: "action", name: "bad\nname", content: "c" })).toThrow(
      "proposal name must be a single line",
    );
  });

  it("rejects a file-unsafe name for either kind", () => {
    expect(() => coerceProposal({ kind: "skill", name: "a/b", content: "c", host: "x.com" })).toThrow(
      "proposal name must be a plain file-safe label",
    );
    expect(() => coerceProposal({ kind: "action", name: "a:b", content: "c" })).toThrow(
      "proposal name must be a plain file-safe label",
    );
  });

  it("rejects an unknown proposal kind", () => {
    expect(() => coerceProposal({ kind: "mystery", name: "n", content: "c" })).toThrow("unknown proposal kind: mystery");
  });
});
