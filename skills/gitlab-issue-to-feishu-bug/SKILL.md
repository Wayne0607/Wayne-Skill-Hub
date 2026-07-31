---
name: gitlab-issue-to-feishu-bug
description: 将 GitLab Issue 登记到用户指定的飞书 Bug 表，并为 Bug、需求、模块、MR、版本或用户描述生成飞书测试用例候选。支持 Bug+用例、仅 Bug、仅用例、覆盖补齐、多模块识别与单选冲突提示、用户字段覆盖与留空、实时 Schema 校验、查重、预览和确认后写入。用户说“把 issue 登记到飞书”“同步 Bug 管理”“为这个 Bug 生成测试用例”“补测试用例”“创建独立测试用例”或提供 GitLab Issue URL 要求登记时使用。
---

# GitLab Issue 与飞书测试资产

把 GitLab Issue、需求说明、模块、MR、版本或用户描述转成用户本次指定飞书 Base 中的 Bug 和测试用例候选。

## 执行原则

1. 用户本次命令决定模式、目标链接、字段值、留空字段、用例数量和执行范围。
2. Skill 只为用户未指定的内容提供默认值。
3. 每个飞书业务字段均为可选；缺失、冲突或权限不足的字段保持为空，并在预览中说明。
4. 候选生成、Schema 校验和查重先于写入；每一批写入都需要用户明确确认。
5. 当前自动化范围是登记自动化状态与已有脚本路径。代码物化和执行属于后续阶段。

用户说“留空”“不填”“忽略”时加入 `omit`。用户明确给值时覆盖所有默认推导。

## 选择模式

- **仅 Bug**：用户只要求登记或同步 Issue。
- **Bug + 测试用例**：用户要求登记 Issue 并生成对应测试用例；用例的 `对应BugID` 默认引用该 Issue。
- **仅测试用例**：来源可以是 Bug、Issue、需求、模块、MR、版本或用户描述。独立用例的 `对应BugID` 保持为空。
- **覆盖补齐**：读取现有用例后，针对缺失的正向、边界、异常、权限、状态流转、数据一致性或回归场景生成候选。

用户未说明时，根据动词选择最小范围：“登记 Bug”走仅 Bug；“生成测试用例”走仅测试用例；“登记并生成用例”走 Bug + 测试用例。

## 必要输入

- 目标飞书 Base/Wiki URL：每次由用户提供；缺少时询问“请提供本次写入的飞书 Base 或 Wiki 链接。”
- 来源：GitLab Issue URL 或足以描述测试对象的需求、模块、MR、版本、页面、接口等上下文。

Bug 流程需要 GitLab Issue URL。独立测试用例无需关联 Issue。

## 渐进式路由

### Bug 候选

读取 [references/mapping.md](references/mapping.md) 了解字段映射；执行时读取 [references/workflow.md](references/workflow.md)。使用：

```text
scripts/issue-to-bug-record.mjs
references/tcode-bug-profile.json
```

### 测试用例候选

先读取 [references/test-case-generation.md](references/test-case-generation.md) 生成结构化计划；执行时读取 [references/test-case-workflow.md](references/test-case-workflow.md)。使用：

```text
scripts/test-case-plan-to-records.mjs
references/tcode-test-case-profile.json
```

## 统一预览与确认

预览至少展示：

- 目标 Base 与表；
- 模式、来源和候选数量；
- 每条 Bug/用例的编号、描述、关键字段、推导依据和假设；
- 用户覆盖、留空字段、Schema 差异与查重结果；
- 自动化状态与脚本路径仅作为登记信息。

只有 `ready_for_confirmation: true` 的候选可以请求确认。确认后立即再次查重；结果变化时重新预览。写后按返回的记录 ID 读回实际变更字段，并清理系统临时目录。

## 安全边界

- 用户确认前，输出保持 `candidate_only: true`、`write_authorized: false`。
- Token、Cookie、Base URL、人员 ID、表 ID 和记录 ID 只保留在当前进程或系统临时目录。
- 目标表与实际准备写入字段通过实时 Schema 校验。
- 测试用例候选器只产生预览、候选记录与查重过滤器。
