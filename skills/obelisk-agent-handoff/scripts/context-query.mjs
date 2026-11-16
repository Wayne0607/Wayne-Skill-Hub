#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODES = new Set(["locate", "hydrate", "audit"]);
const COMMON = ["mode", "project_path", "root_session_id", "limit", "excerpt_chars", "max_chars"];
const FIELDS = {
  locate: [...COMMON, "user_phrase"],
  hydrate: [...COMMON, "anchors", "queries"],
  audit: [...COMMON, "agent_id", "checkpoint"],
};

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function text(value, label, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function integer(value, label, fallback, min, max) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return result;
}

function list(value, label, maxItems, maxLength) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be an array of at most ${maxItems} strings`);
  }
  return [...new Set(value.map((item) => text(item, label, maxLength)))];
}

export function validateRequest(input) {
  object(input, "request");
  if (!MODES.has(input.mode)) throw new TypeError("mode must be locate, hydrate, or audit");
  for (const key of Object.keys(input)) {
    if (!FIELDS[input.mode].includes(key)) throw new TypeError(`Unknown request field: ${key}`);
  }
  const project = text(input.project_path, "project_path", 2048);
  if (!path.isAbsolute(project) && !path.win32.isAbsolute(project)) {
    throw new TypeError("project_path must be absolute and match the indexed path exactly");
  }
  const result = {
    mode: input.mode,
    project_path: project,
    limit: integer(input.limit, "limit", 12, 1, 40),
    excerpt_chars: integer(input.excerpt_chars, "excerpt_chars", 700, 120, 2000),
    max_chars: integer(input.max_chars, "max_chars", 12000, 1000, 24000),
  };
  if (input.root_session_id !== undefined) {
    result.root_session_id = text(input.root_session_id, "root_session_id");
    if (!result.root_session_id.startsWith("codex:")) {
      throw new TypeError("root_session_id must be a canonical codex: session ID");
    }
  } else if (input.mode !== "locate") {
    throw new TypeError("root_session_id is required for hydrate and audit");
  }
  if (input.mode === "locate" && input.user_phrase !== undefined) {
    result.user_phrase = text(input.user_phrase, "user_phrase", 500);
  }
  if (input.mode === "hydrate") {
    result.anchors = list(input.anchors, "anchors", 12, 512);
    result.queries = list(input.queries, "queries", 4, 160);
    if (!result.anchors.length && !result.queries.length) {
      throw new TypeError("hydrate requires at least one anchor or query");
    }
  }
  if (input.mode === "audit") {
    if (!Object.hasOwn(input, "agent_id")) {
      throw new TypeError("audit requires agent_id; use explicit null for root updates");
    }
    result.agent_id = input.agent_id === null ? null : text(input.agent_id, "agent_id");
    if (input.checkpoint !== undefined) {
      object(input.checkpoint, "checkpoint");
      const cp = input.checkpoint;
      if (Object.keys(cp).some((key) => !["root_session_id", "agent_id", "cursor"].includes(key))) {
        throw new TypeError("Unknown checkpoint field");
      }
      if (cp.root_session_id !== result.root_session_id || cp.agent_id !== result.agent_id) {
        throw new TypeError("checkpoint scope must match the requested root and agent");
      }
      let cursor = null;
      if (cp.cursor !== null) {
        object(cp.cursor, "checkpoint.cursor");
        if (Object.keys(cp.cursor).some((key) => !["timestamp", "uuid"].includes(key))) {
          throw new TypeError("Unknown checkpoint cursor field");
        }
        const timestamp = text(cp.cursor.timestamp, "checkpoint.cursor.timestamp", 40);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(timestamp) ||
            !Number.isFinite(Date.parse(timestamp))) {
          throw new TypeError("checkpoint timestamp must be a UTC ISO timestamp");
        }
        cursor = { timestamp, uuid: text(cp.cursor.uuid, "checkpoint.cursor.uuid") };
      }
      result.checkpoint = { root_session_id: cp.root_session_id, agent_id: cp.agent_id, cursor };
    }
  }
  return result;
}

// Self-contained so its source can run inside Obelisk's query wrapper without imports.
export function collectContext(request, api) {
  const allowedTypes = ["text", "tool_use", "tool_result"];
  const visible = (row) => row && Number(row.is_meta || 0) === 0 &&
    (row.visibility == null || row.visibility === "visible") && allowedTypes.includes(row.content_type);
  const belongs = (row, agentId) => row.session_id === request.root_session_id &&
    (row.agent_id ?? null) === agentId;
  let remaining = request.max_chars;
  const clip = (value, limit) => {
    const source = value == null ? "" : String(value);
    const excerpt = source.slice(0, Math.min(limit, remaining));
    remaining -= excerpt.length;
    return { excerpt, truncated: excerpt.length < source.length, index_limit_reached: source.length >= 10000 };
  };
  const output = {
    schema_version: 1,
    mode: request.mode,
    status: "observed",
    scope: { project_path: request.project_path, root_session_id: request.root_session_id ?? null },
    queried_at: new Date().toISOString(),
    latest_indexed_at: null,
    evidence: [],
    excerpt_budget_chars: request.max_chars,
  };
  const exactSession = (id) => {
    const found = api.sessions({ sessionId: id, source: "codex", limit: 2 }).find((row) => row.id === id);
    if (!found || found.source !== "codex" || found.project_path !== request.project_path) {
      throw new Error("Root session is missing or does not match the exact project/source");
    }
    return found;
  };
  const sessionView = (row) => ({
    root_session_id: row.id, project_path: row.project_path, source: row.source,
    git_branch: row.git_branch ?? null,
  });

  if (request.mode === "locate") {
    let id = request.root_session_id;
    if (!id) {
      const current = api.overview({ limit: 0, projectLimit: 0, memoryLimit: 0 }).current;
      if (current?.session_id) {
        const row = api.sessions({ sessionId: current.session_id, source: "codex", limit: 2 })
          .find((entry) => entry.id === current.session_id && entry.project_path === request.project_path);
        if (row) id = row.id;
      }
    }
    if (!id && request.user_phrase) {
      const rows = api.sql(`SELECT s.id AS root_session_id, MIN(m.uuid) AS anchor_uuid
        FROM messages m JOIN sessions s ON s.id=m.session_id
        WHERE s.project_path=? AND s.source='codex' AND m.agent_id IS NULL
          AND m.role='user' AND m.content_type='text' AND COALESCE(m.is_meta,0)=0
          AND COALESCE(m.visibility,'visible')='visible' AND instr(m.text,?)>0
        GROUP BY s.id ORDER BY s.id LIMIT 3`, request.project_path, request.user_phrase);
      output.candidates = rows;
      if (rows.length === 1) id = rows[0].root_session_id;
      else output.status = rows.length > 1 ? "ambiguous" : "unresolved";
    }
    if (!id) {
      if (output.status === "observed") output.status = "unresolved";
      return output;
    }
    output.session = sessionView(exactSession(id));
    output.scope.root_session_id = id;
    const agents = api.subagents({ sessionId: id, source: "codex", limit: request.limit + 1 });
    output.agents = agents.slice(0, request.limit).map((row) => ({
      agent_id: row.agent_id, root_session_id: row.session_id, agent_type: row.agent_type,
      parent_tool_use_id: row.parent_tool_use_id ?? null, message_count: row.messageCount,
      description: clip(row.description, Math.min(200, request.excerpt_chars)),
    }));
    output.has_more_agents = agents.length > request.limit;
    output.status = "resolved";
    return output;
  }

  output.session = sessionView(exactSession(request.root_session_id));
  const agentId = request.mode === "audit" ? request.agent_id : null;
  output.scope.agent_id = agentId;
  if (agentId !== null) {
    const binding = api.sql("SELECT agent_id FROM subagents WHERE session_id=? AND agent_id=? LIMIT 1",
      request.root_session_id, agentId);
    if (!binding.length) throw new Error("Agent has no indexed binding to the requested root session");
  }
  output.latest_indexed_at = api.sql(`SELECT MAX(timestamp) AS timestamp FROM messages
    WHERE session_id=? AND agent_id IS ? AND COALESCE(is_meta,0)=0
      AND COALESCE(visibility,'visible')='visible' AND content_type IN ('text','tool_use','tool_result')`,
    request.root_session_id, agentId)[0]?.timestamp ?? null;

  const toolsFor = (row) => {
    if (row.content_type === "text") return [];
    return api.sql(`SELECT tc.id AS tool_use_id, tc.name, tr.message_uuid AS result_uuid,
        substr(tc.input_json,1,?) AS input_excerpt, length(tc.input_json) AS input_chars,
        substr(tr.content,1,?) AS result_excerpt, length(tr.content) AS result_chars, tr.is_error
      FROM tool_calls tc LEFT JOIN tool_results tr
        ON tr.tool_use_id=tc.id AND tr.session_id=tc.session_id
      WHERE tc.session_id=? AND (tc.message_uuid=? OR tr.message_uuid=?)
      ORDER BY tc.id, tr.message_uuid LIMIT 4`,
      request.excerpt_chars, request.excerpt_chars, request.root_session_id, row.uuid, row.uuid);
  };
  const appendEvidence = (candidate) => {
    if (remaining < 120 || output.evidence.length >= request.limit) return false;
    const { row, origin } = candidate;
    const details = toolsFor(row);
    const evidence = {
      uuid: row.uuid, timestamp: row.timestamp, agent_id: row.agent_id ?? null,
      role: row.role, content_type: row.content_type, origin,
      ...clip(row.text, request.excerpt_chars),
    };
    if (row.content_type !== "text") {
      evidence.tool_details_unavailable = details.length === 0;
      evidence.more_tool_rows = details.length > 3;
      evidence.tools = details.slice(0, 3).map((tool) => {
        const input = clip(tool.input_excerpt, Math.min(300, request.excerpt_chars));
        const result = clip(tool.result_excerpt, request.excerpt_chars);
        input.truncated ||= (tool.input_chars ?? 0) > input.excerpt.length;
        result.truncated ||= (tool.result_chars ?? 0) > result.excerpt.length;
        input.index_limit_reached ||= (tool.input_chars ?? 0) >= 10000;
        result.index_limit_reached ||= (tool.result_chars ?? 0) >= 10000;
        return { tool_use_id: tool.tool_use_id, name: tool.name, result_uuid: tool.result_uuid,
          result_unavailable: tool.result_uuid == null,
          provider_is_error: tool.is_error ?? null, input, result };
      });
    }
    output.evidence.push(evidence);
    return true;
  };

  if (request.mode === "hydrate") {
    const candidates = [];
    const seen = new Set();
    const add = (row, origin) => {
      if (visible(row) && belongs(row, null) && !seen.has(row.uuid)) {
        candidates.push({ row, origin });
        seen.add(row.uuid);
      }
    };
    output.unresolved_anchors = [];
    const anchors = [];
    for (const uuid of request.anchors) {
      const page = api.messages(uuid);
      const row = page?.anchor;
      if (!row) { output.unresolved_anchors.push(uuid); continue; }
      if (!visible(row) || !belongs(row, null)) {
        throw new Error("Anchor is outside the visible root text/tool evidence scope");
      }
      anchors.push(row);
      add(row, { kind: "anchor" });
    }
    for (const row of anchors) {
      const page = api.messages({ around: row.uuid, beforeCount: 1, afterCount: 2,
        contentTypes: ["text"], includeMeta: false });
      for (const neighbor of page?.messages ?? []) {
        add(neighbor, { kind: "temporal_neighbor", anchor_uuid: row.uuid });
      }
    }
    for (const query of request.queries) {
      const hits = api.search(query, { sessionId: request.root_session_id, source: "codex", limit: 4 });
      for (const hit of hits) {
        const page = api.messages(hit.message.uuid);
        add(page?.anchor, { kind: "search", query });
      }
    }
    for (const candidate of candidates) if (!appendEvidence(candidate)) break;
    output.omitted_candidates = candidates.length - output.evidence.length;
  } else {
    const page = api.messages({ sessionId: request.root_session_id, agentId,
      contentTypes: allowedTypes, includeMeta: false, limit: request.limit,
      ...(request.checkpoint?.cursor ? { cursor: request.checkpoint.cursor } : {}) });
    const rows = page?.messages ?? [];
    // Fail closed if a provider/API change breaks the requested structural filter.
    if (rows.some((row) => !visible(row) || !belongs(row, agentId))) {
      throw new Error("Audit page contains evidence outside the requested scope");
    }
    for (const row of rows) if (!appendEvidence({ row, origin: { kind: "agent_page" } })) break;
    output.has_more = Boolean(page?.hasMore) || output.evidence.length < rows.length;
    const last = output.evidence.at(-1);
    output.proposed_checkpoint = {
      root_session_id: request.root_session_id, agent_id: agentId,
      cursor: last ? { timestamp: last.timestamp, uuid: last.uuid } : request.checkpoint?.cursor ?? null,
    };
  }
  const clipped = output.evidence.some((row) => row.truncated || row.index_limit_reached ||
    row.tool_details_unavailable || row.more_tool_rows || row.tools?.some((tool) =>
      tool.result_unavailable || tool.input.truncated || tool.result.truncated ||
      tool.input.index_limit_reached || tool.result.index_limit_reached));
  if (clipped || output.omitted_candidates || output.unresolved_anchors?.length) output.status = "partial";
  output.excerpt_chars_returned = request.max_chars - remaining;
  return output;
}

export function buildQuery(input) {
  const request = validateRequest(input);
  return `// Generated scoped Obelisk query. Run with obelisk --query, not node.\n` +
    `const request = ${JSON.stringify(request)};\n` +
    `return (${collectContext.toString()})(request, { overview, sessions, subagents, messages, search, sql });\n`;
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (!["--request", "--out"].includes(flag) || options[flag.slice(2)] !== undefined || !args[index + 1] ||
        args[index + 1].startsWith("--")) throw new TypeError("Use --request <json-file> --out <new-query.mjs>");
    options[flag.slice(2)] = args[++index];
  }
  if (!options.request || !options.out) throw new TypeError("Both --request and --out are required");
  return options;
}

export function writeQuery(requestPath, outputPath) {
  if (fs.statSync(requestPath).size > 65536) throw new RangeError("Request file exceeds 64 KiB");
  const input = JSON.parse(fs.readFileSync(requestPath, "utf8").replace(/^\uFEFF/, ""));
  const query = buildQuery(input);
  const destination = path.resolve(outputPath);
  fs.writeFileSync(destination, query, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { query_file: destination, command_argv: ["obelisk", "--query", destination] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log("Generate a bounded Obelisk query: --request <json-file> --out <new-query.mjs>");
    else console.log(JSON.stringify(writeQuery(options.request, options.out), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
