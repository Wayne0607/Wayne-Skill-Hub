import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPreview,
  parseArgs,
  validateBaseSchema,
  writeOutputs,
} from "./test-case-plan-to-records.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(SCRIPT_DIR, "fixtures");
const PROFILE = path.resolve(
  SCRIPT_DIR,
  "..",
  "references",
  "tcode-test-case-profile.json",
);
const BASE_FIELDS = path.join(FIXTURES, "tcode-test-case-fields.json");
const BUG_PLAN = path.join(FIXTURES, "bug-linked-test-case-plan.json");
const STANDALONE_PLAN = path.join(
  FIXTURES,
  "standalone-test-case-plan.json",
);

function options(planJson = BUG_PLAN, overrides = {}) {
  return {
    profile: PROFILE,
    planJson,
    baseFieldsJson: BASE_FIELDS,
    resolvedBaseTitle: "用户本次指定的 Base",
    resolvedTableName: "TCode 测试用例文档",
    ...overrides,
  };
}

function withJson(value, callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "test-case-plan-fixture-"),
  );
  const file = path.join(directory, "fixture.json");
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    return callback(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("Bug 来源生成多条关联用例并继承默认字段", () => {
  const preview = buildPreview(
    options(BUG_PLAN, {
      submitterOpenId: "ou_12345678",
      submitterName: "测试账号",
    }),
  );
  assert.equal(preview.ready_for_confirmation, true);
  assert.equal(preview.cases.length, 2);
  assert.equal(preview.cases[0].fields["用例编号"], "TC-BUG-159-001");
  assert.equal(preview.cases[1].fields["用例编号"], "TC-BUG-159-002");
  assert.equal(preview.cases[0].fields["对应BugID"], "acme/project#159");
  assert.equal(preview.cases[0].fields["所属模块"], "Tcode前端");
  assert.equal(preview.cases[0].fields["优先级"], "P1");
  assert.equal(preview.cases[0].fields["状态"], "待开始");
  assert.equal(preview.cases[0].fields["人工审核状态"], "待审核");
  assert.deepEqual(preview.cases[0].fields["提交人"], [
    { id: "ou_12345678" },
  ]);
});

test("独立测试用例不填写对应 BugID", () => {
  const preview = buildPreview(options(STANDALONE_PLAN));
  assert.equal(preview.ready_for_confirmation, true);
  assert.equal(preview.cases[0].fields["用例编号"], "TC-AUTH-LOGIN-001");
  assert.equal(preview.cases[0].fields["对应BugID"], undefined);
  assert.equal(preview.cases[0].fields["所属模块"], "身份认证");
});

test("步骤与期望结果数组转换为可读文本", () => {
  const preview = buildPreview(options(BUG_PLAN));
  assert.equal(
    preview.cases[0].fields["测试步骤"],
    "1. 进入项目详情页\n2. 查看版本标签\n3. 将鼠标移到截断文本上",
  );
  assert.equal(
    preview.cases[0].fields["期望结果"],
    "- 版本号显示省略号\n- 悬停后展示完整版本号\n- 相邻布局不被撑开",
  );
});

test("具体用例字段优先于计划默认值和来源默认值", () => {
  const plan = readJson(BUG_PLAN);
  plan.defaults.priority = "P2";
  plan.cases[0].fields.priority = "P0";
  withJson(plan, (planJson) => {
    const preview = buildPreview(options(planJson));
    assert.equal(preview.cases[0].fields["优先级"], "P0");
    assert.equal(preview.cases[1].fields["优先级"], "P2");
  });
});

test("用户可以按字段名或语义留空", () => {
  const plan = readJson(BUG_PLAN);
  plan.omit = ["对应BugID"];
  plan.cases[0].omit = ["priority", "提交人"];
  withJson(plan, (planJson) => {
    const preview = buildPreview(
      options(planJson, {
        submitterOpenId: "ou_12345678",
        submitterName: "测试账号",
      }),
    );
    assert.equal(preview.cases[0].fields["对应BugID"], undefined);
    assert.equal(preview.cases[1].fields["对应BugID"], undefined);
    assert.equal(preview.cases[0].fields["优先级"], undefined);
    assert.equal(preview.cases[1].fields["优先级"], "P1");
    assert.equal(preview.cases[0].fields["提交人"], undefined);
    assert.deepEqual(preview.cases[1].fields["提交人"], [
      { id: "ou_12345678" },
    ]);
  });
});

test("所有飞书业务字段均可留空", () => {
  const profile = readJson(PROFILE);
  const plan = {
    source: { kind: "manual" },
    omit: profile.fields.map((field) => field.semantic),
    cases: [{ case_key: "empty-candidate" }],
  };
  withJson(plan, (planJson) => {
    const preview = buildPreview(options(planJson));
    assert.deepEqual(preview.cases[0].fields, {});
    assert.equal(preview.cases[0].dedup_filter, null);
    assert.equal(preview.ready_for_confirmation, true);
  });
});

test("非法单选值和重复 case_key 被拒绝", () => {
  const invalid = readJson(STANDALONE_PLAN);
  invalid.cases[0].fields.priority = "P9";
  assert.throws(
    () => withJson(invalid, (planJson) => buildPreview(options(planJson))),
    /优先级 must be one of/,
  );

  const duplicate = readJson(STANDALONE_PLAN);
  duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(
    () => withJson(duplicate, (planJson) => buildPreview(options(planJson))),
    /Duplicate case_key/,
  );
});

test("重复用例编号在同批候选中被拒绝", () => {
  const plan = readJson(BUG_PLAN);
  plan.cases[0].fields.case_id = "TC-DUPLICATE-001";
  plan.cases[1].fields.case_id = "TC-DUPLICATE-001";
  assert.throws(
    () => withJson(plan, (planJson) => buildPreview(options(planJson))),
    /IDs must be unique/,
  );
});

test("实时 Schema 仅校验实际准备写入的字段", () => {
  const response = readJson(BASE_FIELDS);
  response.data.fields = response.data.fields.filter(
    (field) => field.name !== "截图或视频",
  );
  withJson(response, (baseFieldsJson) => {
    const preview = buildPreview(options(BUG_PLAN, { baseFieldsJson }));
    assert.equal(preview.schema_validation.ok, true);
  });

  const missingActive = readJson(BASE_FIELDS);
  missingActive.data.fields = missingActive.data.fields.filter(
    (field) => field.name !== "用例描述(功能点)",
  );
  withJson(missingActive, (baseFieldsJson) => {
    const preview = buildPreview(options(BUG_PLAN, { baseFieldsJson }));
    assert.equal(preview.schema_validation.ok, false);
    assert.match(
      preview.schema_validation.differences.join("\n"),
      /用例描述/,
    );
  });
});

test("Profile 选项只要求实时表包含所需子集", () => {
  const profile = readJson(PROFILE);
  const response = readJson(BASE_FIELDS);
  const active = new Set(["priority"]);
  const result = validateBaseSchema(profile, response, active);
  assert.equal(result.ok, true);
});

test("目标表不匹配时不生成可确认候选", () => {
  const preview = buildPreview(
    options(BUG_PLAN, { resolvedTableName: "TCode bug管理" }),
  );
  assert.equal(preview.ready_for_confirmation, false);
  assert.equal(preview.target_validation.ok, false);
});

test("自动化字段只登记状态与路径，不创建或执行代码", () => {
  const plan = readJson(STANDALONE_PLAN);
  plan.cases[0].fields.automation_status = "待实现";
  plan.cases[0].fields.automation_script_path =
    "specs/tcode/auth/login.spec.ts";
  withJson(plan, (planJson) => {
    const preview = buildPreview(options(planJson));
    assert.equal(preview.automation.materialized, false);
    assert.equal(preview.automation.executed, false);
    assert.equal(
      preview.cases[0].fields["用例自动化执行脚本路径"],
      "specs/tcode/auth/login.spec.ts",
    );
  });
});

test("日期字段只接受飞书记录写入支持的真实时间", () => {
  const plan = readJson(STANDALONE_PLAN);
  plan.cases[0].fields.created_at = "2026-07-30 09:15:00";
  withJson(plan, (planJson) => {
    const preview = buildPreview(options(planJson));
    assert.equal(
      preview.cases[0].fields["创建时间"],
      "2026-07-30 09:15:00",
    );
  });

  plan.cases[0].fields.created_at = "2026-02-30 09:15:00";
  assert.throws(
    () => withJson(plan, (planJson) => buildPreview(options(planJson))),
    /must be a real date and time/,
  );
});

test("就绪预览在系统临时目录生成候选与查重文件", () => {
  const preview = buildPreview(options(BUG_PLAN));
  const directory = path.join(
    os.tmpdir(),
    `test-case-output-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    const output = writeOutputs(preview, directory);
    assert.equal(fs.existsSync(output.output_files.preview), true);
    assert.equal(fs.existsSync(output.output_files.candidates), true);
    assert.equal(fs.existsSync(output.output_files.dedup_filters), true);
    const candidates = readJson(output.output_files.candidates);
    assert.equal(candidates.length, 2);
    assert.equal(preview.write_authorized, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("非临时目录输出被拒绝", () => {
  const outside = path.join(
    path.dirname(os.tmpdir()),
    `test-case-output-outside-${Date.now()}`,
  );
  assert.throws(
    () => writeOutputs(buildPreview(options(BUG_PLAN)), outside),
    /inside the operating-system temporary directory/,
  );
});

test("临时目录中的链接不能把输出引到临时目录外", (context) => {
  const outside = fs.mkdtempSync(
    path.join(path.dirname(os.tmpdir()), "test-case-output-real-"),
  );
  const link = path.join(
    os.tmpdir(),
    `test-case-output-link-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`symbolic-link capability unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () =>
        writeOutputs(
          buildPreview(options(BUG_PLAN)),
          path.join(link, "escaped-output"),
        ),
      /resolves outside the operating-system temporary directory/,
    );
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("CLI 参数保持严格", () => {
  assert.deepEqual(
    parseArgs([
      "--plan-json",
      "plan.json",
      "--omit",
      "实际结果",
      "--omit",
      "截图或视频",
    ]),
    {
      planJson: "plan.json",
      omit: ["实际结果", "截图或视频"],
    },
  );
  assert.throws(() => parseArgs([]), /--plan-json is required/);
  assert.throws(
    () =>
      buildPreview(
        options(BUG_PLAN, {
          submitterName: "缺少 open_id 的账号",
        }),
      ),
    /--submitter-open-id is required/,
  );
  assert.throws(
    () => parseArgs(["--plan-json", "plan.json", "--write"]),
    /Unknown argument/,
  );
});
