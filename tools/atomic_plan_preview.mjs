#!/usr/bin/env node
// Offline dry-run preview for /atomic-plan.
// Reads an intake file + the planning/ templates and prints the ADO work-item tree
// (Epic -> Feature -> Stories) WITHOUT touching Azure DevOps. This is the same tree
// /atomic-plan shows in its mandatory PREVIEW gate; when the ADO MCP is connected the
// live skill additionally dedups against the project and creates the items.
//
//   node tools/atomic_plan_preview.mjs --intake planning/examples/generic-agent.intake.yaml
//   node tools/atomic_plan_preview.mjs --intake planning/examples/ups-tracking.intake.yaml --pack ups
//
// Zero dependencies (matches compile_copilot.mjs). Templates use a small YAML subset.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TPL = join(ROOT, "planning", "templates", "core");
const PACKS = join(ROOT, "planning", "packs");

// ---------- minimal YAML-subset parser (maps, nested maps, lists of scalars, lists of {k:v}) ----------
function parseYaml(text) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    lines.push({ indent, text: raw.slice(indent).replace(/\s+$/, "") });
  }
  let pos = 0;
  const scalar = (s) => {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~" || s === "") return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    return s;
  };
  function parseBlock(minIndent) {
    if (pos >= lines.length || lines[pos].indent < minIndent) return null;
    return lines[pos].text.startsWith("- ") ? parseSeq(lines[pos].indent) : parseMap(lines[pos].indent);
  }
  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length) {
      const ln = lines[pos];
      if (ln.indent !== indent || ln.text.startsWith("- ")) break;
      const m = ln.text.match(/^([^:]+):\s*(.*)$/);
      if (!m) { pos++; continue; }
      const key = m[1].trim();
      pos++;
      if (m[2] === "") {
        obj[key] = (pos < lines.length && lines[pos].indent > indent) ? parseBlock(indent + 1) : null;
      } else {
        obj[key] = scalar(m[2]);
      }
    }
    return obj;
  }
  function parseSeq(indent) {
    const arr = [];
    while (pos < lines.length) {
      const ln = lines[pos];
      if (ln.indent !== indent || !ln.text.startsWith("- ")) break;
      const after = ln.text.slice(2);
      if (after.startsWith('"') || after.startsWith("'")) { pos++; arr.push(scalar(after)); continue; }
      const inline = after.match(/^([\w.-]+):\s*(.*)$/);
      if (inline) {
        const itemIndent = indent + 2;
        lines[pos] = { indent: itemIndent, text: after };
        arr.push(parseMap(itemIndent));
      } else {
        pos++; arr.push(scalar(after));
      }
    }
    return arr;
  }
  return parseBlock(0) || {};
}

const loadYaml = (p) => parseYaml(readFileSync(p, "utf8"));
const snake = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const render = (s, v) => typeof s === "string" ? s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (v[k] ?? `{{${k}}}`)) : s;

// ---------- args ----------
const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const intakePath = getArg("--intake");
if (!intakePath) { console.error("usage: atomic_plan_preview.mjs --intake <file.yaml> [--pack <name>]"); process.exit(2); }
const intake = loadYaml(join(ROOT, intakePath.replace(/^\.\//, "")));
const pack = getArg("--pack") || intake.pack || "core";

// ---------- template resolution (pack overrides core by componentType; MVP = whole-file override) ----------
function loadTemplate(kind, type) {
  if (pack !== "core") {
    const packFile = type
      ? join(PACKS, pack, "story", `${type}.yaml`)
      : join(PACKS, pack, `${kind}.yaml`);
    if (existsSync(packFile)) return { tpl: loadYaml(packFile), overridden: true };
  }
  const coreFile = type ? join(TPL, "story", `${type}.yaml`) : join(TPL, `${kind}.yaml`);
  return { tpl: loadYaml(coreFile), overridden: false };
}
const portability = loadYaml(join(TPL, "_shared", "portability-ac.yaml"));
const packManifest = pack !== "core" && existsSync(join(PACKS, pack, "pack.manifest.yml"))
  ? loadYaml(join(PACKS, pack, "pack.manifest.yml")) : null;

// ---------- base variables ----------
const baseVars = {
  application: intake.application,
  application_slug: kebab(intake.application),
  agent_name: intake.agent?.name,
  agent_slug: snake(intake.agent?.name),
  provider: intake.provider || "openai",
  ...(packManifest?.variables || {}),
};

// ---------- build story selection (rules live here, not in templates) ----------
const tools = intake.tools || [];
const cps = intake.contextProviders || [];
const selection = [];
const add = (type, vars = {}, overridden = false) => selection.push({ type, vars: { ...baseVars, ...vars }, overridden });

add("schema");
add("agent");
add("provider-config");
for (const t of tools) add("tool", { tool_name: t.name, tool_slug: snake(t.name), ups_mcp_tool: t.ups_mcp_tool || t.name });
for (const c of cps) add("context-provider", { cp_name: c.name, cp_slug: snake(c.name) });
if (intake.memory) add("memory");
if (intake.hooks) add("hooks");
add("test");
add("review");

// ---------- render nodes ----------
function renderItem(kind, type, vars) {
  const { tpl, overridden } = loadTemplate(kind, type);
  const acs = (tpl.acceptanceCriteria || []).map((a) => render(a.text, vars));
  return {
    title: render(tpl.titleTemplate, vars),
    skill: tpl.skill,
    points: tpl.storyPoints ?? 0,
    paths: (tpl.expectedPaths || []).map((p) => render(p, vars)),
    acs,
    portability: !!tpl.includePortability,
    overridden,
  };
}

const epic = renderItem("epic", null, baseVars);
const feature = renderItem("feature", null, baseVars);
const stories = selection.map((s) => renderItem(null, s.type, s.vars));
const totalPts = stories.reduce((n, s) => n + (s.points || 0), 0);
const portAcs = (portability.acceptanceCriteria || []).map((a) => render(a.text, baseVars));

// ---------- print ----------
const L = [];
L.push("");
L.push(`Atomic Agent Factory — plan preview   (pack: ${pack}${pack === "core" ? " — domain-agnostic" : ""})`);
L.push(`DRY RUN — nothing is written to Azure DevOps. Markers are NEW because no ADO project is bound offline.`);
L.push("─".repeat(78));
L.push(`Epic    ${epic.title}                              [NEW]`);
L.push(`        ⚠ agents are Features, never Epics — Epic = application/initiative`);
L.push(`  └─ Feature  ${feature.title}                     [NEW]   ~${totalPts} pts across ${stories.length} stories`);
for (let i = 0; i < stories.length; i++) {
  const s = stories[i];
  const last = i === stories.length - 1;
  const branch = last ? "     └─" : "     ├─";
  const tag = s.overridden ? ` (pack:${pack})` : "";
  L.push(`${branch} Story  ${s.title}`);
  L.push(`     ${last ? " " : "│"}        ·${s.skill}·  ${s.points}pt${tag}  [NEW]${s.portability ? "  +portability ACs" : ""}`);
  for (const p of s.paths) L.push(`     ${last ? " " : "│"}        → ${p}`);
}
L.push("");
L.push("Portability DoD — stamped on the Feature and every component Story (description checklist):");
for (const a of portAcs) L.push(`  [ ] ${a}`);
L.push("");
L.push("Summary:");
L.push(`  1 Epic · 1 Feature · ${stories.length} Stories · 0 Test Cases (MVP: AC as description checklist)`);
L.push(`  Orchestration: none (single agent). Adds an Epic-level Orchestration story once a 2nd agent joins.`);
L.push(`  Idempotency: live run stamps <!-- afid:<hash> --> in each description and WIQL-scans before create.`);
L.push("");
L.push("Next (when Azure DevOps MCP is connected):");
L.push(`  /atomic-agents:plan --bind   then approve this preview to batch-create via wit_add_child_work_items.`);
L.push("");
console.log(L.join("\n"));
