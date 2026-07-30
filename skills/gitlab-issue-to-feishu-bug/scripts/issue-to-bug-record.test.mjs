import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPreview,
  normalizeProcessedAt,
  parseArgs,
  shanghaiClosedDate,
  writeOutputs,
} from "./issue-to-bug-record.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(SCRIPT_DIR, "fixtures");
const PROFILE = path.resolve(SCRIPT_DIR, "..", "references", "tcode-bug-profile.json");
const ISSUE = path.join(FIXTURES, "issue-159.json");
const RELATED_MRS = path.join(FIXTURES, "related-mrs-159.json");
const BASE_FIELDS = path.join(FIXTURES, "tcode-base-fields.json");

function options(overrides = {}) {
  return {
    profile: PROFILE,
    issueJson: ISSUE,
    relatedMrsJson: RELATED_MRS,
    baseFieldsJson: BASE_FIELDS,
    resolvedBaseTitle: "用户本次提供的任意 Base",
    resolvedTableName: "TCode bug管理",
    ...overrides,
  };
}

function withJsonFixture(value, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gitlab-feishu-skill-"));
  const file = path.join(directory, "fixture.json");
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    return callback(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readIssue() {
  return JSON.parse(fs.readFileSync(ISSUE, "utf8"));
}

function mappedIssue(overrides = {}) {
  return {
    ...readIssue(),
    iid: 200,
    state: "opened",
    title: "[Platform/Audit] 多模块问题",
    web_url: "https://gitlab.example.com/acme/project/-/work_items/200",
    references: {
      short: "#200",
      full: "acme/project#200",
    },
    labels: ["frontend", "P1"],
    closed_at: null,
    assignees: [],
    ...overrides,
  };
}

function withMappedIssue(overrides, callback) {
  return withJsonFixture(mappedIssue(overrides), (issueJson) =>
    callback(
      options({
        issueJson,
        relatedMrsJson: undefined,
        submitterOpenId: "ou_12345678",
        submitterName: "测试账号",
      }),
    ),
  );
}

test("真实 #159 保留 Issue 状态、模块和缺失元数据", () => {
  const preview = buildPreview(options());

  assert.equal(preview.fields["BugID(对应issue)"], "acme/project#159");
  assert.equal(preview.fields["状态"], "已关闭");
  assert.deepEqual(preview.fields["bug模块"], ["Tcode前端"]);
  assert.equal(preview.fields["优先级"], undefined);
  assert.equal(preview.fields["严重程度"], undefined);
  assert.equal(preview.source.related_mrs.length, 2);
  assert.equal(preview.ready_for_confirmation, true);
  assert.equal(preview.resolution_needed.length, 0);

  const optional = new Set(
    preview.optional_issues.map((item) => item.field),
  );
  for (const field of [
    "提交人",
    "优先级",
    "严重程度",
    "处理时间",
    "处理人",
    "PR ID",
  ]) {
    assert.equal(optional.has(field), true, `missing ${field}`);
  }
});

test("状态、优先级和严重程度全部由 Issue 推导", () => {
  withMappedIssue({}, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);

    assert.equal(preview.ready_for_confirmation, true);
    assert.equal(preview.fields["状态"], "未解决");
    assert.equal(preview.fields["优先级"], "P1");
    assert.equal(preview.fields["严重程度"], "严重");
    assert.equal(preview.update_fields["状态"], undefined);
    assert.equal(preview.update_fields["优先级"], "P1");
    assert.equal(preview.update_fields["严重程度"], "严重");
  });
});

test("模块汇总标题前缀和标签并以多选数组输出", () => {
  withMappedIssue({}, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    assert.deepEqual(preview.fields["bug模块"], [
      "Tcode平台后端",
      "Tcode前端",
      "TcodeAudit",
    ]);
    assert.deepEqual(preview.update_fields["bug模块"], [
      "Tcode平台后端",
      "Tcode前端",
      "TcodeAudit",
    ]);
  });
});

test("提交人自动绑定当前飞书账号并在预览展示账号名称", () => {
  withMappedIssue({}, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    assert.deepEqual(preview.fields["提交人"], [{ id: "ou_12345678" }]);
    assert.deepEqual(preview.resolved_people.submitter, {
      open_id: "ou_12345678",
      name: "测试账号",
      source: "lark-cli auth status",
    });
  });

  assert.throws(
    () =>
      buildPreview(
        options({
          submitterOpenId: "ou_12345678",
        }),
      ),
    /--submitter-name is required/,
  );
  assert.throws(
    () =>
      buildPreview(
        options({
          submitterOpenId: "garbage",
          submitterName: "测试账号",
        }),
      ),
    /starting with 'ou_'/,
  );
});

test("严重程度冲突时留空但不阻断确认", () => {
  withMappedIssue({ labels: ["frontend", "P1", "轻微"] }, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    assert.equal(preview.fields["严重程度"], undefined);
    const conflict = preview.optional_issues.find(
      (item) => item.field === "严重程度",
    );
    assert.deepEqual(conflict.candidates, ["严重", "轻微"]);
    assert.equal(preview.ready_for_confirmation, true);
  });
});

test("缺失与冲突字段保持为空，用户命令可以覆盖默认映射", () => {
  withMappedIssue({ labels: ["frontend"] }, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    assert.equal(preview.fields["优先级"], undefined);
    assert.equal(preview.fields["严重程度"], undefined);
  });
  withMappedIssue({ labels: ["frontend", "P0", "P1"] }, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    assert.equal(preview.fields["优先级"], undefined);
    assert.equal(
      preview.optional_issues.some((item) => item.field === "优先级"),
      true,
    );
  });
  withMappedIssue({ labels: ["frontend", "P1"] }, (mappedOptions) => {
    const preview = buildPreview({
      ...mappedOptions,
      status: "修复中",
      priority: "P0",
      severity: "轻微",
      module: "TcodeSCA,TcodeAudit",
    });
    assert.equal(preview.fields["状态"], "修复中");
    assert.equal(preview.fields["优先级"], "P0");
    assert.equal(preview.fields["严重程度"], "轻微");
    assert.deepEqual(preview.fields["bug模块"], ["TcodeSCA", "TcodeAudit"]);
    assert.equal(preview.overrides.length, 5);
  });
});

test("所有业务字段都可以显式留空", () => {
  const omit = [
    "bug_id",
    "description",
    "issue_url",
    "status",
    "module",
    "priority",
    "severity",
    "submitter",
    "handler",
    "processed_at",
    "pr_url",
  ];
  withMappedIssue({}, (mappedOptions) => {
    const preview = buildPreview({
      ...mappedOptions,
      submitterOpenId: undefined,
      submitterName: undefined,
      omit,
    });
    assert.deepEqual(preview.fields, {});
    assert.equal(preview.dedup_key, null);
    assert.equal(preview.dedup_filter, null);
    assert.equal(preview.ready_for_confirmation, true);
    assert.equal(preview.omitted_fields.length, omit.length);
  });
});

test("飞书链接运行时解析，不绑定固定 Base 标题", () => {
  withMappedIssue({}, (mappedOptions) => {
    const a = buildPreview({
      ...mappedOptions,
      resolvedBaseTitle: "Base A",
    });
    const b = buildPreview({
      ...mappedOptions,
      resolvedBaseTitle: "Base B",
    });
    assert.equal(a.target_validation.ok, true);
    assert.equal(b.target_validation.ok, true);

    const missing = buildPreview({
      ...mappedOptions,
      resolvedBaseTitle: undefined,
    });
    assert.equal(missing.target_validation.ok, false);

    const wrongTable = buildPreview({
      ...mappedOptions,
      resolvedTableName: "其他表",
    });
    assert.equal(wrongTable.target_validation.ok, false);
  });
});

test("目标表的 bug模块 不是多选时阻断写入", () => {
  const response = JSON.parse(fs.readFileSync(BASE_FIELDS, "utf8"));
  response.data.fields.find((field) => field.name === "bug模块").multiple = false;

  withJsonFixture(response, (baseFieldsJson) => {
    withMappedIssue({}, (mappedOptions) => {
      const preview = buildPreview({ ...mappedOptions, baseFieldsJson });
      assert.equal(preview.schema_validation.ok, false);
      assert.equal(preview.ready_for_confirmation, false);
      assert.match(
        preview.schema_validation.differences.join("\n"),
        /bug模块: multiple false != true/,
      );
    });
  });
});

test("关闭 Issue 自动映射已关闭并进入更新候选", () => {
  withMappedIssue(
    {
      state: "closed",
      closed_at: "2026-07-29T04:00:00Z",
      labels: ["frontend", "P0"],
    },
    (mappedOptions) => {
      const preview = buildPreview({
        ...mappedOptions,
        processedAt: "2026-07-29",
      });
      assert.equal(preview.fields["状态"], "已关闭");
      assert.equal(preview.update_fields["状态"], "已关闭");
      assert.equal(preview.fields["严重程度"], "致命");
    },
  );
});

test("Issue URL、IID、引用和 expected-project 必须一致", () => {
  const issue = mappedIssue();
  issue.references.full = "other/project#7";
  assert.throws(
    () =>
      withJsonFixture(issue, (issueJson) =>
        buildPreview(options({ issueJson })),
      ),
    /references\.full does not match/,
  );

  issue.references.full = "acme/project#200";
  assert.throws(
    () =>
      withJsonFixture(issue, (issueJson) =>
        buildPreview(
          options({
            issueJson,
            expectedProject: "other/project",
          }),
        ),
      ),
    /does not match expected project/,
  );
});

test("用户显式指定的合法 PR URL 优先于关联 MR 推导", () => {
  const external = buildPreview(
    options({
      prUrl: "https://example.com/other/repo/-/merge_requests/163",
    }),
  );
  assert.equal(
    external.fields["PR ID"],
    "[https://example.com/other/repo/-/merge_requests/163](https://example.com/other/repo/-/merge_requests/163)",
  );

  const unlinked = buildPreview(
    options({
      prUrl: "https://gitlab.example.com/acme/project/-/merge_requests/999",
    }),
  );
  assert.equal(
    unlinked.fields["PR ID"],
    "[https://gitlab.example.com/acme/project/-/merge_requests/999](https://gitlab.example.com/acme/project/-/merge_requests/999)",
  );
});

test("profile 不含必填业务语义并校验模块多选与映射", () => {
  const original = JSON.parse(fs.readFileSync(PROFILE, "utf8"));
  assert.deepEqual(original.required_semantics, []);

  const singleModule = structuredClone(original);
  singleModule.fields.find((field) => field.semantic === "module").multiple = false;
  withJsonFixture(singleModule, (profilePath) => {
    assert.throws(
      () => buildPreview(options({ profile: profilePath })),
      /module field must be a multiple select/,
    );
  });

  const badSeverity = structuredClone(original);
  badSeverity.severity_by_priority.P1 = "不存在";
  withJsonFixture(badSeverity, (profilePath) => {
    assert.throws(
      () => buildPreview(options({ profile: profilePath })),
      /severity_by_priority\.P1/,
    );
  });
});

test("只有完整预览才生成候选写入文件", () => {
  withMappedIssue({}, (mappedOptions) => {
    const preview = buildPreview(mappedOptions);
    const directory = path.join(
      os.tmpdir(),
      `飞书 Skill ${Date.now()} ${Math.random().toString(16).slice(2)}`,
    );
    try {
      const result = writeOutputs(preview, directory);
      assert.equal(fs.existsSync(result.output_files.fields), true);
      assert.equal(fs.existsSync(result.output_files.update_fields), true);
      assert.equal(
        JSON.parse(fs.readFileSync(result.output_files.preview, "utf8"))
          .write_authorized,
        false,
      );
      assert.throws(
        () => writeOutputs(preview, directory),
        /must be new or empty/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  const unresolved = buildPreview(options({ resolvedBaseTitle: undefined }));
  const directory = path.join(
    os.tmpdir(),
    `gitlab-feishu-unresolved-${Date.now()}`,
  );
  try {
    const result = writeOutputs(unresolved, directory);
    assert.equal(result.output_files.fields, undefined);
    assert.deepEqual(
      fs.readdirSync(directory).sort(),
      ["dedup-filter.json", "preview.json"],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("输出目录限制在系统临时目录", () => {
  const preview = buildPreview(options());
  const outside = path.join(
    path.dirname(os.tmpdir()),
    `gitlab-feishu-outside-${Date.now()}`,
  );
  assert.throws(
    () => writeOutputs(preview, outside),
    /must be inside the operating-system temporary directory/,
  );
  assert.equal(fs.existsSync(outside), false);
});

test("日期转换和 CLI 参数解析保持严格", () => {
  assert.equal(
    shanghaiClosedDate("2026-07-23T20:30:00Z"),
    "2026-07-24 00:00:00",
  );
  assert.equal(normalizeProcessedAt("2026-07-29"), "2026-07-29 00:00:00");
  assert.throws(() => normalizeProcessedAt("2026-02-30"), /real date/);
  assert.deepEqual(
    parseArgs([
      "--issue-json",
      "issue.json",
      "--submitter-name",
      "测试账号",
      "--status",
      "修复中",
      "--omit",
      "严重程度",
      "--omit",
      "处理人",
    ]),
    {
      issueJson: "issue.json",
      submitterName: "测试账号",
      status: "修复中",
      omit: ["严重程度", "处理人"],
    },
  );
  assert.throws(() => parseArgs([]), /--issue-json is required/);
});
