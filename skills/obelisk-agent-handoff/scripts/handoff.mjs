#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildQuery, validateRequest } from "./context-query.mjs";
import { restoreReceipt, readableReceipt, textWindow } from "./receipt-source.mjs";

const HELP = `Usage: node handoff.mjs <locate|hydrate|audit|read|receipt|verify>
  --root codex:<full-UUID> --project <exact-indexed-path> [--out-root <local-directory>]
  hydrate: --anchor <full-message-UUID> (repeatable), --query <topic> (repeatable)
  audit:   --agent main|codex:<full-UUID> [--checkpoint <json-file>]
  read:    --uuid <full-message-UUID> [--agent main|codex:<full-UUID>]
  receipt: --uuid <full-tool-message-UUID> [--agent main|codex:<full-UUID>] [--tool-id <full-tool-ID>]
  verify:  --uuid <full-message-UUID> (repeatable) [--agent main|codex:<full-UUID>]
           or --refs <references.json> for mixed explicitly scoped references
  locate:  [--phrase <distinctive-user-phrase>] [--marker <unique-worker-marker>] (root can be omitted)
  read/receipt: [--find <literal-text> | --offset <integer>] [--chars <120..12000>]
  query bounds: --limit <1..40> --excerpt-chars <120..2000> --max-chars <1000..24000>
All queries are generated and run automatically. Full local results and source references are saved.
`;

const readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));

export function parseCommand(args) {
  if (args.length === 0 || args.includes("--help")) return { help: true };
  const [mode, ...rest] = args;
  const flags = new Set(["--root", "--project", "--out-root", "--agent", "--anchor", "--query", "--uuid",
    "--tool-id", "--checkpoint", "--refs", "--phrase", "--marker", "--find", "--offset", "--chars", "--limit", "--excerpt-chars", "--max-chars"]);
  const repeated = new Set(["--anchor", "--query", "--uuid"]);
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!flags.has(key) || rest[i + 1] === undefined || rest[i + 1].startsWith("--")) throw new TypeError(`Invalid or missing argument: ${key}`);
    if (values[key] && !repeated.has(key)) throw new TypeError(`Duplicate argument: ${key}`);
    if (repeated.has(key)) (values[key] ??= []).push(rest[i + 1]);
    else values[key] = rest[i + 1];
  }
  const used = (flag, modes) => { if (values[flag] !== undefined && !modes.includes(mode)) throw new TypeError(`${flag} is not valid for ${mode}`); };
  used("--anchor", ["hydrate"]); used("--query", ["hydrate"]); used("--checkpoint", ["audit"]);
  used("--refs", ["verify"]); used("--phrase", ["locate"]); used("--tool-id", ["receipt"]);
  used("--marker", ["locate"]);
  used("--uuid", ["read", "receipt", "verify"]); used("--agent", ["audit", "read", "receipt", "verify"]);
  for (const flag of ["--find", "--offset", "--chars"]) used(flag, ["read", "receipt"]);
  const number = (flag, fallback) => {
    if (values[flag] === undefined) return fallback;
    if (!/^[0-9]+$/.test(values[flag])) throw new TypeError(`${flag} must be a non-negative integer`);
    return Number(values[flag]);
  };
  const request = { mode, project_path: values["--project"], ...(values["--root"] ? { root_session_id: values["--root"] } : {}) };
  for (const [flag, key] of [["--limit", "limit"], ["--excerpt-chars", "excerpt_chars"], ["--max-chars", "max_chars"]]) {
    if (values[flag] !== undefined) request[key] = number(flag);
  }
  const agent = values["--agent"] === undefined || values["--agent"] === "main" ? null : values["--agent"];
  if (mode === "locate" && values["--phrase"]) request.user_phrase = values["--phrase"];
  if (mode === "locate" && values["--marker"]) request.task_marker = values["--marker"];
  if (mode === "hydrate") { request.anchors = values["--anchor"] ?? []; request.queries = values["--query"] ?? []; }
  if (["audit", "read", "receipt"].includes(mode)) request.agent_id = agent;
  if (mode === "audit" && values["--checkpoint"]) request.checkpoint = readJson(values["--checkpoint"]);
  if (["read", "receipt"].includes(mode)) {
    if (values["--uuid"]?.length !== 1) throw new TypeError(`${mode} needs exactly one --uuid`);
    request.uuid = values["--uuid"][0];
    if (values["--tool-id"]) request.tool_use_id = values["--tool-id"];
  }
  if (mode === "verify") {
    if (values["--refs"] && values["--uuid"]) throw new TypeError("Use --refs or --uuid, not both");
    if (values["--refs"] && values["--agent"]) throw new TypeError("--refs uses each reference's explicit agent_id; omit --agent");
    const refs = values["--refs"] ? readJson(values["--refs"]) : null;
    request.references = refs ? refs.references ?? refs : (values["--uuid"] ?? []).map((uuid) => ({ uuid, agent_id: agent }));
  }
  const window = { chars: number("--chars", 3000), offset: number("--offset", 0),
    ...(values["--find"] === undefined ? {} : { find: values["--find"] }) };
  if (window.chars < 120 || window.chars > 12000 || !Number.isSafeInteger(window.offset) ||
      (values["--find"] !== undefined && values["--offset"] !== undefined)) throw new TypeError("Invalid text window; use --find or --offset, with --chars 120..12000");
  return { request: validateRequest(request), outRoot: values["--out-root"] ?? os.tmpdir(), window };
}

// Use argv, never a command string. npm's Windows .cmd/.ps1 shims are resolved to their JS entry.
export function findObeliskCommand(env = process.env) {
  for (const directory of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const packageRoot = path.join(directory, "node_modules", "@obelisk-apps", "cli");
    const manifest = path.join(packageRoot, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = readJson(manifest);
      const entry = path.resolve(packageRoot, pkg.bin?.obelisk ?? "");
      if (entry.startsWith(`${path.resolve(packageRoot)}${path.sep}`) && fs.existsSync(entry)) return { executable: process.execPath, args: [entry] };
    }
    const names = process.platform === "win32" ? ["obelisk.exe"] : ["obelisk"];
    for (const name of names) {
      const filename = path.join(directory, name);
      if (!fs.existsSync(filename)) continue;
      const real = fs.realpathSync(filename);
      return /\.[cm]?js$/.test(real) ? { executable: process.execPath, args: [real] } : { executable: filename, args: [] };
    }
  }
  throw new Error("Cannot locate Obelisk CLI on PATH; install or expose the obelisk npm command");
}

export function executeQuery(request, directory, command = findObeliskCommand()) {
  const queryFile = path.join(directory, "query.mjs");
  fs.writeFileSync(queryFile, buildQuery(request), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const run = spawnSync(command.executable, [...command.args, "--query", queryFile], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(directory, "obelisk-stdout.txt"), run.stdout ?? "", { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "obelisk-stderr.txt"), run.stderr ?? "", { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "execution.json"), JSON.stringify({ exit_code: run.status,
    signal: run.signal, error_code: run.error?.code ?? null }, null, 2), { mode: 0o600 });
  if (run.error || run.status !== 0) throw new Error(`Obelisk refresh/query failed (exit ${run.status}); inspect local stdout/stderr artifacts. No source recovery was attempted.`);
  try { return JSON.parse((run.stdout ?? "").replace(/^\uFEFF/, "")); }
  catch { throw new Error("Obelisk returned invalid JSON; no source recovery was attempted"); }
}

export async function runCommand(options, query = executeQuery) {
  if (!fs.statSync(options.outRoot).isDirectory()) throw new TypeError("--out-root must be an existing local directory");
  const directory = fs.mkdtempSync(path.join(path.resolve(options.outRoot), `obelisk-${options.request.mode}-`));
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  save("request.json", options.request);
  let result;
  try { result = await query(options.request, directory); }
  catch (error) { error.artifacts = { directory }; throw error; }
  if (options.request.mode === "receipt" && result.status === "receipt_descriptor") {
    save("indexed-descriptor.json", result);
    let restored = await restoreReceipt(result);
    if (restored.gap === "source_changed") restored = await restoreReceipt(result);
    if (restored.status === "recovered") {
      save("receipt.json", { content: restored.content, provenance: restored.provenance, source_ref: restored.source_ref });
      const readable = readableReceipt(restored.content);
      fs.writeFileSync(path.join(directory, "receipt.txt"), readable, { mode: 0o600 });
      const { content, ...metadata } = restored;
      result = { ...metadata, readable_limit_reached: readable.length >= 2 * 1024 * 1024,
        window: textWindow(readable, options.window) };
    } else result = restored;
  } else if (options.request.mode === "read") {
    const { text: content, ...metadata } = result;
    save("message.json", result);
    result = { ...metadata, window: textWindow(content ?? "", options.window) };
  }
  const references = result.source_ref ? [result.source_ref] : options.request.mode === "verify"
    ? (result.references ?? []).map((ref) => ref.expected).filter(Boolean)
    : (result.evidence ?? []).map((row) => row.source_ref).filter(Boolean);
  save("references.json", { references });
  if (result.proposed_checkpoint) save("checkpoint-proposed.json", result.proposed_checkpoint);
  const artifacts = { directory, result: path.join(directory, "result.json"), references: path.join(directory, "references.json"),
    ...(result.status === "recovered" ? { receipt: path.join(directory, "receipt.json"), readable_receipt: path.join(directory, "receipt.txt") } : {}),
    ...(result.proposed_checkpoint ? { proposed_checkpoint: path.join(directory, "checkpoint-proposed.json") } : {}) };
  result.artifacts = artifacts;
  save("result.json", result);
  return { result, exitCode: result.status === "invalid_references" ? 2 : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCommand(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const { result, exitCode } = await runCommand(options);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = exitCode;
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, ...(error.artifacts ? { artifacts: error.artifacts } : {}) }));
    process.exitCode = 1;
  }
}
