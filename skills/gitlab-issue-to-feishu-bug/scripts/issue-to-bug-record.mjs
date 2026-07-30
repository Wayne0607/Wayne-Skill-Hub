#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE = path.resolve(
  SCRIPT_DIR,
  "..",
  "references",
  "tcode-bug-profile.json",
);
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]{8,}$/;
const ISSUE_URL_PATTERN =
  /^https?:\/\/(?<host>[^/]+)\/(?<project>.+?)\/-\/(?:work_items|issues)\/(?<iid>\d+)(?:[/?#].*)?$/;
const MR_URL_PATTERN =
  /^https?:\/\/(?<host>[^/]+)\/(?<project>.+?)\/-\/merge_requests\/(?<iid>\d+)(?:[/?#].*)?$/;
const CORE_PROFILE_SEMANTICS = [
  "bug_id",
  "processed_at",
  "note",
  "submitter",
  "submit_agent",
  "status",
  "module",
  "description",
  "issue_url",
  "priority",
  "severity",
  "discovered_version",
  "handler",
  "pr_url",
  "handler_agent",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadJson(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function normalizeAlias(value) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function normalizeExact(value) {
  return value.trim().toLocaleLowerCase("en-US");
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  return value;
}

function validateProfile(profile) {
  if (!isObject(profile)) {
    throw new Error("Profile must be a JSON object");
  }
  for (const key of [
    "profile_id",
    "table_name",
    "business_key_semantic",
  ]) {
    assertString(profile[key], `Profile ${key}`);
  }
  if (profile.profile_version !== 1) {
    throw new Error("Profile profile_version must be the supported version 1");
  }
  if (!Array.isArray(profile.fields) || profile.fields.length === 0) {
    throw new Error("Profile fields must be a non-empty array");
  }

  const semantics = new Set();
  const names = new Set();
  const fieldsBySemantic = new Map();
  for (const field of profile.fields) {
    if (!isObject(field)) {
      throw new Error("Each profile field must be an object");
    }
    const semantic = assertString(field.semantic, "Profile field semantic");
    const name = assertString(field.name, "Profile field name");
    assertString(field.type, `Profile field ${name} type`);
    if (semantics.has(semantic)) {
      throw new Error(`Duplicate profile semantic: ${semantic}`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate profile field name: ${name}`);
    }
    semantics.add(semantic);
    names.add(name);
    fieldsBySemantic.set(semantic, field);
    if (
      field.write_mode !== undefined &&
      !["never", "separate"].includes(field.write_mode)
    ) {
      throw new Error(
        `Profile field ${name} write_mode must be 'never' or 'separate' when provided`,
      );
    }
    if (field.options !== undefined) {
      if (
        !Array.isArray(field.options) ||
        field.options.some((option) => typeof option !== "string")
      ) {
        throw new Error(`Profile field ${name} options must be a string array`);
      }
    }
  }

  if (!semantics.has(profile.business_key_semantic)) {
    throw new Error("Profile business_key_semantic is not defined in fields");
  }
  for (const semantic of CORE_PROFILE_SEMANTICS) {
    if (!semantics.has(semantic)) {
      throw new Error(`Profile is missing required core semantic ${semantic}`);
    }
  }
  for (const listName of [
    "required_semantics",
    "lifecycle_update_semantics",
  ]) {
    const values = profile[listName] ?? [];
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== "string")
    ) {
      throw new Error(`Profile ${listName} must be a string array`);
    }
    for (const semantic of values) {
      if (!semantics.has(semantic)) {
        throw new Error(`Profile ${listName} references unknown semantic ${semantic}`);
      }
      const field = fieldsBySemantic.get(semantic);
      if (field.write_mode) {
        throw new Error(
          `Profile ${listName} cannot reference ${semantic} with write_mode ${field.write_mode}`,
        );
      }
    }
  }
  if (!isObject(profile.status_by_issue_state)) {
    throw new Error("Profile status_by_issue_state must be an object");
  }
  const statusField = fieldsBySemantic.get("status");
  const statusOptions = statusField.options ?? [];
  for (const state of ["opened", "closed"]) {
    if (!statusOptions.includes(profile.status_by_issue_state[state])) {
      throw new Error(
        `Profile status_by_issue_state.${state} must be an option of ${statusField.name}`,
      );
    }
  }

  const moduleField = fieldsBySemantic.get("module");
  if (moduleField.type !== "select" || moduleField.multiple !== true) {
    throw new Error("Profile module field must be a multiple select");
  }
  const moduleOptions = moduleField.options ?? [];
  const aliases = profile.module_aliases ?? {};
  if (!isObject(aliases)) {
    throw new Error("Profile module_aliases must be an object");
  }
  for (const [alias, target] of Object.entries(aliases)) {
    if (!alias || typeof target !== "string" || !moduleOptions.includes(target)) {
      throw new Error(
        `Profile module alias ${JSON.stringify(alias)} targets an invalid module option`,
      );
    }
  }

  const priorityOptions = fieldsBySemantic.get("priority").options ?? [];
  const severityOptions = fieldsBySemantic.get("severity").options ?? [];
  if (!isObject(profile.severity_by_priority)) {
    throw new Error("Profile severity_by_priority must be an object");
  }
  for (const priority of priorityOptions) {
    const severity = profile.severity_by_priority[priority];
    if (!severityOptions.includes(severity)) {
      throw new Error(
        `Profile severity_by_priority.${priority} must be a severity option`,
      );
    }
  }

  const allowedLifecycle = new Set([
    "status",
    "module",
    "priority",
    "severity",
    "handler",
    "processed_at",
    "handler_agent",
    "pr_url",
  ]);
  for (const semantic of profile.lifecycle_update_semantics ?? []) {
    if (
      !allowedLifecycle.has(semantic) ||
      semantic === profile.business_key_semantic
    ) {
      throw new Error(
        `Profile lifecycle_update_semantics contains unsafe semantic ${semantic}`,
      );
    }
  }

  return profile;
}

function profileField(profile, semantic) {
  const field = profile.fields.find((candidate) => candidate.semantic === semantic);
  if (!field) {
    throw new Error(`Profile has no field for semantic ${semantic}`);
  }
  return field;
}

function fieldOptions(profile, semantic) {
  return profileField(profile, semantic).options ?? [];
}

function omittedSemanticSet(profile, values) {
  const byName = new Map(profile.fields.map((field) => [field.name, field.semantic]));
  const semantics = new Set(profile.fields.map((field) => field.semantic));
  const omitted = new Set();
  for (const value of values) {
    const semantic = semantics.has(value) ? value : byName.get(value);
    if (!semantic) {
      throw new Error(`--omit references unknown field or semantic ${JSON.stringify(value)}`);
    }
    omitted.add(semantic);
  }
  return omitted;
}

function validateSelectOverride(profile, semantic, value) {
  const options = fieldOptions(profile, semantic);
  if (!options.includes(value)) {
    throw new Error(
      `${profileField(profile, semantic).name} must be one of ${JSON.stringify(options)}`,
    );
  }
  return value;
}

function parseModuleOverride(profile, value) {
  const values = value
    .split(/[,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const options = fieldOptions(profile, "module");
  const invalid = values.filter((item) => !options.includes(item));
  if (invalid.length > 0) {
    throw new Error(`bug模块 contains invalid values ${JSON.stringify(invalid)}`);
  }
  return [...new Set(values)];
}

function labelsFrom(issue) {
  const labels = issue.labels ?? [];
  if (!Array.isArray(labels)) {
    throw new Error("Issue labels must be an array");
  }
  return labels.map((label) => {
    if (typeof label === "string") {
      return label;
    }
    if (isObject(label) && typeof label.name === "string") {
      return label.name;
    }
    throw new Error("Each Issue label must be a string or an object with name");
  });
}

function validateIssue(issue, expectedProject) {
  if (!isObject(issue)) {
    throw new Error("Issue JSON must be an object");
  }
  const iidText = String(issue.iid ?? "");
  if (!/^\d+$/.test(iidText)) {
    throw new Error("Issue iid must be an integer");
  }
  const iid = Number(iidText);
  const title = assertString(issue.title, "Issue title");
  const issueUrl = assertString(issue.web_url, "Issue web_url");
  const urlMatch = issueUrl.match(ISSUE_URL_PATTERN);
  if (!urlMatch?.groups) {
    throw new Error("Issue web_url is not a recognized GitLab Issue/work-item URL");
  }
  const project = urlMatch.groups.project;
  const host = urlMatch.groups.host.toLocaleLowerCase("en-US");
  const urlIid = Number(urlMatch.groups.iid);
  if (urlIid !== iid) {
    throw new Error(`Issue iid ${iid} does not match web_url IID ${urlIid}`);
  }
  if (expectedProject && project !== expectedProject) {
    throw new Error(
      `Issue project ${JSON.stringify(project)} does not match expected project ${JSON.stringify(expectedProject)}`,
    );
  }

  const references = issue.references ?? {};
  if (!isObject(references)) {
    throw new Error("Issue references must be an object");
  }
  let fullReference = `${project}#${iid}`;
  if (references.full !== undefined && references.full !== null) {
    fullReference = assertString(references.full, "Issue references.full");
    const referenceMatch = fullReference.match(/^(.+)#(\d+)$/);
    if (
      !referenceMatch ||
      referenceMatch[1] !== project ||
      Number(referenceMatch[2]) !== iid
    ) {
      throw new Error("Issue references.full does not match web_url and iid");
    }
  }

  if (!["opened", "closed"].includes(issue.state)) {
    throw new Error("Issue state must be 'opened' or 'closed'");
  }
  labelsFrom(issue);

  const assignees = issue.assignees ?? [];
  if (!Array.isArray(assignees)) {
    throw new Error("Issue assignees must be an array");
  }
  for (const assignee of assignees) {
    if (!isObject(assignee)) {
      throw new Error("Each Issue assignee must be an object");
    }
    for (const key of ["name", "username"]) {
      if (assignee[key] !== undefined && typeof assignee[key] !== "string") {
        throw new Error(`Issue assignee ${key} must be a string`);
      }
    }
  }
  if (issue.author !== undefined && issue.author !== null && !isObject(issue.author)) {
    throw new Error("Issue author must be an object or null");
  }
  if (issue.closed_at !== undefined && issue.closed_at !== null) {
    assertString(issue.closed_at, "Issue closed_at");
  }

  return {
    iid,
    title,
    issueUrl,
    host,
    project,
    fullReference,
    state: issue.state,
    assignees,
  };
}

function titleModuleCandidates(title) {
  return [...title.matchAll(/\[([^\]]+)\]/g)]
    .flatMap((match) => match[1].split(/[\/,+&、，]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function inferModules(issue, profile) {
  const candidates = labelsFrom(issue).map((label) => ({
    value: label,
    source: `标签 ${JSON.stringify(label)}`,
  }));
  for (const prefix of titleModuleCandidates(issue.title)) {
    candidates.push({
      value: prefix,
      source: `标题前缀 ${JSON.stringify(prefix)}`,
    });
  }
  const aliases = profile.module_aliases ?? {};
  if (!isObject(aliases)) {
    throw new Error("Profile module_aliases must be an object");
  }
  const options = fieldOptions(profile, "module");
  const matches = new Map();
  for (const candidate of candidates) {
    const normalized = normalizeAlias(candidate.value);
    const aliasValue = aliases[normalized];
    const module =
      typeof aliasValue === "string"
        ? aliasValue
        : options.find((option) => normalizeAlias(option) === normalized);
    if (module) {
      const sources = matches.get(module) ?? [];
      sources.push(candidate.source);
      matches.set(module, sources);
    }
  }
  const values = options.filter((option) => matches.has(option));
  const sources = values.flatMap((value) => matches.get(value));
  return {
    values,
    source: sources.length > 0 ? sources.join("；") : null,
  };
}

function inferExactOption(labels, options) {
  const matches = new Map();
  for (const label of labels) {
    for (const option of options) {
      if (normalizeExact(label) === normalizeExact(option)) {
        const sources = matches.get(option) ?? [];
        sources.push(`标签 ${JSON.stringify(label)}`);
        matches.set(option, sources);
      }
    }
  }
  if (matches.size === 1) {
    const [value, sources] = [...matches.entries()][0];
    return { value, source: sources.join("；"), conflicts: [] };
  }
  if (matches.size > 1) {
    return { value: null, source: null, conflicts: [...matches.keys()].sort() };
  }
  return { value: null, source: null, conflicts: [] };
}

function shanghaiClosedDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  assertString(value, "Issue closed_at");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error(`Issue closed_at is not valid ISO 8601: ${JSON.stringify(value)}`);
  }
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`Issue closed_at is not a real date: ${JSON.stringify(value)}`);
  }
  return `${new Date(milliseconds + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)} 00:00:00`;
}

function normalizeProcessedAt(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/,
  );
  if (!match) {
    throw new Error(
      "--processed-at must be a real date in YYYY-MM-DD or YYYY-MM-DD HH:mm:ss format",
    );
  }
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ];
  if (
    parts[0] !== Number(year) ||
    parts[1] !== month ||
    parts[2] !== day ||
    parts[3] !== hour ||
    parts[4] !== minute ||
    parts[5] !== second
  ) {
    throw new Error(
      "--processed-at must be a real date in YYYY-MM-DD or YYYY-MM-DD HH:mm:ss format",
    );
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function validateOpenId(label, value) {
  if (value && !OPEN_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a real-looking Feishu open_id starting with 'ou_'`);
  }
}

function validatePerson(openIdLabel, openId, nameLabel, name) {
  validateOpenId(openIdLabel, openId);
  if (openId && (typeof name !== "string" || name.trim() === "")) {
    throw new Error(`${nameLabel} is required when ${openIdLabel} is provided`);
  }
  if (name && !openId) {
    throw new Error(`${openIdLabel} is required when ${nameLabel} is provided`);
  }
}

function parseMrUrl(url, label) {
  const match = url.match(MR_URL_PATTERN);
  if (!match?.groups) {
    throw new Error(`${label} must be a valid GitLab merge request URL`);
  }
  return {
    url,
    host: match.groups.host.toLocaleLowerCase("en-US"),
    project: match.groups.project,
    iid: Number(match.groups.iid),
  };
}

function canonicalUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLocaleLowerCase("en-US")}${url.pathname.replace(/\/+$/, "")}`;
}

function relatedMrUrls(payload, issueIdentity) {
  let records = payload;
  if (isObject(records)) {
    records = records.data ?? records.merge_requests ?? [];
  }
  if (!Array.isArray(records)) {
    throw new Error("Related MR JSON must be an array or an envelope containing an array");
  }
  const urls = [];
  for (const record of records) {
    if (!isObject(record)) {
      throw new Error("Each related MR must be an object");
    }
    if (record.web_url === undefined || record.web_url === null) {
      continue;
    }
    const url = assertString(record.web_url, "Related MR web_url");
    const identity = parseMrUrl(url, "Related MR web_url");
    if (
      identity.host !== issueIdentity.host ||
      identity.project !== issueIdentity.project
    ) {
      throw new Error("Related MR must belong to the same GitLab host and project as the Issue");
    }
    urls.push(canonicalUrl(url));
  }
  return [...new Set(urls)];
}

function validateBaseSchema(profile, response, activeSemantics = null) {
  if (!isObject(response)) {
    return { ok: false, differences: ["Base field response is not an object"] };
  }
  if (response.ok === false) {
    return { ok: false, differences: ["Base field response reports ok=false"] };
  }
  const actualFields = response.data?.fields ?? response.fields;
  if (!Array.isArray(actualFields)) {
    return { ok: false, differences: ["Base field response has no fields array"] };
  }
  const byName = new Map(
    actualFields
      .filter((field) => isObject(field) && typeof field.name === "string")
      .map((field) => [field.name, field]),
  );
  const differences = [];
  for (const expected of profile.fields) {
    if (activeSemantics && !activeSemantics.has(expected.semantic)) {
      continue;
    }
    const actual = byName.get(expected.name);
    if (!actual) {
      differences.push(`missing field: ${expected.name}`);
      continue;
    }
    if (actual.type !== expected.type) {
      differences.push(
        `${expected.name}: type ${JSON.stringify(actual.type)} != ${JSON.stringify(expected.type)}`,
      );
    }
    if (
      expected.multiple !== undefined &&
      actual.multiple !== expected.multiple
    ) {
      differences.push(
        `${expected.name}: multiple ${JSON.stringify(actual.multiple)} != ${JSON.stringify(expected.multiple)}`,
      );
    }
    if (expected.options) {
      const actualOptions = Array.isArray(actual.options)
        ? actual.options
            .map((option) => option?.name)
            .filter((name) => typeof name === "string")
            .sort()
        : [];
      const expectedOptions = [...expected.options].sort();
      if (JSON.stringify(actualOptions) !== JSON.stringify(expectedOptions)) {
        differences.push(
          `${expected.name}: options ${JSON.stringify(actualOptions)} != ${JSON.stringify(expectedOptions)}`,
        );
      }
    }
  }
  return { ok: differences.length === 0, differences };
}

function markdownLink(url) {
  return `[${url}](${url})`;
}

function buildPreview(options) {
  const profile = validateProfile(loadJson(options.profile ?? DEFAULT_PROFILE));
  const omittedSemantics = omittedSemanticSet(profile, options.omit ?? []);
  const issue = loadJson(options.issueJson);
  const identity = validateIssue(issue, options.expectedProject);
  validatePerson(
    "--submitter-open-id",
    omittedSemantics.has("submitter") ? undefined : options.submitterOpenId,
    "--submitter-name",
    omittedSemantics.has("submitter") ? undefined : options.submitterName,
  );
  validatePerson(
    "--handler-open-id",
    omittedSemantics.has("handler") ? undefined : options.handlerOpenId,
    "--handler-name",
    omittedSemantics.has("handler") ? undefined : options.handlerName,
  );

  const relatedPayload = options.relatedMrsJson
    ? loadJson(options.relatedMrsJson)
    : [];
  const mrUrls = relatedMrUrls(relatedPayload, identity);
  const targetDifferences = [];
  if (!options.resolvedBaseTitle) {
    targetDifferences.push("the user-provided Base/Wiki URL was not resolved");
  }
  if (!options.resolvedTableName) {
    targetDifferences.push("resolved table name was not provided");
  } else if (options.resolvedTableName !== profile.table_name) {
    targetDifferences.push(
      `table name ${JSON.stringify(options.resolvedTableName)} != ${JSON.stringify(profile.table_name)}`,
    );
  }
  const targetValidation = {
    ok: targetDifferences.length === 0,
    differences: targetDifferences,
  };

  const semanticValues = new Map();
  const inferences = [];
  const overrides = [];
  const optionalIssues = [];
  const resolutionNeeded = [];
  const omittedFields = [...omittedSemantics].map((semantic) => ({
    semantic,
    field: profileField(profile, semantic).name,
    source: "用户明确要求留空",
  }));
  const set = (semantic, value) => {
    if (
      !omittedSemantics.has(semantic) &&
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      semanticValues.set(semantic, value);
    }
  };
  const setOverride = (semantic, value) => {
    if (omittedSemantics.has(semantic) || value === undefined) {
      return false;
    }
    set(semantic, value);
    overrides.push({
      field: profileField(profile, semantic).name,
      value,
      source: "用户命令",
    });
    return true;
  };

  if (!setOverride("bug_id", options.bugId)) {
    set("bug_id", identity.fullReference);
  }
  if (!setOverride("description", options.description)) {
    set("description", identity.title);
  }
  if (!setOverride(
    "issue_url",
    options.issueUrl ? markdownLink(options.issueUrl) : undefined,
  )) {
    set("issue_url", markdownLink(identity.issueUrl));
  }

  const statusOptions = fieldOptions(profile, "status");
  const inferredStatus = profile.status_by_issue_state[identity.state];
  if (!statusOptions.includes(inferredStatus)) {
    throw new Error(
      `Status ${JSON.stringify(inferredStatus)} is not allowed by profile`,
    );
  }
  if (!setOverride(
    "status",
    options.status === undefined
      ? undefined
      : validateSelectOverride(profile, "status", options.status),
  )) {
    set("status", inferredStatus);
  }

  const labels = labelsFrom(issue);
  const moduleInference = inferModules(issue, profile);
  if (options.module !== undefined) {
    setOverride("module", parseModuleOverride(profile, options.module));
  } else if (
    !omittedSemantics.has("module") &&
    moduleInference.values.length > 0
  ) {
    set("module", moduleInference.values);
    inferences.push({
      field: profileField(profile, "module").name,
      value: moduleInference.values,
      source: moduleInference.source,
      confidence: "high",
    });
  } else if (!omittedSemantics.has("module")) {
    optionalIssues.push({
      field: profileField(profile, "module").name,
      reason: "Issue 中没有可识别模块；字段保持为空",
    });
  }

  const priorityOptions = fieldOptions(profile, "priority");
  const priorityInference = inferExactOption(labels, priorityOptions);
  let priority = priorityInference.value;
  if (options.priority !== undefined) {
    priority = validateSelectOverride(profile, "priority", options.priority);
    setOverride("priority", priority);
  } else {
    set("priority", priority);
  }
  if (priority && options.priority === undefined && !omittedSemantics.has("priority")) {
    inferences.push({
      field: profileField(profile, "priority").name,
      value: priority,
      source: priorityInference.source,
      confidence: "high",
    });
  }

  const severityOptions = fieldOptions(profile, "severity");
  const directSeverity = inferExactOption(labels, severityOptions);
  const prioritySeverity = priority
    ? profile.severity_by_priority[priority]
    : null;
  let severity = directSeverity.value ?? prioritySeverity;
  let severityConflicts = directSeverity.conflicts;
  if (options.severity !== undefined) {
    severity = validateSelectOverride(profile, "severity", options.severity);
    severityConflicts = [];
    setOverride("severity", severity);
  } else if (
    directSeverity.value &&
    prioritySeverity &&
    directSeverity.value !== prioritySeverity
  ) {
    severityConflicts = [directSeverity.value, prioritySeverity].sort();
    severity = null;
  } else {
    set("severity", severity);
  }
  if (severity && options.severity === undefined && !omittedSemantics.has("severity")) {
    inferences.push({
      field: profileField(profile, "severity").name,
      value: severity,
      source: directSeverity.value
        ? directSeverity.source
        : `优先级标签 ${JSON.stringify(priority)}`,
      confidence: "high",
    });
  }

  if (options.processedAt && !omittedSemantics.has("processed_at")) {
    setOverride("processed_at", normalizeProcessedAt(options.processedAt));
  } else if (identity.state === "closed" && !omittedSemantics.has("processed_at")) {
    optionalIssues.push({
      field: profileField(profile, "processed_at").name,
      reason: "无法确定该字段表示关闭日还是登记日；字段保持为空",
      suggested_value: shanghaiClosedDate(issue.closed_at),
    });
  }

  let prUrl = omittedSemantics.has("pr_url") ? null : options.prUrl;
  if (prUrl) {
    parseMrUrl(prUrl, "--pr-url");
    prUrl = canonicalUrl(prUrl);
  }
  if (!omittedSemantics.has("pr_url") && !prUrl && mrUrls.length === 1) {
    [prUrl] = mrUrls;
    inferences.push({
      field: profileField(profile, "pr_url").name,
      value: prUrl,
      source: "唯一关联 MR",
      confidence: "high",
    });
  }
  if (options.prUrl) {
    setOverride("pr_url", markdownLink(prUrl));
  } else {
    set("pr_url", prUrl ? markdownLink(prUrl) : null);
  }

  if (options.submitterOpenId) {
    setOverride("submitter", [{ id: options.submitterOpenId }]);
  } else if (!omittedSemantics.has("submitter")) {
    optionalIssues.push({
      field: profileField(profile, "submitter").name,
      reason: "无法取得飞书账号时字段保持为空",
    });
  }
  if (options.handlerOpenId) {
    setOverride("handler", [{ id: options.handlerOpenId }]);
  }
  setOverride("submit_agent", options.submitAgent);
  setOverride("handler_agent", options.handlerAgent);
  setOverride("discovered_version", options.discoveredVersion);
  setOverride("note", options.note);

  if (
    priorityInference.conflicts.length > 0 &&
    options.priority === undefined &&
    !omittedSemantics.has("priority")
  ) {
    optionalIssues.push({
      field: profileField(profile, "priority").name,
      reason: "Issue 中存在冲突的优先级标签；字段保持为空",
      candidates: priorityInference.conflicts,
      allowed_values: priorityOptions,
    });
  }
  if (
    severityConflicts.length > 0 &&
    options.severity === undefined &&
    !omittedSemantics.has("severity")
  ) {
    optionalIssues.push({
      field: profileField(profile, "severity").name,
      reason: "Issue 中的严重程度与优先级映射冲突；字段保持为空",
      candidates: severityConflicts,
      allowed_values: severityOptions,
    });
  }
  if (
    !semanticValues.has("priority") &&
    priorityInference.conflicts.length === 0 &&
    !omittedSemantics.has("priority")
  ) {
    optionalIssues.push({
      field: profileField(profile, "priority").name,
      reason: "Issue 中没有优先级；字段保持为空",
      allowed_values: priorityOptions,
    });
  }
  if (
    !semanticValues.has("severity") &&
    severityConflicts.length === 0 &&
    !omittedSemantics.has("severity")
  ) {
    optionalIssues.push({
      field: profileField(profile, "severity").name,
      reason: "Issue 中没有严重程度；字段保持为空",
      allowed_values: severityOptions,
    });
  }

  const assigneeNames = identity.assignees
    .map((assignee) => assignee.name || assignee.username)
    .filter(Boolean);
  if (
    assigneeNames.length > 0 &&
    !options.handlerOpenId &&
    !omittedSemantics.has("handler")
  ) {
    optionalIssues.push({
      field: profileField(profile, "handler").name,
      reason: "GitLab assignee 不能直接写入飞书人员字段；字段保持为空",
      candidates_from_gitlab: assigneeNames,
    });
  }
  if (
    mrUrls.length > 1 &&
    !options.prUrl &&
    !omittedSemantics.has("pr_url")
  ) {
    optionalIssues.push({
      field: profileField(profile, "pr_url").name,
      reason: "Issue 关联多个 MR；字段保持为空",
      candidates: mrUrls,
    });
  }

  const activeSemantics = new Set(semanticValues.keys());
  const schemaValidation = options.baseFieldsJson
    ? validateBaseSchema(
        profile,
        loadJson(options.baseFieldsJson),
        activeSemantics,
      )
    : { ok: false, differences: ["live Base fields were not provided"] };
  if (!schemaValidation.ok) {
    resolutionNeeded.push({
      field: "目标表结构",
      reason: "实际准备写入的字段与实时 Base schema 不兼容",
      differences: schemaValidation.differences,
    });
  }
  if (!targetValidation.ok) {
    resolutionNeeded.push({
      field: "目标 Base/表",
      reason: "运行时解析出的 Base/表与 profile 不一致或未提供",
      differences: targetValidation.differences,
    });
  }

  const fields = Object.fromEntries(
    [...semanticValues.entries()].map(([semantic, value]) => [
      profileField(profile, semantic).name,
      value,
    ]),
  );
  const updateFields = Object.fromEntries(
    (profile.lifecycle_update_semantics ?? [])
      .filter((semantic) => {
        const explicit = {
          status: options.status !== undefined || identity.state === "closed",
          module: semanticValues.has("module"),
          priority: semanticValues.has("priority"),
          severity: semanticValues.has("severity"),
          handler: Boolean(options.handlerOpenId),
          processed_at: Boolean(options.processedAt),
          handler_agent: Boolean(options.handlerAgent),
          pr_url: Boolean(options.prUrl),
        };
        return explicit[semantic] && semanticValues.has(semantic);
      })
      .map((semantic) => [
        profileField(profile, semantic).name,
        semanticValues.get(semantic),
      ]),
  );
  const businessKeyField = profileField(
    profile,
    profile.business_key_semantic,
  ).name;
  const businessKeyValue = semanticValues.get(profile.business_key_semantic);
  if (!businessKeyValue) {
    optionalIssues.push({
      field: businessKeyField,
      reason: "用户要求留空，无法自动查重；仅可在确认后创建新记录",
    });
  }

  return {
    profile: {
      id: profile.profile_id,
      base_title: options.resolvedBaseTitle ?? null,
      table_name: profile.table_name,
    },
    fields,
    update_fields: updateFields,
    inferences,
    overrides,
    omitted_fields: omittedFields,
    optional_issues: optionalIssues,
    resolution_needed: resolutionNeeded,
    schema_validation: schemaValidation,
    target_validation: targetValidation,
    attachments: profile.fields
      .filter((field) => field.write_mode === "separate")
      .map((field) => ({
        field: field.name,
        type: field.type,
        write_separately: true,
      })),
    dedup_key: businessKeyValue
      ? {
          field: businessKeyField,
          value: businessKeyValue,
        }
      : null,
    dedup_filter: businessKeyValue
      ? {
          logic: "and",
          conditions: [[businessKeyField, "==", businessKeyValue]],
        }
      : null,
    source: {
      issue_iid: identity.iid,
      issue_project: identity.project,
      issue_url: identity.issueUrl,
      issue_state: identity.state,
      issue_author: isObject(issue.author) ? issue.author.username ?? null : null,
      gitlab_assignees: assigneeNames,
      related_mrs: mrUrls,
    },
    resolved_people: {
      submitter:
        options.submitterOpenId && !omittedSemantics.has("submitter")
        ? {
            open_id: options.submitterOpenId,
            name: options.submitterName,
            source: "lark-cli auth status",
          }
        : null,
      handler:
        options.handlerOpenId && !omittedSemantics.has("handler")
        ? {
            open_id: options.handlerOpenId,
            name: options.handlerName,
            source: "lark-cli contact search",
          }
        : null,
    },
    ready_for_confirmation:
      schemaValidation.ok && targetValidation.ok,
    candidate_only: true,
    write_authorized: false,
  };
}

function writeOutputs(preview, outputDir) {
  assertString(outputDir, "--output-dir");
  const resolvedOutputDir = path.resolve(outputDir);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relativeToTemp = path.relative(tempRoot, resolvedOutputDir);
  if (
    relativeToTemp === ".." ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp)
  ) {
    throw new Error("--output-dir must be inside the operating-system temporary directory");
  }
  if (fs.existsSync(resolvedOutputDir)) {
    if (fs.lstatSync(resolvedOutputDir).isSymbolicLink()) {
      throw new Error("--output-dir cannot be a symbolic link or junction");
    }
    if (!fs.statSync(resolvedOutputDir).isDirectory()) {
      throw new Error("--output-dir exists and is not a directory");
    }
    if (fs.readdirSync(resolvedOutputDir).length > 0) {
      throw new Error("--output-dir must be new or empty; existing files are never overwritten");
    }
  } else {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }
  const realOutputDir = fs.realpathSync(resolvedOutputDir);
  const realRelativeToTemp = path.relative(tempRoot, realOutputDir);
  if (
    realRelativeToTemp === ".." ||
    realRelativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelativeToTemp)
  ) {
    if (fs.readdirSync(realOutputDir).length === 0) {
      fs.rmdirSync(realOutputDir);
    }
    throw new Error("--output-dir resolves outside the operating-system temporary directory");
  }
  const paths = {
    preview: path.join(resolvedOutputDir, "preview.json"),
  };
  if (preview.dedup_filter) {
    paths.dedup_filter = path.join(resolvedOutputDir, "dedup-filter.json");
  }
  if (preview.ready_for_confirmation) {
    paths.fields = path.join(
      resolvedOutputDir,
      "candidate-create-fields.json",
    );
    paths.update_fields = path.join(
      resolvedOutputDir,
      "candidate-update-fields.json",
    );
  }
  const previewWithPaths = { ...preview, output_files: paths };
  const payloads = {
    preview: previewWithPaths,
  };
  if (preview.dedup_filter) {
    payloads.dedup_filter = preview.dedup_filter;
  }
  if (preview.ready_for_confirmation) {
    payloads.fields = preview.fields;
    payloads.update_fields = preview.update_fields;
  }
  for (const [name, filePath] of Object.entries(paths)) {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(payloads[name], null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return previewWithPaths;
}

function usage() {
  return `Usage:
  node issue-to-bug-record.mjs --issue-json <file> [options]

Options:
  --profile <file>
  --related-mrs-json <file>
  --base-fields-json <file>
  --resolved-base-title <title>
  --resolved-table-name <name>
  --expected-project <group/project>
  --submitter-open-id <ou_xxx>
  --submitter-name <name>
  --handler-open-id <ou_xxx>
  --handler-name <name>
  --bug-id <value>
  --description <text>
  --issue-url <url>
  --status <value>
  --module <value[,value...]>
  --priority <value>
  --severity <value>
  --omit <semantic-or-field-name> (repeatable)
  --submit-agent <name>
  --handler-agent <name>
  --discovered-version <version>
  --processed-at <YYYY-MM-DD[ HH:mm:ss]>
  --pr-url <GitLab MR URL>
  --note <text>
  --output-dir <dir>
  --help`;
}

function parseArgs(argv) {
  const keyMap = {
    "--profile": "profile",
    "--issue-json": "issueJson",
    "--related-mrs-json": "relatedMrsJson",
    "--base-fields-json": "baseFieldsJson",
    "--resolved-base-title": "resolvedBaseTitle",
    "--resolved-table-name": "resolvedTableName",
    "--expected-project": "expectedProject",
    "--submitter-open-id": "submitterOpenId",
    "--submitter-name": "submitterName",
    "--handler-open-id": "handlerOpenId",
    "--handler-name": "handlerName",
    "--bug-id": "bugId",
    "--description": "description",
    "--issue-url": "issueUrl",
    "--status": "status",
    "--module": "module",
    "--priority": "priority",
    "--severity": "severity",
    "--submit-agent": "submitAgent",
    "--handler-agent": "handlerAgent",
    "--discovered-version": "discoveredVersion",
    "--processed-at": "processedAt",
    "--pr-url": "prUrl",
    "--note": "note",
    "--output-dir": "outputDir",
  };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--omit") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--omit requires a value");
      }
      options.omit ??= [];
      options.omit.push(value);
      index += 1;
      continue;
    }
    const key = keyMap[argument];
    if (!key) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.help && !options.issueJson) {
    throw new Error("--issue-json is required");
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let preview = buildPreview(options);
  if (options.outputDir) {
    preview = writeOutputs(preview, options.outputDir);
  }
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  return 0;
}

export {
  buildPreview,
  loadJson,
  main,
  normalizeProcessedAt,
  parseArgs,
  shanghaiClosedDate,
  validateBaseSchema,
  validateIssue,
  validateProfile,
  writeOutputs,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 2;
  }
}
