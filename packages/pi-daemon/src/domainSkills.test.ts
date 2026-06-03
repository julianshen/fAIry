import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDomainSkills } from "./domainSkills";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "fairy-domskills-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("domainSkills", () => {
  it("saves a note and reads it back with metadata", async () => {
    const ds = createDomainSkills(root);
    const saved = await ds.save("amazon.com", "checkout.md", "# Checkout\nclick the gold button");
    expect(saved).toMatchObject({ host: "amazon.com", name: "checkout.md", bytes: expect.any(Number) });
    const read = await ds.read("amazon.com", "checkout.md");
    expect(read?.body).toContain("gold button");
    expect(read?.updatedAt).toBeGreaterThan(0);
  });

  it("normalizes the host (lowercase, strips www) so variants share notes", async () => {
    const ds = createDomainSkills(root);
    await ds.save("WWW.Amazon.com", "n.md", "shared");
    expect(await ds.read("amazon.com", "n.md")).not.toBeNull();
    expect(await ds.list("amazon.com")).toEqual(["n.md"]);
  });

  it("list returns sorted .md names, and [] for an unknown host", async () => {
    const ds = createDomainSkills(root);
    await ds.save("x.com", "b.md", "b");
    await ds.save("x.com", "a.md", "a");
    expect(await ds.list("x.com")).toEqual(["a.md", "b.md"]);
    expect(await ds.list("nope.com")).toEqual([]);
  });

  it("read returns null for a missing note", async () => {
    expect(await createDomainSkills(root).read("x.com", "missing.md")).toBeNull();
  });

  it("remove reports whether the note existed", async () => {
    const ds = createDomainSkills(root);
    await ds.save("x.com", "a.md", "a");
    expect(await ds.remove("x.com", "a.md")).toBe(true);
    expect(await ds.remove("x.com", "a.md")).toBe(false);
  });

  describe("search", () => {
    it("finds a substring across hosts, ranked by hit count, with line numbers", async () => {
      const ds = createDomainSkills(root);
      await ds.save("a.com", "one.md", "nothing here");
      await ds.save("a.com", "two.md", "the GOLD button\nand more gold");
      await ds.save("b.com", "x.md", "a single gold mention");
      const hits = await ds.search("gold");
      expect(hits.map((h) => `${h.host}/${h.name}`)).toEqual(["a.com/two.md", "b.com/x.md"]);
      expect(hits[0]?.lines[0]).toMatchObject({ n: 1 });
    });

    it("returns [] for a blank query and honors the limit", async () => {
      const ds = createDomainSkills(root);
      await ds.save("a.com", "1.md", "gold");
      await ds.save("b.com", "2.md", "gold");
      expect(await ds.search("   ")).toEqual([]);
      expect(await ds.search("gold", 1)).toHaveLength(1);
    });
  });

  describe("path-traversal guards", () => {
    it("rejects a host that would escape the root", async () => {
      const ds = createDomainSkills(root);
      for (const host of ["../evil", "..", ".", "a/b", "a\\b", ""]) {
        await expect(ds.save(host, "n.md", "x"), host).rejects.toThrow(/invalid host/);
      }
    });

    it("rejects a name that isn't a plain .md basename", async () => {
      const ds = createDomainSkills(root);
      for (const name of ["../escape.md", "a/b.md", "note", ".hidden.md", "a\\b.md"]) {
        await expect(ds.save("x.com", name, "x"), name).rejects.toThrow(/skill name|\.md/);
      }
    });
  });
});
