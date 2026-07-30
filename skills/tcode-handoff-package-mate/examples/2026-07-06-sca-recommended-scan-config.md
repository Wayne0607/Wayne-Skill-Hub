# 示例：用 Issue 交接 SCA 推荐扫描配置

> 本文件展示身份预检、责任推理、主 Issue、关联 Issue、assign、@协作者和 MR 闭环。
> 其中 Issue 编号与链接为示意。真实协作从 GitLab 中查重并创建实际记录。

## 目录

- 场景与身份预检
- 责任图与协作形态
- 主 Issue
- 前端与平台关联 Issue
- 执行与关闭

## 场景

SCA 希望在扫描配置中增加依赖范围、开发依赖和依赖深度，并由模块声明推荐值与推荐原因。
这个结果涉及 SCA 扫描器、模块包声明、共享前端和平台契约。示例中的负责人 ID
在运行时从 `TEAM.md` 解析。

## 身份与责任预检

当前对话由 `@<sca-lead-id>` 发起。身份预检从 `TEAM.md` 得到其常设职责为 SCA 模块负责人。
本次工作上下文是提出并验收 SCA 推荐配置能力。

结合当前请求、团队登记和受影响代码，Mate 形成以下责任图：

| 工作流 | 负责人 | 当前角色 | 协作者 / 评审人 | 依据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| 端到端结果 | `@<sca-lead-id>` | 需求与验收负责人 | `@<frontend-lead-id>`, `@<platform-owner-id>` | 明确请求 + SCA 常设职责 | confirmed |
| SCA 扫描器与模块声明 | `@<sca-lead-id>` | SCA 交付负责人 | 模块评审人 | `TEAM.md` + 模块上下文 | confirmed |
| 共享扫描弹窗 | `@<frontend-lead-id>` | 前端交付负责人 | `@<sca-lead-id>` | `TEAM.md` + 共享前端上下文 | inferred，创建前确认 |
| 共享配置契约 | `@<platform-owner-id>` | 平台契约评审与交付 | `@<sca-lead-id>`, `@<frontend-lead-id>` | `TEAM.md` + 平台契约上下文 | inferred，创建前确认 |

这里的 `frontend/`、`modules/sca/` 和 `packages/platform-core/` 用于描述技术影响面与寻找
评审人。人员责任同时包含身份、常设职责、当前请求和人工确认。

## 协作形态

| 工作流 | 形态 | 原因 | 产物 |
| --- | --- | --- | --- |
| SCA 扫描器 | Lane A | SCA 业务仓库中的独立交付 | scanner commit / release |
| SCA 模块声明 | Lane B | `@<sca-lead-id>` 对本次模块交付负责 | TCode MR |
| 共享前端 | Lane C | 独立负责人、排期、评审与 MR | assigned related Issue + MR |
| 平台契约 | Lane C | 独立负责人、契约验收与 MR | assigned related Issue + MR |

## 主 Issue

主 Issue 负责端到端结果，assign `@<sca-lead-id>`，并在正文中 @
`@<frontend-lead-id>` 与 `@<platform-owner-id>`。

```markdown
## TL;DR

SCA 扫描配置需要表达推荐值与原因，并在共享扫描弹窗中通用展示。`@<sca-lead-id>` 负责
端到端验收；前端与平台工作通过关联 Issue 独立交付。

## 协作者与责任上下文

| 维度 | 内容 |
| --- | --- |
| 发起人 | `@<sca-lead-id>`（<from TEAM.md>） |
| 发起人常设职责 | SCA 模块负责人 |
| 当前工作上下文 | 提出并验收 SCA 推荐扫描配置 |
| 结果负责人 | `@<sca-lead-id>` — confirmed |
| 协作者 / 评审人 | `@<frontend-lead-id>`, `@<platform-owner-id>` |
| 判断依据 | TEAM.md、当前请求、模块声明、共享前端与平台契约代码 |

## 问题与用户价值

- 当前行为：SCA 模块声明缺少推荐元数据，共享扫描弹窗无法通用展示推荐原因。
- 期望结果：模块声明推荐值与原因；共享契约负责类型；前端通用渲染；`job.config`
  只提交用户选择的配置值。
- 用户价值：用户在发起 SCA 扫描时理解安全默认值及其原因。

## 关联工作

- [ ] #201 — SCA 声明并消费推荐扫描配置 — assignee: `@<sca-lead-id>`
- [ ] #202 — 共享扫描弹窗渲染推荐元数据 — assignee: `@<frontend-lead-id>`
- [ ] #203 — 共享配置契约表达推荐元数据 — assignee: `@<platform-owner-id>`

## 验收标准

- [ ] SCA 声明依赖范围、开发依赖和依赖深度，并提供推荐原因。
- [ ] 共享前端通过通用元数据展示推荐值与原因。
- [ ] 共享契约校验推荐元数据。
- [ ] `job.config` 只包含配置值。
- [ ] `@<sca-lead-id>` 完成一次真实 SCA 扫描的端到端验收。

## 长期知识产物

- 产物：module contract
- 目标读者：SCA worker 与 TCode 模块集成开发者
- 仓库路径：`modules/sca/CONTRACT.md`
- 持久化原因：后续生产者和消费者持续实现同一配置契约
```

## 前端关联 Issue

`#202` assign `@<frontend-lead-id>`，正文 @ `@<sca-lead-id>` 作为需求与验收协作者。

```markdown
## TL;DR

共享扫描弹窗读取模块配置声明中的推荐元数据，并通用展示推荐值与原因。

## 责任上下文

- 主 Issue：#200
- 负责人：`@<frontend-lead-id>`（创建前已确认）
- 当前角色：共享前端交付负责人
- 协作者 / 评审人：`@<sca-lead-id>`
- 判断依据：TEAM.md、共享弹窗代码、主 Issue 责任图
- 置信度：confirmed

## 能力缺口

共享扫描弹窗已经读取模块配置字段，当前类型和渲染缺少推荐值与推荐原因。

## 验收标准

- [ ] 通用字段或选项元数据驱动推荐展示。
- [ ] SCA 专属判断留在模块声明中。
- [ ] 提交 payload 只包含配置值。
- [ ] MR 关联并关闭本 Issue。
- [ ] 主 Issue #200 的对应 checklist 已更新。
```

## 平台关联 Issue

`#203` assign `@<platform-owner-id>`，正文 @ `@<sca-lead-id>` 和
`@<frontend-lead-id>`。

```markdown
## TL;DR

共享扫描配置契约表达推荐值与推荐原因，供模块声明和通用前端消费。

## 责任上下文

- 主 Issue：#200
- 负责人：`@<platform-owner-id>`（创建前已确认）
- 当前角色：平台契约交付与产品架构评审
- 协作者 / 评审人：`@<sca-lead-id>`, `@<frontend-lead-id>`
- 判断依据：TEAM.md、平台契约代码、主 Issue 责任图
- 置信度：confirmed

## 验收标准

- [ ] 配置字段或选项 schema 支持推荐元数据。
- [ ] 契约覆盖模块声明与前端消费需要。
- [ ] 测试覆盖合法和非法推荐元数据。
- [ ] MR 关联并关闭本 Issue。
- [ ] 主 Issue #200 的对应 checklist 已更新。
```

## 执行与关闭

1. `issue-creator` 创建主 Issue，再创建并关联 `#201`、`#202`、`#203`。
2. 每个关联 Issue 指派确认后的负责人，并 @需要上下文或评审的人。
3. 每位负责人使用 `issue-to-pr` 交付自己的 Issue；MR 正文关闭唯一对应 Issue。
4. 主 Issue checklist 随关联 Issue 与外部 SCA 产物完成而更新。
5. `@<sca-lead-id>` 完成真实扫描验收并关闭主 Issue。
6. `modules/sca/CONTRACT.md` 随实现 MR 更新，作为长期契约知识保留。
