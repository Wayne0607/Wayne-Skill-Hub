import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreReceipt, readableReceipt, textWindow } from "./receipt-source.mjs";
import { parseCommand, executeQuery, runCommand, findObeliskCommand } from "./handoff.mjs";

const NATIVE = "00000000-0000-4000-8000-000000000001";
const CHILD = "00000000-0000-4000-8000-000000000002";
const ROOT = `codex:${NATIVE}`;
const UUID = `${ROOT}:000002`;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obelisk-runtime-test-"));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.ok(resolved.startsWith(`${fs.realpathSync(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("obelisk-runtime-test-"));
    fs.rmSync(resolved, { recursive: true });
  });
  return directory;
}

function source(t, { output, parent = null, thread = NATIVE, duplicate, callId = "call_example" } = {}) {
  const directory = temporary(t);
  const filename = path.join(directory, `rollout-${thread}.jsonl`);
  const content = output ?? JSON.stringify([{ type: "input_text", text: "x".repeat(16000) + "\nTAIL: official evidence" }]);
  const meta = { id: thread };
  if (parent) meta.source = { subagent: { thread_spawn: { parent_thread_id: parent } } };
  const records = [
    { type: "session_meta", payload: meta },
    { type: "response_item", payload: { type: "custom_tool_call", call_id: callId, name: "example" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: callId, output: content } },
  ];
  if (duplicate !== undefined) records.push({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: callId, output: duplicate } });
  fs.writeFileSync(filename, records.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const descriptor = { status: "receipt_descriptor", scope: { root_session_id: ROOT, project_path: "/work/example", agent_id: parent ? `codex:${thread}` : null },
    source_ref: { uuid: `codex:${thread}:000002`, root_session_id: ROOT, agent_id: parent ? `codex:${thread}` : null, content_type: "tool_use", role: "assistant" },
    receipt: { call_message_uuid: `codex:${thread}:000002`, tool_use_id: `codex:${thread}:call_example`,
      native_thread_id: thread, root_native_id: NATIVE, call_id: "call_example", indexed_content: content.slice(0, 10000), source_candidates: [filename] } };
  return { directory, filename, content, descriptor };
}

test("a capped JSON receipt is recovered by exact call before decoding and searching its tail", async (t) => {
  const fixture = source(t);
  assert.throws(() => JSON.parse(fixture.descriptor.receipt.indexed_content));
  const result = await restoreReceipt(fixture.descriptor);
  assert.equal(result.status, "recovered");
  assert.equal(result.content, fixture.content);
  assert.equal(result.provenance.index_prefix_verified, true);
  assert.deepEqual(result.provenance.source_ordinals, [3]);
  const window = textWindow(readableReceipt(result.content), { find: "TAIL: official evidence", chars: 300 });
  assert.equal(window.match_found, true);
  assert.ok(window.offset > 10000);
  assert.match(window.excerpt, /TAIL: official evidence/);
});

test("child receipt restoration validates its declared parent", async (t) => {
  const fixture = source(t, { thread: CHILD, parent: NATIVE });
  assert.equal((await restoreReceipt(fixture.descriptor)).status, "recovered");
  fixture.descriptor.receipt.root_native_id = "00000000-0000-4000-8000-000000000099";
  assert.equal((await restoreReceipt(fixture.descriptor)).gap, "source_identity_or_call_mismatch");
});

test("wrong call identity, ordinal, or index prefix cannot produce recovered data", async (t) => {
  const fixture = source(t);
  for (const changes of [
    { call_id: "call_other" }, { call_message_uuid: `${ROOT}:000003` }, { indexed_content: "unrelated indexed body" },
  ]) {
    const result = await restoreReceipt({ ...fixture.descriptor, receipt: { ...fixture.descriptor.receipt, ...changes } });
    assert.equal(result.status, "partial");
    assert.equal(result.content, undefined);
  }
});

test("divergent results sharing a capped prefix stay ambiguous", async (t) => {
  const content = "x".repeat(11000);
  const fixture = source(t, { output: content, duplicate: content + "different ending" });
  assert.equal((await restoreReceipt(fixture.descriptor)).gap, "ambiguous_receipt");
});

test("identical duplicate receipts retain provenance without inventing a new UUID", async (t) => {
  const fixture = source(t, { output: "same body", duplicate: "same body" });
  const result = await restoreReceipt(fixture.descriptor);
  assert.equal(result.status, "recovered");
  assert.deepEqual(result.provenance.source_ordinals, [3, 4]);
  assert.equal(result.source_ref.uuid, UUID);
});

test("unindexed, missing, and ambiguous sources return named evidence gaps", async (t) => {
  const fixture = source(t);
  for (const [changes, gap] of [
    [{ indexed_content: null }, "receipt_not_yet_indexed"],
    [{ source_candidates: [] }, "source_path_unavailable"],
    [{ source_candidates: [fixture.filename, fixture.filename] }, "ambiguous_source_path"],
  ]) assert.equal((await restoreReceipt({ ...fixture.descriptor, receipt: { ...fixture.descriptor.receipt, ...changes } })).gap, gap);
});

test("complete nested JSON text is decoded while reasoning keys are excluded", () => {
  const content = JSON.stringify([{ text: JSON.stringify({ result: { text: "official body", reasoning: "excluded" } }) }]);
  const readable = readableReceipt(content);
  assert.match(readable, /official body/);
  assert.doesNotMatch(readable, /excluded/);
  assert.equal(textWindow(readable, { find: "absent" }).match_found, false);
});

test("fixed CLI flags preserve literal input and reject abbreviations and unused flags", () => {
  const parsed = parseCommand(["hydrate", "--root", ROOT, "--project", "C:\\work folder\\example",
    "--anchor", UUID, "--query", "literal 'quote' $(not-a-command)"]);
  assert.equal(parsed.request.queries[0], "literal 'quote' $(not-a-command)");
  assert.throws(() => parseCommand(["read", "--root", ROOT, "--project", "/work/example", "--uuid", "...:000002"]), /full codex/);
  assert.throws(() => parseCommand(["read", "--root", ROOT, "--project", "/work/example", "--uuid", UUID,
    "--find", "x", "--offset", "1"]), /text window/);
  assert.throws(() => parseCommand(["audit", "--root", ROOT, "--project", "/work/example", "--find", "x"]), /not valid/);
});

test("runner passes a query path containing spaces as one argument without a shell", (t) => {
  const root = temporary(t);
  const directory = path.join(root, "folder with spaces");
  fs.mkdirSync(directory);
  const fake = path.join(root, "fake cli.mjs");
  fs.writeFileSync(fake, `import fs from 'node:fs'; const a=process.argv.slice(2); if(a.length!==2||a[0]!=='--query'||!fs.existsSync(a[1]))process.exit(2); console.log(JSON.stringify({status:'observed',query_path:a[1]}));`);
  const request = parseCommand(["locate", "--root", ROOT, "--project", "/work/example"]).request;
  const result = executeQuery(request, directory, { executable: process.execPath, args: [fake] });
  assert.equal(result.query_path, path.join(directory, "query.mjs"));
});

test("failed Obelisk execution never reaches source recovery", async (t) => {
  const directory = temporary(t);
  const options = parseCommand(["receipt", "--root", ROOT, "--project", "/work/example", "--uuid", UUID, "--out-root", directory]);
  await assert.rejects(runCommand(options, () => { throw new Error("refresh failed"); }), /refresh failed/);
  for (const name of fs.readdirSync(directory)) assert.equal(fs.existsSync(path.join(directory, name, "receipt.json")), false);
});

test("valid-looking stdout from a failed CLI cannot authorize source reads", async (t) => {
  const fixture = source(t);
  const fake = path.join(fixture.directory, "failed cli.mjs");
  fs.writeFileSync(fake, `console.log(${JSON.stringify(JSON.stringify(fixture.descriptor))}); console.error('simulated refresh failure'); process.exit(7);`);
  const options = parseCommand(["receipt", "--root", ROOT, "--project", "/work/example", "--uuid", UUID,
    "--out-root", fixture.directory]);
  await assert.rejects(runCommand(options, (request, directory) =>
    executeQuery(request, directory, { executable: process.execPath, args: [fake] })), /refresh\/query failed/);
  const runDirectory = fs.readdirSync(fixture.directory).find((name) => name.startsWith("obelisk-receipt-"));
  const folder = path.join(fixture.directory, runDirectory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "execution.json"), "utf8")).exit_code, 7);
  assert.match(fs.readFileSync(path.join(folder, "obelisk-stderr.txt"), "utf8"), /simulated refresh failure/);
  assert.equal(fs.existsSync(path.join(folder, "receipt.json")), false);
});

test("each invocation creates new artifacts and exports full references for verification", async (t) => {
  const directory = temporary(t);
  const options = parseCommand(["read", "--root", ROOT, "--project", "/work/example", "--uuid", UUID, "--out-root", directory]);
  const query = () => ({ status: "read", source_ref: { uuid: UUID, root_session_id: ROOT, agent_id: null, content_type: "text" }, text: "readable message" });
  const first = await runCommand(options, query);
  const second = await runCommand(options, query);
  assert.notEqual(first.result.artifacts.directory, second.result.artifacts.directory);
  const verify = parseCommand(["verify", "--root", ROOT, "--project", "/work/example", "--refs", first.result.artifacts.references]);
  assert.equal(verify.request.references[0].uuid, UUID);
});

test("invalid references produce a nonzero result with structured diagnostics", async (t) => {
  const directory = temporary(t);
  const options = parseCommand(["verify", "--root", ROOT, "--project", "/work/example", "--uuid", UUID, "--out-root", directory]);
  const outcome = await runCommand(options, () => ({ status: "invalid_references", references: [{ status: "scope_mismatch" }] }));
  assert.equal(outcome.exitCode, 2);
  assert.equal(JSON.parse(fs.readFileSync(outcome.result.artifacts.result, "utf8")).status, "invalid_references");
});

test("Windows npm command resolution selects the installed JS entry rather than shell text", (t) => {
  const directory = temporary(t);
  const pkg = path.join(directory, "node_modules", "@obelisk-apps", "cli");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ bin: { obelisk: "entry.mjs" } }));
  fs.writeFileSync(path.join(pkg, "entry.mjs"), "");
  const command = findObeliskCommand({ PATH: directory });
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args, [path.join(pkg, "entry.mjs")]);
});
