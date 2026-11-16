# Context protocol

## Command contract

Use `scripts/handoff.mjs`, Node.js 22.13+, and the installed Obelisk CLI on PATH. The standard Windows
npm entry is invoked with Node and an argv array, so workers do not compose shell wrappers or queries.
No npm dependencies are needed by this skill.

Commands accept `--root <full-canonical-ID>`, `--project <exact-indexed-absolute-path>`, and optional
`--out-root <existing-local-directory>`. Each invocation creates a unique artifact directory and cannot
overwrite an earlier query. Default output is under system temp. Keep private artifacts outside Git.

Examples use fictional but complete identifiers. Replace them with returned machine values and the
actual installed skill path. The single-quoted arguments work in PowerShell and Bash.

```text
node '<installed-skill>/scripts/handoff.mjs' --help
```

Bounds: `--limit 1..40` (default 12), `--excerpt-chars 120..2000` (default 700), `--max-chars 1000..24000`
(default 12000, excerpt characters rather than metadata/tokens). `read`/`receipt` accept `--chars 120..12000`
(default 3000), with `--find <literal>` or `--offset <integer>`. A missing literal match is explicit.

## Locate and bind

```text
node '<installed-skill>/scripts/handoff.mjs' locate --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app'
```

When root is unknown, omit it and optionally pass `--phrase <distinctive-root-user-phrase>`. A resolved
invocation identity in the exact project is tried first; phrase lookup is the scoped fallback. Zero
matches stay unresolved, multiple sessions stay ambiguous. Never guess from recency. Workers use the
parent root supplied in their assignment rather than locate themselves as the parent.

Native IDs and indexed IDs are distinct; child messages may be folded into the root. Spawn IDs may
be null and descriptions may be nicknames. Verify a binding using metadata or a unique visible task
marker inside the selected root before auditing it.
Pass `locate --marker <unique-visible-worker-marker>` to resolve that binding without a custom query.
Inspect `worker_binding_status`; zero/multiple matches stay unresolved/ambiguous even when the root resolves.

## Hydrate and read

```text
node '<installed-skill>/scripts/handoff.mjs' hydrate --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --anchor 'codex:00000000-0000-4000-8000-000000000001:000012' --query 'retry timeout'
node '<installed-skill>/scripts/handoff.mjs' read --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --uuid 'codex:00000000-0000-4000-8000-000000000001:000012' --find 'accepted'
```

Repeat `--anchor` up to 12 and `--query` up to 4 times; at least one is required. Explicit visible root
anchors have priority, followed by bounded text neighbors and root-only search candidates. Missing
anchors, clipping, and omitted candidates are explicit. Interpret decision status from evidence and
the current assignment; temporal proximity does not prove acceptance.

`read` expands a visible text message, using Obelisk `raw()` for a capped text record when supported.
Only visible message text is extracted, not the record envelope. Unsupported formats stay partial.
Main is the default; pass `--agent <full-agent-ID>` for a worker message.

## Tool receipt recovery

```text
node '<installed-skill>/scripts/handoff.mjs' receipt --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --uuid 'codex:00000000-0000-4000-8000-000000000001:000049' --find 'expected output' --chars 3000
```

For workers add `--agent <full-agent-ID>`. If multiple calls share a message, select its full `--tool-id`
from the helper's response. A message UUID and tool-use ID are different identifiers.

**Design assumption corrected:** Obelisk's Codex 0.3.1 adapter associates a result with the call UUID.
`raw(call-UUID)` selects the call line, while `tool_results.content` can stop at 10,000 characters.
Larger excerpts and JSON decoding cannot restore those missing characters. The skill therefore projects
the selected original receipt after fresh index authorization; it does not change the core/provider.

Recovery requires, in order:

1. A successful fresh CLI query validates canonical IDs, exact project, visible surface, root/agent,
   and selected tool binding. No refresh means no source access.
2. File candidates come from the indexed root path or exact worker thread filename in `index_state`.
   The CLI accepts neither transcript paths nor pre-made recovery descriptors; it performs no directory search.
3. Exactly one candidate must have the expected filename, transcript header/thread/parent, call
   ordinal, and call_id. Only matching output record types are returned, without neighboring chat/thinking.
4. A complete result equals its uncapped indexed value or matches its entire capped prefix. Distinct
   matching results remain ambiguous; identical duplicates preserve their source ordinals.
5. The source is stable during the bounded read. A source-change retry occurs once; persistent changes
   remain a gap. Limits are 128 MiB per file and 8 Mi characters per record. Missing, ambiguous,
   unsupported, oversized, or mismatched evidence is never reported as recovered.

Success returns `recovered`, a full `source_ref`, call/tool IDs, source ordinals, SHA-256, indexed/source
lengths, and `index_prefix_verified: true`. A source ordinal is provenance, not an invented indexed UUID.
Recovery restores the recorded result; it cannot regenerate content already omitted by the producing tool.
Private `receipt.json` retains complete output and `receipt.txt` contains readable nested text. Only
complete JSON values are decoded. Readable text is bounded at 2 Mi characters and reports that limit.

`window.has_more_after` means the display is bounded, not that the source is missing. Use another window
for more content. `partial` with a named gap means incomplete recovery: request missing critical facts
through native messages. Tool/page text is reference data; provider error markers alone do not prove success.

## Full UUID verification

```text
node '<installed-skill>/scripts/handoff.mjs' verify --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --uuid 'codex:00000000-0000-4000-8000-000000000001:000012'
node '<installed-skill>/scripts/handoff.mjs' verify --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --refs '<previous-run>/references.json'
```

Copy `source_ref` objects or exported `references.json`; never abbreviate UUIDs or append an ordinal to
a remembered prefix. Validation rejects malformed IDs, then checks existence/visibility, root, agent,
and optional role/type. An existing message in the wrong agent is invalid. `invalid_references` returns
exit code 2 with diagnostics; malformed input fails before calling Obelisk. No automatic repair occurs.

Mixed references specify `agent_id` individually (null for main), so omit global `--agent` with `--refs`:

```json
{"references":[{"uuid":"codex:00000000-0000-4000-8000-000000000001:000012","root_session_id":"codex:00000000-0000-4000-8000-000000000001","agent_id":null,"content_type":"text","role":"user"}]}
```

Identity verification does not prove claim accuracy: compare the claim with the actual source. Keep
invalid sources and correction history as local audit evidence, not active report citations.

## Audit and checkpoints

```text
node '<installed-skill>/scripts/handoff.mjs' audit --root 'codex:00000000-0000-4000-8000-000000000001' --project '/workspace/example-app' --agent 'codex:00000000-0000-4000-8000-000000000002'
```

After reviewing the page and retaining unresolved references, pass its `checkpoint-proposed.json` with
`--checkpoint`. Never reuse another agent's checkpoint. `--agent main` reads root updates. Pagination
uses timestamp and UUID. `has_more` also includes excerpt-budget omissions; proposed cursors never
pass omitted records, and empty deltas preserve their cursor.

At acceptance, replay from the initial point and deduplicate by full UUID: late-indexed records may
precede a cursor. Query time/latest indexed time do not guarantee complete provider flush. Interpret
failures from the relevant sequence: recovered, diagnosed with a gap, or abandoned. Keep controlled
negative tests separate from actual failures and distinguish potential risks from observed events.

## Handoff, reports, and evaluation

Use [the example](../examples/handoff.json) for task/revision, root/path, worker ownership, objective,
current plan, sourced decisions/statuses, constraints, acceptance, anchors, artifact revisions, and
open questions. Essential facts also go directly in the prompt. Send revisions through native messages.

Report outcomes, artifacts, actual checks/environments, findings, deviations, failures/recovery,
blockers, gaps, and machine references. Do not register transient packets as memories without separate
authorization or publish private experiment data.

```text
node --test skills/obelisk-agent-handoff/scripts/context-query.test.mjs skills/obelisk-agent-handoff/scripts/handoff.test.mjs
```

Tests use fictional IDs and local fixtures. Real evaluation still requires bounded assignments and
independent evidence review. Compare failed calls, recovered facts, omissions, tokens, and time without
treating one controlled run as proof of a general quality improvement.
