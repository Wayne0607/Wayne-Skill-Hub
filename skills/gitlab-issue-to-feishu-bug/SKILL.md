---
name: gitlab-issue-to-feishu-bug
description: 将 GitLab Issue 登记为用户指定飞书多维表格中的 Bug 记录，支持用户优先的字段覆盖与留空、Issue 默认映射、多模块、预览、查重和确认后写入。用户说“把 issue 登记到飞书”“同步 Bug 管理”“将 GitLab bug 转成测试记录”或提供 GitLab Issue URL 要求登记时使用。
---

# GitLab Issue 转飞书 Bug

将 GitLab Issue 作为默认数据源，将用户本次指定的飞书 Base 作为目标。

## 优先级

1. 用户本次命令决定字段值、留空字段、目标链接和执行范围。
2. Skill 映射只在用户没有指定时提供默认值。
3. 每个飞书业务字段均为可选。无法推导、存在冲突或缺少权限时留空，并在预览中说明。
4. 仅当飞书 API 对实际写入字段存在类型或选项约束时，报告平台约束。

不要为了补全字段而强制用户回答。用户说“留空”“不填”“忽略”时，使用 `--omit`；用户明确给值时使用对应覆盖参数。

## 运行输入

- GitLab Issue URL：用于读取源 Issue。
- 飞书 Base/Wiki URL：用于确定本次写入目标。

缺少飞书 URL 时询问：“请提供本次写入的飞书 Base 或 Wiki 链接。”每次使用用户本次提供的链接。

## 默认映射

- 状态：Issue `opened → 未解决`，`closed → 已关闭`。
- 优先级：Issue 的 P0/P1/P2 标签。
- 严重程度：同名标签；缺少时按 `P0 → 致命`、`P1 → 严重`、`P2 → 一般`。
- bug模块：汇总标题 `[...]` 前缀与标签，写入全部可识别模块。
- 提交人：当前飞书账号名称对应的 `openId`。
- Bug描述、Issue 链接、BugID：Issue 标题、URL、完整引用。

默认值、字段名和模块别名见 [references/mapping.md](references/mapping.md)。仅在处理映射或 Schema 差异时读取。

## 执行

1. 读取 [references/workflow.md](references/workflow.md)，获取实时 GitLab、飞书账号、表和字段数据。
2. 将用户指定的覆盖项和留空项传给 `scripts/issue-to-bug-record.mjs`。
3. 展示目标 Base/表、写入字段、用户覆盖、自动推导、留空字段、提示和查重结果。
4. 在 `ready_for_confirmation: true` 时请求一次写入确认。
5. 确认后立即再次查重；结果变化时重新预览。
6. 创建时写入确认过的字段；更新时携带唯一 `record_id` 并只写确认过的最小差异。
7. 写后读回变更字段并清理临时目录。

## 安全边界

- 用户确认前仅生成候选数据。
- Token、Cookie、Base URL、人员 ID 和记录 ID 只保留在本次进程或系统临时目录。
- 写入目标和实际准备写入字段必须通过实时 Schema 校验。
- `candidate_only: true` 与 `write_authorized: false` 表示尚未获得写入授权。
