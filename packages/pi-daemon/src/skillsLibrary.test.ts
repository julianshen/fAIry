import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillsLibrary } from "./skillsLibrary";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "fairy-skills-"));
  writeFileSync(path.join(root, "SKILL.md"), "# Browser skills\nUse these.");
  const dir = path.join(root, "interaction-skills");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "iframes.md"), "# iframes\nbody");
  writeFileSync(path.join(dir, "dialogs.md"), "# dialogs\nbody");
  writeFileSync(path.join(dir, "notes.txt"), "ignored"); // non-md ignored
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("skillsLibrary", () => {
  it("preamble returns SKILL.md", async () => {
    const skills = createSkillsLibrary(root);
    expect(await skills.preamble()).toContain("Browser skills");
  });

  it("listInteractions returns the sorted *.md names only", async () => {
    const skills = createSkillsLibrary(root);
    expect(await skills.listInteractions()).toEqual(["dialogs.md", "iframes.md"]);
  });

  it("listInteractions returns [] when the dir is missing", async () => {
    const skills = createSkillsLibrary(path.join(root, "nope"));
    expect(await skills.listInteractions()).toEqual([]);
  });

  it("readInteraction returns a skill body", async () => {
    const skills = createSkillsLibrary(root);
    expect(await skills.readInteraction("iframes.md")).toContain("body");
  });

  it("readInteraction returns null for an unknown skill", async () => {
    const skills = createSkillsLibrary(root);
    expect(await skills.readInteraction("missing.md")).toBeNull();
  });

  it("readInteraction refuses path traversal / non-md names", async () => {
    const skills = createSkillsLibrary(root);
    for (const name of ["../SKILL.md", "a/b.md", "iframes", ".hidden.md", "../../etc/passwd"]) {
      await expect(skills.readInteraction(name), name).rejects.toThrow(/invalid skill name/);
    }
  });
});
