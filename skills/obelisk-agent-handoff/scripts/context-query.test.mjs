import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildQuery, collectContext, parseArgs, validateRequest, writeQuery } from "./context-query.mjs";

const ROOT = "codex:00000000-0000-4000-8000-000000000001";
const OTHER = "codex:00000000-0000-4000-8000-000000000002";
const WORKER = "codex:00000000-0000-4000-8000-000000000003";
const PROJECT = "/workspace/example-app";
const TIME = "2026-01-01T10:00:00.000Z";
const aliases = new Map();
const labels = new Map();
let nextOrdinal = 1;
function id(value, thread) {
  if (value.startsWith("codex:")) return value;
  if (thread === undefined && aliases.has(value)) return aliases.get(value);
  const uuid = `${thread ?? ROOT}:${String(nextOrdinal++).padStart(6, "0")}`;
  aliases.set(value, uuid);
  labels.set(uuid, value);
  return uuid;
}
const label = (uuid) => labels.get(uuid) ?? uuid;

function request(mode, overrides = {}) {
  const value = { mode, project_path: PROJECT, root_session_id: ROOT,
    ...(mode === "hydrate" ? { anchors: ["decision"] } : {}),
    ...(mode === "audit" ? { agent_id: WORKER } : {}), ...overrides };
  if (value.anchors) value.anchors = value.anchors.map((uuid) => id(uuid));
  if (value.checkpoint?.cursor) value.checkpoint = { ...value.checkpoint,
    cursor: { ...value.checkpoint.cursor, uuid: id(value.checkpoint.cursor.uuid) } };
  return validateRequest(value);
}

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT, source TEXT, git_branch TEXT);
    CREATE TABLE messages (uuid TEXT PRIMARY KEY, session_id TEXT, agent_id TEXT, role TEXT,
      content_type TEXT, is_meta INTEGER, visibility TEXT, timestamp TEXT, text TEXT);
    CREATE TABLE subagents (agent_id TEXT, session_id TEXT, agent_type TEXT,
      parent_tool_use_id TEXT, description TEXT);
    CREATE TABLE tool_calls (id TEXT, message_uuid TEXT, session_id TEXT, name TEXT, input_json TEXT);
    CREATE TABLE tool_results (tool_use_id TEXT, message_uuid TEXT, session_id TEXT, content TEXT, is_error INTEGER);
  `);
  const sql = (query, ...params) => db.prepare(query).all(...params);
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(ROOT, PROJECT, "codex", "example-branch");
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(OTHER, PROJECT, "codex", "other-branch");
  db.prepare("INSERT INTO subagents VALUES (?,?,?,?,?)")
    .run(WORKER, ROOT, "worker", null, "Check the accepted retry policy");
  const put = (uuid, text, overrides = {}) => {
    const row = { uuid: id(uuid, overrides.agent_id ?? overrides.session_id ?? ROOT), text, session_id: ROOT, agent_id: null, role: "assistant", content_type: "text",
      is_meta: 0, visibility: "visible", timestamp: TIME, ...overrides };
    db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)").run(row.uuid, row.session_id, row.agent_id,
      row.role, row.content_type, row.is_meta, row.visibility, row.timestamp, row.text);
    return row;
  };
  const api = {
    sql,
    overview: () => ({ current: { session_id: null } }),
    sessions: ({ sessionId }) => sql("SELECT * FROM sessions WHERE id=?", sessionId),
    subagents: ({ sessionId, limit }) => sql(`SELECT a.*,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id=a.session_id AND m.agent_id=a.agent_id) AS messageCount
      FROM subagents a WHERE a.session_id=? LIMIT ?`, sessionId, limit),
    search: (query, opts) => sql(`SELECT uuid FROM messages WHERE session_id=? AND instr(text,?)>0
      AND COALESCE(is_meta,0)=0 AND visibility='visible' ORDER BY uuid LIMIT ?`,
    opts.sessionId, query, opts.limit).map((row) => ({ message: row })),
    messages: (opts) => {
      if (typeof opts === "string") {
        const anchor = sql("SELECT * FROM messages WHERE uuid=? AND visibility='visible'", opts)[0];
        return anchor ? { anchor, messages: [anchor], hasMore: false } : null;
      }
      if (opts.around) {
        const anchor = sql("SELECT * FROM messages WHERE uuid=? AND visibility='visible'", opts.around)[0];
        if (!anchor) return null;
        const neighbors = sql(`SELECT * FROM messages WHERE session_id=? AND agent_id IS ?
          AND visibility='visible' AND is_meta=0 AND content_type='text' ORDER BY timestamp,uuid`,
        anchor.session_id, anchor.agent_id);
        const before = neighbors.filter((row) => row.timestamp < anchor.timestamp ||
          (row.timestamp === anchor.timestamp && row.uuid < anchor.uuid)).slice(-opts.beforeCount);
        const after = neighbors.filter((row) => row.timestamp > anchor.timestamp ||
          (row.timestamp === anchor.timestamp && row.uuid > anchor.uuid)).slice(0, opts.afterCount);
        return { anchor, messages: [...before, anchor, ...after], hasMore: false };
      }
      const clauses = ["session_id=?", "agent_id IS ?", "is_meta=0", "visibility='visible'",
        `content_type IN (${opts.contentTypes.map(() => "?").join(",")})`];
      const params = [opts.sessionId, opts.agentId, ...opts.contentTypes];
      if (opts.cursor) {
        clauses.push("(timestamp>? OR (timestamp=? AND uuid>?))");
        params.push(opts.cursor.timestamp, opts.cursor.timestamp, opts.cursor.uuid);
      }
      const rows = sql(`SELECT * FROM messages WHERE ${clauses.join(" AND ")}
        ORDER BY timestamp,uuid LIMIT ?`, ...params, opts.limit + 1);
      const messages = rows.slice(0, opts.limit);
      const last = messages.at(-1);
      return { messages, hasMore: rows.length > opts.limit,
        nextCursor: rows.length > opts.limit ? { timestamp: last.timestamp, uuid: last.uuid } : null };
    },
  };
  return { db, api, put };
}

test("locate resolves an exact visible root user phrase and returns real worker metadata", (t) => {
  const { api, put } = fixture(t);
  put("human", "The distinctive example request", { role: "user" });
  put("child-copy", "The distinctive example request", { role: "user", session_id: OTHER, agent_id: WORKER });
  const result = collectContext(request("locate", { root_session_id: undefined,
    user_phrase: "distinctive example request" }), api);
  assert.equal(result.status, "resolved");
  assert.equal(result.scope.root_session_id, ROOT);
  assert.equal(result.agents[0].agent_id, WORKER);
  assert.equal(result.agents[0].parent_tool_use_id, null);
});

test("ambiguous or unknown invocation identity never selects the newest session", (t) => {
  const { api, put } = fixture(t);
  put("one", "same phrase", { role: "user" });
  put("two", "same phrase", { role: "user", session_id: OTHER });
  const ambiguous = collectContext(request("locate", { root_session_id: undefined, user_phrase: "same phrase" }), api);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.scope.root_session_id, null);
  const unknown = collectContext(request("locate", { root_session_id: undefined }), api);
  assert.equal(unknown.status, "unresolved");
  assert.equal(unknown.session, undefined);
});

test("locate accepts a resolved invocation only in the exact requested project", (t) => {
  const { api } = fixture(t);
  api.overview = () => ({ current: { session_id: ROOT } });
  assert.equal(collectContext(request("locate", { root_session_id: undefined }), api).status, "resolved");
  assert.equal(collectContext(request("locate", { root_session_id: undefined,
    project_path: "/workspace/foreign" }), api).status, "unresolved");
});

test("explicit root and worker bindings fail closed on project or lineage mismatch", (t) => {
  const { api } = fixture(t);
  assert.throws(() => collectContext(request("audit", { project_path: "/workspace/foreign" }), api), /exact project/);
  assert.throws(() => collectContext(request("audit", { root_session_id: OTHER }), api), /no indexed binding/);
});

test("hydration prioritizes supplied decisions while preserving conflicting proposals as evidence", (t) => {
  const { api, put } = fixture(t);
  put("a-proposal", "Proposal: retry every error");
  put("decision", "User decision: only retry allowed timeouts", { role: "user" });
  put("z-note", "The broad proposal was rejected");
  const result = collectContext(request("hydrate"), api);
  assert.equal(label(result.evidence[0].uuid), "decision");
  assert.equal(result.evidence[0].origin.kind, "anchor");
  assert.ok(result.evidence.some((row) => label(row.uuid) === "a-proposal"));
  assert.ok(result.evidence.some((row) => label(row.uuid) === "z-note"));
  assert.ok(result.evidence.every((row) => row.decision_status === undefined));
});

test("search hydration excludes child messages, hidden reasoning, and injected metadata", (t) => {
  const { api, put } = fixture(t);
  put("a-child", "retry", { agent_id: WORKER });
  put("b-thinking", "retry", { content_type: "thinking" });
  put("c-meta", "retry", { is_meta: 1 });
  put("d-visible", "retry accepted", { role: "user" });
  put("e-hidden", "retry", { visibility: "hidden" });
  const result = collectContext(request("hydrate", { anchors: [], queries: ["retry"] }), api);
  assert.deepEqual(result.evidence.map((row) => label(row.uuid)), ["d-visible"]);
});

test("foreign, child, and meta anchors are refused rather than imported", (t) => {
  const { api, put } = fixture(t);
  put("foreign", "unrelated", { session_id: OTHER });
  put("child", "child", { agent_id: WORKER });
  put("meta", "injected", { is_meta: 1 });
  for (const uuid of ["foreign", "child", "meta"]) {
    assert.throws(() => collectContext(request("hydrate", { anchors: [uuid] }), api), /outside the visible root/);
  }
});

test("missing anchors and clipped indexed text expose incomplete evidence", (t) => {
  const { api, put } = fixture(t);
  put("decision", "x".repeat(10000));
  const result = collectContext(request("hydrate", { anchors: ["decision", "missing"] }), api);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.unresolved_anchors.map(label), ["missing"]);
  assert.equal(result.evidence[0].truncated, true);
  assert.equal(result.evidence[0].index_limit_reached, true);
});

test("tool inputs and outcomes retain source IDs, clipping, and provider error markers", (t) => {
  const { api, put, db } = fixture(t);
  put("call-message", "tool_use", { agent_id: WORKER, content_type: "tool_use" });
  put("result-message", "tool_result", { agent_id: WORKER, content_type: "tool_result" });
  db.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?)")
    .run("call-1", id("call-message"), ROOT, "exec_command", JSON.stringify({ cmd: "example-test" }));
  db.prepare("INSERT INTO tool_results VALUES (?,?,?,?,?)")
    .run("call-1", id("result-message"), ROOT, "Exit code 1\n" + "failure detail ".repeat(100), 0);
  const result = collectContext(request("audit", { excerpt_chars: 120 }), api);
  const tool = result.evidence[0].tools[0];
  assert.equal(tool.tool_use_id, "call-1");
  assert.equal(label(tool.result_uuid), "result-message");
  assert.equal(tool.provider_is_error, 0);
  assert.match(tool.result.excerpt, /Exit code 1/);
  assert.equal(tool.result.truncated, true);
  assert.equal(tool.success, undefined);
});

test("audit excludes other agents and advances through equal timestamps without omissions", (t) => {
  const { api, put } = fixture(t);
  put("worker-1", "first", { agent_id: WORKER });
  put("worker-2", "second", { agent_id: WORKER });
  put("worker-3", "third", { agent_id: WORKER });
  put("root-1", "root statement");
  put("worker-meta", "injected", { agent_id: WORKER, is_meta: 1 });
  put("worker-think", "internal", { agent_id: WORKER, content_type: "thinking" });
  const first = collectContext(request("audit", { limit: 1 }), api);
  const second = collectContext(request("audit", { limit: 1, checkpoint: first.proposed_checkpoint }), api);
  const third = collectContext(request("audit", { limit: 1, checkpoint: second.proposed_checkpoint }), api);
  assert.deepEqual([first, second, third].flatMap((result) => result.evidence.map((row) => label(row.uuid))),
    ["worker-1", "worker-2", "worker-3"]);
  assert.equal(first.has_more, true);
  assert.equal(third.has_more, false);
  assert.equal(label(third.proposed_checkpoint.cursor.uuid), "worker-3");
});

test("a pending tool call is an evidence gap rather than an implied successful result", (t) => {
  const { api, put, db } = fixture(t);
  put("pending", "tool_use", { agent_id: WORKER, content_type: "tool_use" });
  db.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?)")
    .run("pending-call", id("pending"), ROOT, "exec_command", "{}");
  const result = collectContext(request("audit"), api);
  assert.equal(result.evidence[0].tools[0].result_unavailable, true);
  assert.equal(result.status, "partial");
});

test("omitted tool rows are explicit when one message carries several calls", (t) => {
  const { api, put, db } = fixture(t);
  put("batch", "tool_use", { agent_id: WORKER, content_type: "tool_use" });
  for (let index = 0; index < 5; index++) {
    db.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?)")
      .run(`batch-${index}`, id("batch"), ROOT, "example-tool", "{}");
    db.prepare("INSERT INTO tool_results VALUES (?,?,?,?,?)")
      .run(`batch-${index}`, `result-${index}`, ROOT, "example result", 0);
  }
  const result = collectContext(request("audit"), api);
  assert.equal(result.evidence[0].tools.length, 3);
  assert.equal(result.evidence[0].more_tool_rows, true);
  assert.equal(result.status, "partial");
});

test("an excerpt budget never advances a checkpoint beyond a returned record", (t) => {
  const { api, put } = fixture(t);
  for (const uuid of ["worker-1", "worker-2", "worker-3"]) put(uuid, "x".repeat(2000), { agent_id: WORKER });
  const result = collectContext(request("audit", { max_chars: 1000, excerpt_chars: 1000 }), api);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.has_more, true);
  assert.equal(label(result.proposed_checkpoint.cursor.uuid), "worker-1");
  assert.ok(result.excerpt_chars_returned <= 1000);
});

test("an empty delta preserves its cursor and makes no completion claim", (t) => {
  const { api } = fixture(t);
  const checkpoint = { root_session_id: ROOT, agent_id: WORKER, cursor: { timestamp: TIME, uuid: id("last-read", WORKER) } };
  const result = collectContext(request("audit", { checkpoint }), api);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.proposed_checkpoint, checkpoint);
  assert.equal(result.latest_indexed_at, null);
  assert.equal(result.completed, undefined);
});

test("explicit null agent reads root updates without importing worker activity", (t) => {
  const { api, put } = fixture(t);
  put("root", "new human decision", { role: "user" });
  put("worker", "worker activity", { agent_id: WORKER });
  const result = collectContext(request("audit", { agent_id: null }), api);
  assert.deepEqual(result.evidence.map((row) => label(row.uuid)), ["root"]);
});

test("validation rejects cross-worker cursors, unbounded queries, and unknown options", () => {
  assert.throws(() => request("audit", { checkpoint: { root_session_id: ROOT, agent_id: "codex:other-worker", cursor: null } }), /scope/);
  assert.throws(() => request("audit", { limit: 99999 }), /limit/);
  assert.throws(() => request("hydrate", { anchors: [], queries: [] }), /at least one/);
  assert.throws(() => request("hydrate", { includeThinking: true }), /Unknown/);
  assert.throws(() => request("hydrate", { project_path: "relative-path" }), /absolute/);
  assert.throws(() => request("audit", { checkpoint: { root_session_id: ROOT, agent_id: WORKER,
    cursor: { timestamp: "yesterday", uuid: "message" } } }), /UTC ISO/);
});

test("checkpoint validation preserves provider timestamp precision", () => {
  const timestamp = "2026-01-01T10:00:00.000123456Z";
  const result = request("audit", { checkpoint: { root_session_id: ROOT, agent_id: WORKER,
    cursor: { timestamp, uuid: "precise-message" } } });
  assert.equal(result.checkpoint.cursor.timestamp, timestamp);
});

test("audit refuses a provider page that breaks the requested agent filter", (t) => {
  const { api, put } = fixture(t);
  const foreign = put("foreign-result", "wrong agent", { agent_id: "codex:unrelated-worker" });
  api.messages = () => ({ messages: [foreign], hasMore: false });
  assert.throws(() => collectContext(request("audit"), api), /outside the requested scope/);
});

test("generated query runs in a restricted wrapper and encodes query text as data", (t) => {
  const { api, put } = fixture(t);
  const query = '\"); globalThis.compromised=true; //';
  put("decision", "the real decision", { role: "user" });
  const sandbox = { ...api };
  const source = buildQuery({ mode: "hydrate", project_path: PROJECT, root_session_id: ROOT,
    anchors: [id("decision")], queries: [query] });
  const result = vm.runInNewContext(`(function () { ${source} })()`, sandbox, { timeout: 2000 });
  assert.equal(label(result.evidence[0].uuid), "decision");
  assert.equal(sandbox.compromised, undefined);
});

test("the generator accepts UTF-8 BOM requests and refuses to overwrite query files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obelisk-handoff-test-"));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    const tempRoot = fs.realpathSync(os.tmpdir());
    assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("obelisk-handoff-test-"));
    fs.rmSync(resolved, { recursive: true });
  });
  const input = path.join(directory, "request.json");
  const output = path.join(directory, "query.mjs");
  fs.writeFileSync(input, `\uFEFF${JSON.stringify(request("hydrate"))}`);
  assert.equal(writeQuery(input, output).query_file, output);
  assert.throws(() => writeQuery(input, output), /EEXIST/);
  assert.deepEqual(parseArgs(["--request", input, "--out", output]), { request: input, out: output });
  assert.throws(() => parseArgs(["--request", "--out", output]), /Use --request/);
});

test("canonical IDs reject abbreviated or invented namespaces before query generation", () => {
  assert.throws(() => buildQuery({ mode: "hydrate", project_path: PROJECT, root_session_id: ROOT,
    anchors: ["...:000050"] }), /full codex/);
  assert.throws(() => buildQuery({ mode: "locate", project_path: PROJECT, root_session_id: "codex:example-root" }), /full canonical/);
});

test("verify checks existence, root, agent, role and type rather than just UUID shape", (t) => {
  const { api, put } = fixture(t);
  const main = put("verify-main", "human decision", { role: "user" });
  const worker = put("verify-worker", "worker finding", { agent_id: WORKER });
  const valid = collectContext(validateRequest({ mode: "verify", root_session_id: ROOT, project_path: PROJECT,
    references: [{ uuid: main.uuid, agent_id: null, role: "user", content_type: "text" },
      { uuid: worker.uuid, agent_id: WORKER, role: "assistant" }] }), api);
  assert.equal(valid.status, "verified");
  const wrong = collectContext(validateRequest({ mode: "verify", root_session_id: ROOT, project_path: PROJECT,
    references: [{ uuid: main.uuid, agent_id: WORKER }, { uuid: worker.uuid, agent_id: WORKER, role: "user" }] }), api);
  assert.deepEqual(wrong.references.map((ref) => ref.status), ["scope_mismatch", "role_mismatch"]);
});

test("verify keeps absent and hidden evidence unavailable", (t) => {
  const { api, put } = fixture(t);
  const hidden = put("verify-hidden", "not exposed", { visibility: "hidden" });
  const result = collectContext(validateRequest({ mode: "verify", root_session_id: ROOT, project_path: PROJECT,
    references: [{ uuid: hidden.uuid, agent_id: null }, { uuid: id("verify-absent"), agent_id: null }] }), api);
  assert.equal(result.status, "invalid_references");
  assert.ok(result.references.every((ref) => ref.actual === null));
});

test("read restores a capped visible message through raw without exposing its envelope", (t) => {
  const { api, put } = fixture(t);
  const row = put("read-long", "x".repeat(10000));
  api.raw = () => ({ hasMore: false, text: JSON.stringify({ type: "response_item", payload: {
    type: "message", role: "assistant", content: [{ type: "output_text", text: "x".repeat(14000) }] } }) });
  const result = collectContext(validateRequest({ mode: "read", root_session_id: ROOT, project_path: PROJECT,
    agent_id: null, uuid: row.uuid }), api);
  assert.equal(result.text.length, 14000);
  assert.equal(result.status, "read");
  assert.equal(result.source_ref.uuid, row.uuid);
});

test("receipt descriptor derives the source and call ID from scoped indexed metadata", (t) => {
  const { api, put, db } = fixture(t);
  db.exec("ALTER TABLE sessions ADD COLUMN jsonl_path TEXT");
  db.prepare("UPDATE sessions SET jsonl_path=? WHERE id=?").run("/local/rollout-00000000-0000-4000-8000-000000000001.jsonl", ROOT);
  const row = put("receipt-call", "", { content_type: "tool_use" });
  const call = `${ROOT}:call_example`;
  db.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?)").run(call, row.uuid, ROOT, "example", "{}");
  db.prepare("INSERT INTO tool_results VALUES (?,?,?,?,?)").run(call, row.uuid, ROOT, "x".repeat(10000), 0);
  const result = collectContext(validateRequest({ mode: "receipt", root_session_id: ROOT, project_path: PROJECT,
    agent_id: null, uuid: row.uuid }), api);
  assert.equal(result.status, "receipt_descriptor");
  assert.equal(result.receipt.call_id, "call_example");
  assert.equal(result.receipt.source_candidates.length, 1);
  assert.equal(result.receipt.indexed_content.length, 10000);
});

test("read keeps capped evidence partial when the raw source disagrees with its index", (t) => {
  const { api, put } = fixture(t);
  const row = put("read-mismatch", "x".repeat(10000));
  api.raw = () => ({ hasMore: false, text: JSON.stringify({ type: "response_item", payload: {
    type: "message", role: "assistant", content: [{ type: "output_text", text: "different body" }] } }) });
  const result = collectContext(validateRequest({ mode: "read", root_session_id: ROOT, project_path: PROJECT,
    agent_id: null, uuid: row.uuid }), api);
  assert.equal(result.status, "partial");
  assert.equal(result.text, "x".repeat(10000));
});

test("receipt requires explicit selection when one message carries multiple calls", (t) => {
  const { api, put, db } = fixture(t);
  const row = put("receipt-many", "", { content_type: "tool_use" });
  for (const suffix of ["one", "two"]) db.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?)")
    .run(`${ROOT}:call_${suffix}`, row.uuid, ROOT, "example", "{}");
  const result = collectContext(validateRequest({ mode: "receipt", root_session_id: ROOT, project_path: PROJECT,
    agent_id: null, uuid: row.uuid }), api);
  assert.equal(result.status, "partial");
  assert.equal(result.gap, "multiple_tools_select_tool_use_id");
});

test("a unique visible worker marker binds the actual agent without guessing from nicknames", (t) => {
  const { api, put, db } = fixture(t);
  put("task-marker", "EXPERIMENT=fictional-task", { agent_id: WORKER });
  const input = validateRequest({ mode: "locate", root_session_id: ROOT, project_path: PROJECT,
    task_marker: "EXPERIMENT=fictional-task" });
  const first = collectContext(input, api);
  assert.equal(first.worker_binding_status, "resolved");
  assert.equal(first.marker_matches[0].agent_id, WORKER);
  db.prepare("INSERT INTO subagents VALUES (?,?,?,?,?)").run(OTHER, ROOT, "worker", null, "Different nickname");
  put("copied-marker", "EXPERIMENT=fictional-task", { agent_id: OTHER });
  const second = collectContext(input, api);
  assert.equal(second.worker_binding_status, "ambiguous");
  assert.equal(second.marker_matches.length, 2);
});
