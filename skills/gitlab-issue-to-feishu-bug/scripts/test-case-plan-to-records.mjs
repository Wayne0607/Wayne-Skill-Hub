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
  "tcode-test-case-profile.json",
);
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]{8,}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  return value;
}

function validateProfile(profile) {
  if (!isObject(profile)) {
    throw new Error("Profile must be an object");
  }
  for (const key of ["profile_id", "table_name", "business_key_semantic"]) {
    assertString(profile[key], `Profile ${key}`);
  }
  if (profile.profile_version !== 1) {
    throw new Error("Profile profile_version must be 1");
  }
  if (!Array.isArray(profile.fields) || profile.fields.length === 0) {
    throw new Error("Profile fields must be a non-empty array");
  }

  const semantics = new Set();
  const names = new Set();
  for (const field of profile.fields) {
    if (!isObject(field)) {
      throw new Error("Each profile field must be an object");
    }
    assertString(field.semantic, "Profile field semantic");
    assertString(field.name, "Profile field name");
    assertString(field.type, `Profile field ${field.name} type`);
    if (semantics.has(field.semantic) || names.has(field.name)) {
      throw new Error(`Duplicate profile field ${field.semantic}/${field.name}`);
    }
    semantics.add(field.semantic);
    names.add(field.name);
    if (
      field.options !== undefined &&
      (!Array.isArray(field.options) ||
        field.options.some((option) => typeof option !== "string"))
    ) {
      throw new Error(`Profile field ${field.name} options must be strings`);
    }
    if (
      field.phase !== undefined &&
      !["design", "automation", "execution"].includes(field.phase)
    ) {
      throw new Error(`Profile field ${field.name} has invalid phase`);
    }
  }
  if (!semantics.has(profile.business_key_semantic)) {
    throw new Error("Profile business key semantic is missing from fields");
  }
  if (
    !Array.isArray(profile.required_semantics ?? []) ||
    (profile.required_semantics ?? []).length > 0
  ) {
    throw new Error("Test-case profile business fields must remain optional");
  }
  if (
    !Array.isArray(profile.source_kinds) ||
    profile.source_kinds.some((kind) => typeof kind !== "string")
  ) {
    throw new Error("Profile source_kinds must be a string array");
  }
  if (!isObject(profile.defaults ?? {})) {
    throw new Error("Profile defaults must be an object");
  }
  for (const semantic of Object.keys(profile.defaults ?? {})) {
    if (!semantics.has(semantic)) {
      throw new Error(`Profile defaults references unknown semantic ${semantic}`);
    }
  }
  return profile;
}

function profileField(profile, semantic) {
  const field = profile.fields.find((candidate) => candidate.semantic === semantic);
  if (!field) {
    throw new Error(`Unknown test-case semantic ${JSON.stringify(semantic)}`);
  }
  return field;
}

function semanticFor(profile, value) {
  const bySemantic = profile.fields.find((field) => field.semantic === value);
  if (bySemantic) {
    return bySemantic.semantic;
  }
  const byName = profile.fields.find((field) => field.name === value);
  if (byName) {
    return byName.semantic;
  }
  throw new Error(`Unknown test-case field or semantic ${JSON.stringify(value)}`);
}

function normalizeOmissions(profile, values) {
  return new Set(values.map((value) => semanticFor(profile, value)));
}

function normalizeText(value, label, { numbered = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
      throw new Error(`${label} array items must be non-empty strings`);
    }
    return value
      .map((item, index) =>
        numbered ? `${index + 1}. ${item.trim()}` : `- ${item.trim()}`,
      )
      .join("\n");
  }
  throw new Error(`${label} must be a string or string array`);
}

function normalizeDatetime(value, label) {
  assertString(value, label);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    throw new Error(`${label} must use YYYY-MM-DD HH:mm:ss`);
  }
  const [, year, month, day, hour, minute, second] = match;
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
  const actual = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ];
  if (
    actual[0] !== Number(year) ||
    actual[1] !== month ||
    actual[2] !== day ||
    actual[3] !== hour ||
    actual[4] !== minute ||
    actual[5] !== second
  ) {
    throw new Error(`${label} must be a real date and time`);
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizeValue(profile, semantic, value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const field = profileField(profile, semantic);
  if (semantic === "steps") {
    return normalizeText(value, field.name, { numbered: true });
  }
  if (semantic === "expected") {
    return normalizeText(value, field.name);
  }
  if (field.type === "text") {
    return normalizeText(value, field.name);
  }
  if (field.type === "datetime") {
    return normalizeDatetime(value, field.name);
  }
  if (field.type === "select") {
    assertString(value, field.name);
    if (!(field.options ?? []).includes(value)) {
      throw new Error(
        `${field.name} must be one of ${JSON.stringify(field.options ?? [])}`,
      );
    }
    return value;
  }
  if (field.type === "user") {
    const users = Array.isArray(value) ? value : [value];
    if (
      users.length === 0 ||
      users.some(
        (user) =>
          !isObject(user) ||
          typeof user.id !== "string" ||
          !OPEN_ID_PATTERN.test(user.id),
      )
    ) {
      throw new Error(`${field.name} must contain valid Feishu open_id values`);
    }
    return users.map((user) => ({ id: user.id }));
  }
  throw new Error(`Unsupported field type ${field.type} for ${field.name}`);
}

function validatePlan(plan, profile) {
  if (!isObject(plan)) {
    throw new Error("Test-case plan must be an object");
  }
  if (!isObject(plan.source)) {
    throw new Error("Test-case plan source must be an object");
  }
  if (!profile.source_kinds.includes(plan.source.kind)) {
    throw new Error(
      `Plan source.kind must be one of ${JSON.stringify(profile.source_kinds)}`,
    );
  }
  if (plan.source.key !== undefined) {
    assertString(plan.source.key, "Plan source.key");
  }
  if (!Array.isArray(plan.cases) || plan.cases.length === 0) {
    throw new Error("Test-case plan cases must be a non-empty array");
  }
  if (plan.defaults !== undefined && !isObject(plan.defaults)) {
    throw new Error("Plan defaults must be an object");
  }
  if (plan.case_id_prefix !== undefined) {
    assertString(plan.case_id_prefix, "Plan case_id_prefix");
  }
  if (
    plan.omit !== undefined &&
    (!Array.isArray(plan.omit) ||
      plan.omit.some((value) => typeof value !== "string"))
  ) {
    throw new Error("Plan omit must be a string array");
  }

  const caseKeys = new Set();
  for (const [index, testCase] of plan.cases.entries()) {
    if (!isObject(testCase)) {
      throw new Error(`Plan cases[${index}] must be an object`);
    }
    const key = assertString(testCase.case_key, `Plan cases[${index}].case_key`);
    if (caseKeys.has(key)) {
      throw new Error(`Duplicate case_key ${JSON.stringify(key)}`);
    }
    caseKeys.add(key);
    if (testCase.fields !== undefined && !isObject(testCase.fields)) {
      throw new Error(`Plan cases[${index}].fields must be an object`);
    }
    for (const semantic of Object.keys(testCase.fields ?? {})) {
      profileField(profile, semantic);
    }
    if (testCase.case_id !== undefined) {
      assertString(testCase.case_id, `Plan cases[${index}].case_id`);
    }
    if (
      testCase.omit !== undefined &&
      (!Array.isArray(testCase.omit) ||
        testCase.omit.some((value) => typeof value !== "string"))
    ) {
      throw new Error(`Plan cases[${index}].omit must be a string array`);
    }
    for (const listName of ["generation_basis", "assumptions"]) {
      if (
        testCase[listName] !== undefined &&
        (!Array.isArray(testCase[listName]) ||
          testCase[listName].some((value) => typeof value !== "string"))
      ) {
        throw new Error(`Plan cases[${index}].${listName} must be strings`);
      }
    }
  }
  return plan;
}

function issueIidFrom(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value.match(/#(\d+)$/)?.[1] ?? null;
}

function generatedCaseId(plan, testCase, index) {
  if (testCase.fields?.case_id) {
    return testCase.fields.case_id;
  }
  if (testCase.case_id) {
    return testCase.case_id;
  }
  if (plan.case_id_prefix) {
    return `${plan.case_id_prefix}-${String(index + 1).padStart(3, "0")}`;
  }
  if (plan.source.kind === "bug") {
    const iid = issueIidFrom(plan.source.bug_id ?? plan.source.key);
    if (iid) {
      return `TC-BUG-${iid}-${String(index + 1).padStart(3, "0")}`;
    }
  }
  return null;
}

function sourceDefaults(source) {
  return {
    bug_id: source.bug_id,
    module: source.module,
    priority: source.priority,
    project_version: source.project_version,
    environment: source.environment,
    execution_role: source.execution_role,
  };
}

function validateBaseSchema(profile, response, activeSemantics) {
  if (!isObject(response) || response.ok === false) {
    return { ok: false, differences: ["Base field response is unavailable"] };
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
  for (const semantic of activeSemantics) {
    const expected = profileField(profile, semantic);
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
      const actualOptions = new Set(
        (actual.options ?? [])
          .map((option) => option?.name)
          .filter((name) => typeof name === "string"),
      );
      const missing = expected.options.filter((option) => !actualOptions.has(option));
      if (missing.length > 0) {
        differences.push(
          `${expected.name}: missing options ${JSON.stringify(missing)}`,
        );
      }
    }
  }
  return { ok: differences.length === 0, differences };
}

function buildPreview(options) {
  const profile = validateProfile(loadJson(options.profile ?? DEFAULT_PROFILE));
  const plan = validatePlan(loadJson(options.planJson), profile);
  const globalOmissions = normalizeOmissions(profile, [
    ...(plan.omit ?? []),
    ...(options.omit ?? []),
  ]);
  if (options.submitterOpenId && !OPEN_ID_PATTERN.test(options.submitterOpenId)) {
    throw new Error("--submitter-open-id must start with ou_");
  }
  if (options.submitterOpenId && !options.submitterName) {
    throw new Error("--submitter-name is required with --submitter-open-id");
  }
  if (options.submitterName && !options.submitterOpenId) {
    throw new Error("--submitter-open-id is required with --submitter-name");
  }

  const activeSemantics = new Set();
  const optionalIssues = [];
  const cases = plan.cases.map((testCase, index) => {
    const omissions = new Set([
      ...globalOmissions,
      ...normalizeOmissions(profile, testCase.omit ?? []),
    ]);
    const values = {
      ...(profile.defaults ?? {}),
      ...sourceDefaults(plan.source),
      ...(plan.defaults ?? {}),
      ...(options.submitterOpenId
        ? { submitter: [{ id: options.submitterOpenId }] }
        : {}),
      ...(testCase.fields ?? {}),
    };
    const caseId = generatedCaseId(plan, testCase, index);
    if (caseId) {
      values.case_id = caseId;
    }

    const semanticValues = new Map();
    for (const [semantic, value] of Object.entries(values)) {
      profileField(profile, semantic);
      if (omissions.has(semantic)) {
        continue;
      }
      const normalized = normalizeValue(profile, semantic, value);
      if (normalized !== null) {
        semanticValues.set(semantic, normalized);
        activeSemantics.add(semantic);
      }
    }
    const businessKey = semanticValues.get(profile.business_key_semantic) ?? null;
    if (!businessKey) {
      optionalIssues.push({
        case_key: testCase.case_key,
        field: profileField(profile, profile.business_key_semantic).name,
        reason: "用例编号为空，无法自动查重；确认后仅可创建",
      });
    }
    const fields = Object.fromEntries(
      [...semanticValues.entries()].map(([semantic, value]) => [
        profileField(profile, semantic).name,
        value,
      ]),
    );
    return {
      case_key: testCase.case_key,
      fields,
      generation_basis: testCase.generation_basis ?? [],
      assumptions: testCase.assumptions ?? [],
      omitted_fields: [...omissions].map((semantic) => ({
        semantic,
        field: profileField(profile, semantic).name,
      })),
      dedup_key: businessKey
        ? {
            field: profileField(profile, profile.business_key_semantic).name,
            value: businessKey,
          }
        : null,
      dedup_filter: businessKey
        ? {
            logic: "and",
            conditions: [
              [
                profileField(profile, profile.business_key_semantic).name,
                "==",
                businessKey,
              ],
            ],
          }
        : null,
    };
  });

  const caseIds = cases.map((item) => item.dedup_key?.value).filter(Boolean);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("Generated test-case IDs must be unique within one plan");
  }

  const schemaValidation = options.baseFieldsJson
    ? validateBaseSchema(
        profile,
        loadJson(options.baseFieldsJson),
        activeSemantics,
      )
    : { ok: false, differences: ["live Base fields were not provided"] };
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

  return {
    profile: {
      id: profile.profile_id,
      base_title: options.resolvedBaseTitle ?? null,
      table_name: profile.table_name,
    },
    source: plan.source,
    cases,
    optional_issues: optionalIssues,
    schema_validation: schemaValidation,
    target_validation: targetValidation,
    resolved_people: {
      submitter: options.submitterOpenId
        ? {
            open_id: options.submitterOpenId,
            name: options.submitterName,
            source: "lark-cli auth status or user command",
          }
        : null,
    },
    ready_for_confirmation: schemaValidation.ok && targetValidation.ok,
    candidate_only: true,
    write_authorized: false,
    automation: {
      materialized: false,
      executed: false,
      note: "当前阶段只登记自动化状态和已有脚本路径",
    },
  };
}

function writeOutputs(preview, outputDir) {
  assertString(outputDir, "--output-dir");
  const resolvedOutputDir = path.resolve(outputDir);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(tempRoot, resolvedOutputDir);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("--output-dir must be inside the operating-system temporary directory");
  }
  const outputDirExisted = fs.existsSync(resolvedOutputDir);
  if (outputDirExisted) {
    if (
      fs.lstatSync(resolvedOutputDir).isSymbolicLink() ||
      !fs.statSync(resolvedOutputDir).isDirectory() ||
      fs.readdirSync(resolvedOutputDir).length > 0
    ) {
      throw new Error("--output-dir must be a new or empty real directory");
    }
  } else {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }
  const realOutputDir = fs.realpathSync(resolvedOutputDir);
  const realRelative = path.relative(tempRoot, realOutputDir);
  if (
    realRelative === ".." ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    if (
      !outputDirExisted &&
      fs.existsSync(realOutputDir) &&
      fs.readdirSync(realOutputDir).length === 0
    ) {
      fs.rmdirSync(realOutputDir);
    }
    throw new Error(
      "--output-dir resolves outside the operating-system temporary directory",
    );
  }

  const paths = {
    preview: path.join(realOutputDir, "test-case-preview.json"),
  };
  const payloads = {};
  if (preview.ready_for_confirmation) {
    paths.candidates = path.join(
      realOutputDir,
      "candidate-test-cases.json",
    );
    paths.dedup_filters = path.join(
      realOutputDir,
      "test-case-dedup-filters.json",
    );
    payloads.candidates = preview.cases.map((item) => item.fields);
    payloads.dedup_filters = preview.cases.map((item) => ({
      case_key: item.case_key,
      filter: item.dedup_filter,
    }));
  }
  const previewWithPaths = { ...preview, output_files: paths };
  payloads.preview = previewWithPaths;
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
  node test-case-plan-to-records.mjs --plan-json <file> [options]

Options:
  --profile <file>
  --base-fields-json <file>
  --resolved-base-title <title>
  --resolved-table-name <name>
  --submitter-open-id <ou_xxx>
  --submitter-name <name>
  --omit <semantic-or-field-name> (repeatable)
  --output-dir <dir>
  --help`;
}

function parseArgs(argv) {
  const keyMap = {
    "--profile": "profile",
    "--plan-json": "planJson",
    "--base-fields-json": "baseFieldsJson",
    "--resolved-base-title": "resolvedBaseTitle",
    "--resolved-table-name": "resolvedTableName",
    "--submitter-open-id": "submitterOpenId",
    "--submitter-name": "submitterName",
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
  if (!options.help && !options.planJson) {
    throw new Error("--plan-json is required");
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
  parseArgs,
  validateBaseSchema,
  writeOutputs,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
