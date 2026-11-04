import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(root);
const cli = path.join(
  repoRoot,
  "skills",
  "boss-zhipin-resume-sync",
  "scripts",
  "boss-resume.mjs",
);

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("CLI exposes help", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /BOSS Resume Sync/);
});

test("language-neutral resume schema accepts a valid document", () => {
  const result = run(["validate", path.join(root, "fixtures", "sample-resume.json")]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"preserveProjects": true/);
});

test("HTML extraction produces reviewable text", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "boss-resume-test-"));
  try {
    const output = path.join(temp, "source.json");
    const result = run([
      "extract",
      path.join(root, "fixtures", "sample-resume.html"),
      "--out",
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const extracted = JSON.parse(await readFile(output, "utf8"));
    assert.match(extracted.text, /测试先生/);
    assert.match(extracted.text, /运维工程师/);
    assert.equal(extracted.source.format, "html");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("DSH provider registers the shared skill", async () => {
  const plugin = await import("../lib/index.js");
  let provider;
  plugin.apply({
    skills: {
      registerProvider(factory) {
        provider = factory();
      },
    },
  });
  assert.equal(plugin.name, "boss-zhipin-resume-sync");
  const listed = await provider.list();
  assert.equal(listed.complete, true);
  assert.equal(listed.candidates[0].name, "boss-zhipin-resume-sync");
  const loaded = await provider.get();
  assert.match(loaded.content, /Fast path/);
});
