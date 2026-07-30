# Issue-Centered Handoff Templates

Use GitLab Issues as the live coordination record. One primary Issue carries the original outcome;
related Issues carry independently accountable workstreams.

## Contents

- Primary Issue template
- Related execution Issue template
- Creation and routing rules
- Writing rules

## Primary Issue template

```markdown
## TL;DR

<The outcome, why it matters, and who owns end-to-end acceptance in one or two sentences.>

## 协作者与责任上下文

| 维度 | 内容 |
| --- | --- |
| 发起人 | `@<gitlab-id>`（<real name>） |
| 发起人常设职责 | <from TEAM.md> |
| 当前工作上下文 | <role and outcome in this task> |
| 结果负责人 | `@<gitlab-id>` — <reason> |
| 协作者 / 评审人 | `@<id>`, `@<id>` |
| 判断依据 | <TEAM.md / explicit statement / Issue / manifest / code / history> |
| 置信度 | confirmed / inferred / unknown |

## 问题与用户价值

- 原始需求：
- 当前行为：
- 期望结果：
- 用户价值：
- 来源：bug / module update / platform gap / UX gap / integration / operations / other

## 可复现上下文

- 环境 / 分支 / 版本：
- 项目 / 来源 / 示例：
- UI 路径或命令：
- 日志 / 截图 / 产物：
- 最小复现步骤：

## 责任与协作形态

| 工作流 | 协作形态 | 负责人 | 协作者 / 评审人 | 判断依据 | 产物 |
| --- | --- | --- | --- | --- | --- |
| <workstream> | Lane A / B / C | `@<id>` | `@<id>` | <evidence> | Issue / MR / commit / deployment / doc |

## 关联工作

- [ ] #<iid> — <owner-specific outcome> — assignee: `@<id>`
- [ ] #<iid> — <owner-specific outcome> — assignee: `@<id>`

## 验收标准

- [ ] <mechanically checkable behavior>
- [ ] <validation command or production evidence>
- [ ] <end-to-end user journey>
- [ ] 结果负责人 `@<id>` 完成最终验收

## 长期知识产物

- 产物：none / contract / ADR / operating guide / integration guide / production evidence
- 目标读者：
- 仓库路径或链接：
- 持久化原因：

## 待确认

- <decision, identity mapping, dependency, or reviewer question>
```

## Related execution Issue template

```markdown
## TL;DR

<The owner-specific capability or result.>

## 责任上下文

- 主 Issue：#<iid>
- 负责人：`@<gitlab-id>`（assigned）
- 当前角色：
- 协作者 / 评审人：`@<id>`, `@<id>`
- 判断依据：
- 置信度：confirmed / inferred / unknown

## 能力缺口 / 当前行为

<Describe the problem, evidence, and the gap this owner can close.>

## 可复现上下文

- 相关代码 / 契约 / 数据：
- UI 路径或命令：
- 预期：
- 当前：
- 复现步骤：

## 验收标准

- [ ] <owner-specific acceptance>
- [ ] <validation>
- [ ] MR 关联并关闭本 Issue
- [ ] 主 Issue 的对应 checklist 已更新

## 依赖与范围

- 依赖：
- 影响面：
- 当前阶段范围：
- 评审责任：

## 长期知识产物

- none / <type and target path>
```

## Creation and routing rules

- Search for the original intent first and reuse the existing primary Issue.
- Assign the primary Issue to the end-to-end outcome owner.
- Create related Issues for independently accountable workstreams and assign each workstream owner.
- Mention contributors and reviewers using IDs resolved through `TEAM.md` and repository evidence.
- Place stable problem context, responsibility, and acceptance in the Issue body.
- Place progress, decisions, blockers, links, and handoff corrections in Issue comments.
- Place implementation decisions, code evidence, validation, and review in the MR.
- Close each execution Issue through its MR; close the primary Issue after end-to-end acceptance.
- Link durable repository documents from the Issue/MR and state their future audience.

## Writing rules

- Preserve the user's original intent and observable pain.
- Separate personal identity, standing responsibilities, current role, and target area.
- Explain responsibility with evidence and confidence.
- Ask the relevant human to correct inferred ownership.
- Describe the requested capability and acceptance at the receiver's altitude.
- Give the receiver the current evidence needed to choose an implementation.
- Keep one workstream per related execution Issue and one closing Issue per MR.
- Use existing repository labels and platform-supported Issue relationships.
- Keep secrets, tokens, credentials, and private operational data out of Issues, MRs, and comments.
