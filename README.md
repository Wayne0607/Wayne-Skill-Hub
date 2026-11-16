# Wayne Skill Hub

面向 Codex、Claude Code 等 AI 编程代理的可复用 Skill 集合。

## Skills

| Skill | 定位 |
| --- | --- |
| `tcode-handoff-package-mate` | 负责身份上下文、责任映射、主/关联 Issue 和端到端协作闭环 |
| `issue-creator` | 创建结构化 Issue，并支持父子任务或依赖拆分 |
| `issue-to-pr` | 将已确认的 Issue 实现为聚焦的 PR/MR |
| `ai-reviewer` | 对 PR/MR 发布可定位、可执行的代码评审意见 |
| `ai-review-resolver` | 处理 AI 评审意见、提交修复并关闭讨论 |
| `gitlab-issue-to-feishu-bug` | 将 GitLab Issue 映射到飞书 Bug 表，并生成 Bug 关联或独立测试用例 |
| `obelisk-agent-handoff` | 通过本机 Obelisk 为子智能体补齐决策上下文，并核查执行汇报中的遗漏 |

`tcode-handoff-package-mate` 是协作编排层，配合中间四个原子 Skill 完成 Issue、实现、评审和评审修复流程。每个原子 Skill 也可以单独安装使用。

`obelisk-agent-handoff` 负责主对话与子智能体之间的上下文交接。主智能体直接提供必要决策，子智能体按来源补查相关依据，主智能体在关键节点回查执行证据。它与 Issue/MR 协作流程可以配合使用。

## 安装

选择需要的目录，将整个 Skill 目录复制或链接到代理的 Skill 搜索路径：

- Codex：`$CODEX_HOME/skills/<skill-name>`
- Claude Code 项目：`.claude/skills/<skill-name>`

安装后重新打开任务，让代理重新发现 Skill。

## 运行条件

- Issue、PR/MR 类 Skill 需要当前仓库及已认证的 `gh` 或 `glab`。
- `tcode-handoff-package-mate` 默认从项目的 `TEAM.md` 获取身份和常设职责。
- `gitlab-issue-to-feishu-bug` 需要 Node.js、`glab`、`lark-cli`，并在写入前请求用户确认。当前测试用例自动化范围是登记状态与已有脚本路径。
- `obelisk-agent-handoff` 需要本机 `obelisk` CLI（兼容 0.3.1 查询 API）和 Node.js 22.13+。可配合已有 `obelisk` Skill 使用；自带脚本也能独立生成限定范围的检索查询。实时协调仍使用代理原生消息工具。

## 主子智能体上下文交接

```text
用 $obelisk-agent-handoff 给这个子智能体准备交接上下文：提供当前方案、已确认决策、
任务边界和验收条件，让它通过 Obelisk 补查相关依据，并在验收前核查子会话里的遗漏。
```

该 Skill 包含会话定位、上下文补充和增量核查三个查询模式，以及来源标识、截断提示和游标隔离。
用法和 JSON 请求见 [上下文协议](skills/obelisk-agent-handoff/references/context-protocol.md)，
完整交接结构见 [虚构示例](skills/obelisk-agent-handoff/examples/handoff.json)。真实对话、查询结果和检查点保留在本机，不提交到此仓库。

## 校验

飞书测试资产 Skill 自带两组 Node.js 测试：

```bash
node skills/gitlab-issue-to-feishu-bug/scripts/issue-to-bug-record.test.mjs
node skills/gitlab-issue-to-feishu-bug/scripts/test-case-plan-to-records.test.mjs
```

Obelisk 交接 Skill 的查询与边界测试（Node.js 22.13+，使用内置 SQLite）：

```bash
node --test skills/obelisk-agent-handoff/scripts/context-query.test.mjs
```

仓库中的测试数据使用示例域名和虚拟账号，不包含真实 Token、人员 ID 或飞书 Base 链接。
