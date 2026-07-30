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
| `gitlab-issue-to-feishu-bug` | 将 GitLab Issue 映射到用户指定的飞书 Bug 管理表 |

`tcode-handoff-package-mate` 是协作编排层，配合中间四个原子 Skill 完成 Issue、实现、评审和评审修复流程。每个原子 Skill 也可以单独安装使用。

## 安装

选择需要的目录，将整个 Skill 目录复制或链接到代理的 Skill 搜索路径：

- Codex：`$CODEX_HOME/skills/<skill-name>`
- Claude Code 项目：`.claude/skills/<skill-name>`

安装后重新打开任务，让代理重新发现 Skill。

## 运行条件

- Issue、PR/MR 类 Skill 需要当前仓库及已认证的 `gh` 或 `glab`。
- `tcode-handoff-package-mate` 默认从项目的 `TEAM.md` 获取身份和常设职责。
- `gitlab-issue-to-feishu-bug` 需要 Node.js、`glab`、`lark-cli`，并在写入前请求用户确认。

## 校验

飞书 Bug Skill 自带 Node.js 测试：

```bash
node skills/gitlab-issue-to-feishu-bug/scripts/issue-to-bug-record.test.mjs
```

仓库中的测试数据使用示例域名和虚拟账号，不包含真实 Token、人员 ID 或飞书 Base 链接。
