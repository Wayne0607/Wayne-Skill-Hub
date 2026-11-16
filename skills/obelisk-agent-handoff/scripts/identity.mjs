const THREAD = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const THREAD_ID = new RegExp(`^codex:(${THREAD})$`);
const MESSAGE_ID = new RegExp(`^codex:(${THREAD}):([0-9]{6,10})$`);

export function threadId(value, label = "thread ID") {
  if (typeof value !== "string" || !THREAD_ID.test(value)) {
    throw new TypeError(`${label} requires a full canonical codex:<UUID> ID`);
  }
  return value;
}

export function messageId(value, label = "message UUID") {
  const match = typeof value === "string" && MESSAGE_ID.exec(value);
  if (!match || Number(match[2]) < 1) {
    throw new TypeError(`${label} requires a full codex:<UUID>:<six-or-more-digit ordinal>; abbreviations are invalid`);
  }
  return { uuid: value, thread_id: `codex:${match[1]}`, ordinal: Number(match[2]) };
}

export function sourceReference(input, rootId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("reference must be an object");
  const allowed = ["uuid", "root_session_id", "agent_id", "content_type", "role"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new TypeError("Unknown reference field");
  messageId(input.uuid);
  if (!Object.hasOwn(input, "agent_id")) throw new TypeError("reference requires explicit agent_id (null for main)");
  if (input.agent_id !== null) threadId(input.agent_id, "reference.agent_id");
  if (input.root_session_id !== undefined && input.root_session_id !== rootId) {
    throw new TypeError("reference root_session_id does not match the requested root");
  }
  if (input.content_type !== undefined && !["text", "tool_use", "tool_result"].includes(input.content_type)) {
    throw new TypeError("reference content_type must be visible text or tool evidence");
  }
  if (input.role !== undefined && !["user", "assistant", "tool"].includes(input.role)) {
    throw new TypeError("Unknown reference role");
  }
  return { ...input, root_session_id: rootId };
}
