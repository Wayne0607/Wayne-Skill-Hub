import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";

const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_RECORD_CHARS = 8 * 1024 * 1024;
const OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output", "tool_search_output"]);

function parentId(meta) {
  return meta?.source?.subagent?.thread_spawn?.parent_thread_id ??
    meta?.source?.subagent?.parent_thread_id ?? meta?.forked_from_id ?? null;
}

function outputText(payload) {
  for (const key of ["output", "tools", "execution"]) {
    if (payload[key] !== undefined) return typeof payload[key] === "string" ? payload[key] : JSON.stringify(payload[key]);
  }
  return null;
}

// The caller supplies this descriptor only from a successful, scoped Obelisk query.
// No CLI option accepts a transcript path or a pre-made descriptor.
export async function restoreReceipt(descriptor) {
  const { receipt: r, scope, source_ref: ref } = descriptor;
  const gap = (reason) => ({ status: "partial", gap: reason, source_ref: ref, scope });
  if (descriptor.status !== "receipt_descriptor" || !r || !ref) return gap("receipt_descriptor_unavailable");
  if (r.indexed_content == null) return gap("receipt_not_yet_indexed");
  if (r.source_candidates.length !== 1) return gap(r.source_candidates.length ? "ambiguous_source_path" : "source_path_unavailable");
  const filename = r.source_candidates[0];
  if (!path.isAbsolute(filename) || !filename.endsWith(`${r.native_thread_id}.jsonl`)) return gap("source_path_mismatch");
  let before;
  try { before = fs.statSync(filename); } catch { return gap("source_unavailable"); }
  if (!before.isFile() || before.size === 0 || before.size > MAX_FILE_BYTES) return gap("source_file_limit_or_type");
  const wantedOrdinal = Number(r.call_message_uuid.split(":").at(-1));
  let ordinal = 0;
  let headerValid = false;
  let callValid = false;
  let oversized = false;
  const results = [];
  const stream = fs.createReadStream(filename, { encoding: "utf8", start: 0, end: before.size - 1 });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      ordinal++;
      if (line.length > MAX_RECORD_CHARS) { oversized = true; continue; }
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const p = record.payload ?? {};
      if (record.type === "session_meta") {
        const own = p.id === r.native_thread_id;
        const parent = parentId(p);
        headerValid = own && (scope.agent_id === null ? parent === null : parent === r.root_native_id);
      }
      if (ordinal === wantedOrdinal) {
        callValid = record.type === "response_item" &&
          ["function_call", "custom_tool_call", "tool_search_call"].includes(p.type) && p.call_id === r.call_id;
      }
      if (record.type !== "response_item" || !OUTPUT_TYPES.has(p.type) || p.call_id !== r.call_id) continue;
      const content = outputText(p);
      if (content !== null) results.push({ ordinal, content });
    }
  } catch { return gap("source_read_failed"); }
  finally { lines.close(); stream.destroy(); }
  let after;
  try { after = fs.statSync(filename); } catch { return gap("source_changed"); }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) return gap("source_changed");
  if (!headerValid || !callValid) return gap("source_identity_or_call_mismatch");
  const capReached = r.indexed_content.length >= 10000;
  const matches = results.filter((item) => capReached ? item.content.startsWith(r.indexed_content) : item.content === r.indexed_content);
  const unique = [...new Set(matches.map((item) => item.content))];
  if (unique.length !== 1) return gap(unique.length > 1 ? "ambiguous_receipt" : oversized ? "source_record_limit" : "source_receipt_mismatch_or_missing");
  const content = unique[0];
  return {
    status: "recovered", scope, source_ref: ref, content,
    provenance: { call_message_uuid: r.call_message_uuid, tool_use_id: r.tool_use_id,
      source_file: filename, source_ordinals: matches.filter((item) => item.content === content).map((item) => item.ordinal),
      index_characters: r.indexed_content.length, index_cap_reached: capReached,
      index_prefix_verified: true, source_characters: content.length,
      sha256: createHash("sha256").update(content).digest("hex") },
  };
}

// Decode only complete JSON values. A capped JSON prefix must never reach JSON.parse().
export function readableReceipt(content) {
  const leaves = [];
  let total = 0;
  const visit = (value, location, depth) => {
    if (depth > 12 || total >= 2 * 1024 * 1024) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try { visit(JSON.parse(value), location, depth + 1); return; } catch { /* Plain recorded text. */ }
      }
      const kept = value.slice(0, 2 * 1024 * 1024 - total);
      leaves.push(`[${location}]\n${kept}`);
      total += kept.length;
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${location}[${index}]`, depth + 1));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (!["thinking", "reasoning", "analysis"].includes(key)) visit(item, `${location}.${key}`, depth + 1);
      }
    } else if (value === null || typeof value === "number" || typeof value === "boolean") {
      visit(JSON.stringify(value), location, depth + 1);
    }
  };
  visit(content, "receipt", 0);
  return leaves.join("\n\n");
}

export function textWindow(text, { find, offset = 0, chars = 3000 } = {}) {
  const match = find === undefined ? null : text.toLocaleLowerCase().indexOf(find.toLocaleLowerCase());
  const start = match === null ? offset : match < 0 ? 0 : Math.max(0, match - 120);
  const excerpt = text.slice(start, start + chars);
  return { offset: start, length: excerpt.length, total_characters: text.length, excerpt,
    has_more_before: start > 0, has_more_after: start + excerpt.length < text.length,
    ...(find === undefined ? {} : { find, match_found: match >= 0 }) };
}
