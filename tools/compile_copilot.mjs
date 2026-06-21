#!/usr/bin/env node
// Compile the canonical Claude Code plugin (SKILL.md + subagents + references)
// into a drop-in GitHub Copilot bundle under copilot/.github/.
//
// One source of truth -> two targets. Run: node tools/compile_copilot.mjs
//
// What it emits:
//   copilot/.github/prompts/atomic-*.prompt.md   <- one per skill + subagent (slash commands)
//   copilot/.github/references/*.md              <- verbatim copy of the framework reference docs
//   copilot/.github/copilot-instructions.md      <- preserved (hand-authored, not overwritten)
//   copilot/.github/instructions/*.instructions.md <- preserved (hand-authored)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "claude-plugin", "atomic-agents");
const SKILLS = join(SRC, "skills");
const AGENTS = join(SRC, "agents");
const REFS = join(SKILLS, "framework", "references");

const OUT = join(ROOT, "copilot", ".github");
const OUT_PROMPTS = join(OUT, "prompts");
const OUT_REFS = join(OUT, "references");

// canonical skill dir / subagent name  ->  Copilot slash command (filename stem)
const NAME_MAP = {
  // skills
  "new-app": "atomic-new-app",
  "create-atomic-schema": "atomic-create-schema",
  "create-atomic-agent": "atomic-create-agent",
  "create-atomic-tool": "atomic-create-tool",
  "create-atomic-context-provider": "atomic-create-context-provider",
  "framework": "atomic-framework",
  "configure-provider": "atomic-configure-provider",
  "add-memory": "atomic-add-memory",
  "add-hooks": "atomic-add-hooks",
  "orchestrate": "atomic-orchestrate",
  "test": "atomic-test",
  // subagents
  "atomic-explorer": "atomic-explore",
  "atomic-reviewer": "atomic-review",
};

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm) meta[mm[1]] = mm[2].trim();
  }
  return { meta, body: m[2] };
}

// Rewrite Claude-Code-isms -> Copilot-isms in body prose.
function rewrite(text) {
  let t = text;

  // 1. Reference links: collapse the Claude folder nesting to the bundled refs dir.
  t = t.replaceAll("../framework/references/", "../references/");
  t = t.replaceAll("framework/references/", "../references/");
  t = t.replaceAll("](references/", "](../references/");
  t = t.replaceAll("`references/", "`../references/");

  // 2. Skill command references -> Copilot slash commands (namespaced + bare-with-"skill").
  for (const [canon, cmd] of Object.entries(NAME_MAP)) {
    t = t.replaceAll(`/atomic-agents:${canon}`, `/${cmd}`);
    t = t.replaceAll(`atomic-agents:${canon}`, `/${cmd}`);
    t = t.replaceAll("`" + canon + "` skill", "`/" + cmd + "` command");
    t = t.replaceAll("`" + canon + "` subagent", "`/" + cmd + "` command");
  }

  // 3. Subagent / Task-tool delegation -> run the equivalent command in-thread.
  t = t.replaceAll("`atomic-explorer`", "`/atomic-explore`");
  t = t.replaceAll("`atomic-reviewer`", "`/atomic-review`");
  t = t.replaceAll("Invoke via the `Task` tool with", "Run it with");
  t = t.replaceAll("Invoke it via the `Task` tool with", "Run it with");
  t = t.replaceAll("via the `Task` tool", "as a command");
  t = t.replaceAll("the `Task` tool", "the command");

  // 4. Context-isolation claims are false in Copilot (commands run in-thread).
  // Neutralize the specific delegation paragraphs first, then mop up generically.
  t = t.replaceAll(
    "Delegate to the `/atomic-explore` command when",
    "Run the `/atomic-explore` command when");
  t = t.replaceAll(
    "The subagent reads the relevant files in isolated context and returns a compact architecture map",
    "It reads the relevant files and returns a compact architecture map");
  t = t.replaceAll(
    "For a small project (a single `main.py` + one or two agents), reading the files directly in the main thread is fine — the isolation upside is thin.",
    "For a small project (a single `main.py` + one or two agents), reading the files directly is fine.");
  t = t.replaceAll(
    "Delegate to the `/atomic-review` command — do not review in the main thread. The subagent runs in isolated context with read-only tools, keeping the review's file exploration out of the parent conversation. Run it with the scope (diff, paths, or module) in the prompt. Review findings return as a single structured report the parent thread can act on.",
    "Run the `/atomic-review` command. It reviews read-only and returns findings as a single structured report you can act on. Provide the scope (diff, paths, or module) in the prompt.");
  // Subagent-context phrasing in the two analyst prompts.
  t = t.replaceAll("the directory the parent thread is operating in", "the directory you are working in");
  t = t.replaceAll("files the parent thread has already surfaced", "files already surfaced");
  t = t.replaceAll("the parent thread should open", "you should open");
  t = t.replaceAll("the parent thread can act on", "you can act on");
  t = t.replaceAll("a summary the parent thread can act on", "a summary you can act on");
  t = t.replaceAll("belong to the parent thread", "belong to a follow-up step");
  t = t.replaceAll("the parent provides scope", "the user provides scope");
  t = t.replaceAll("burns the subagent's own budget", "burns this chat's own budget");
  // Final catch-all for anything missed.
  t = t.replaceAll("the parent thread", "this conversation");
  t = t.replaceAll("parent thread", "this conversation");
  t = t.replaceAll("The subagent", "This command");
  t = t.replaceAll("the subagent", "this command");
  t = t.replaceAll("subagent", "command");

  return t;
}

function yamlSingleQuote(s) {
  return "'" + s.replaceAll("'", "''") + "'";
}

function emitPrompt(canonName, raw, { isAgent }) {
  const cmd = NAME_MAP[canonName];
  const { meta, body } = parseFrontmatter(raw);
  const desc = rewrite(meta.description || `Atomic Agents: ${cmd}`);

  const fm = [
    "---",
    `description: ${yamlSingleQuote(desc)}`,
    "mode: 'agent'",
    "---",
    "",
  ].join("\n");

  // Subagents have no context isolation in Copilot — they run in the main chat
  // thread. Flag that once at the top so behavior is honest.
  const isolationNote = isAgent
    ? "> **Copilot note:** this command runs in your current chat thread (Copilot has no isolated\n> sub-context). It still produces the same structured report; it just shares this conversation's\n> context window. Start it in a fresh chat for the cleanest run.\n\n"
    : "";

  writeFileSync(join(OUT_PROMPTS, `${cmd}.prompt.md`), fm + isolationNote + rewrite(body).trimStart() + "\n");
  return cmd;
}

// ---- build ----
rmSync(OUT_PROMPTS, { recursive: true, force: true });
rmSync(OUT_REFS, { recursive: true, force: true });
mkdirSync(OUT_PROMPTS, { recursive: true });
mkdirSync(OUT_REFS, { recursive: true });

const emitted = [];

// Skills
for (const dir of readdirSync(SKILLS)) {
  const f = join(SKILLS, dir, "SKILL.md");
  if (!existsSync(f)) continue;
  if (!NAME_MAP[dir]) { console.warn(`! skill '${dir}' has no NAME_MAP entry — skipped`); continue; }
  emitted.push(emitPrompt(dir, readFileSync(f, "utf8"), { isAgent: false }));
}

// Subagents
for (const file of readdirSync(AGENTS)) {
  if (!file.endsWith(".md")) continue;
  const canon = file.replace(/\.md$/, "");
  if (!NAME_MAP[canon]) { console.warn(`! agent '${canon}' has no NAME_MAP entry — skipped`); continue; }
  emitted.push(emitPrompt(canon, readFileSync(join(AGENTS, file), "utf8"), { isAgent: true }));
}

// Reference docs (verbatim)
let refCount = 0;
for (const file of readdirSync(REFS)) {
  if (!file.endsWith(".md")) continue;
  copyFileSync(join(REFS, file), join(OUT_REFS, file));
  refCount++;
}

emitted.sort();
console.log(`Compiled ${emitted.length} prompt commands + ${refCount} reference docs:`);
for (const c of emitted) console.log(`  /${c}`);
