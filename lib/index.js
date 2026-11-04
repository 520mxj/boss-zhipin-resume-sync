import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const SKILL_PATH = fileURLToPath(
  new URL("../skills/boss-zhipin-resume-sync/SKILL.md", import.meta.url),
);
const PROVIDER_NAME = "boss-zhipin-resume-sync";

function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { metadata: {}, body: normalized };
  }

  const metadata = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) {
      metadata[item[1]] = item[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { metadata, body: normalized.slice(match[0].length) };
}

async function readSkill() {
  const text = await readFile(SKILL_PATH, "utf8");
  const { metadata, body } = parseFrontmatter(text);
  if (!metadata.name || !metadata.description) {
    throw new Error(`Invalid skill frontmatter at ${SKILL_PATH}`);
  }
  return { metadata, body };
}

function candidateFromSkill(skill) {
  return {
    name: skill.metadata.name,
    description: skill.metadata.description,
    invocation: {
      modelInvocable: true,
      userInvocable: true,
    },
    provider: PROVIDER_NAME,
    source: "bundled",
    resourceBase: {
      kind: "directory",
      path: dirname(SKILL_PATH),
    },
    path: SKILL_PATH,
    rank: 0,
    locator: pathToFileURL(SKILL_PATH),
  };
}

export const name = "boss-zhipin-resume-sync";
export const inject = ["skills"];

export function apply(ctx) {
  ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,
    async list() {
      return {
        candidates: [candidateFromSkill(await readSkill())],
        complete: true,
      };
    },
    async get() {
      const skill = await readSkill();
      return {
        name: skill.metadata.name,
        description: skill.metadata.description,
        invocation: {
          modelInvocable: true,
          userInvocable: true,
        },
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: {
          kind: "directory",
          path: dirname(SKILL_PATH),
        },
        path: SKILL_PATH,
        content: skill.body,
      };
    },
  }));
}

