---
name: issue-to-pr
description: 用于 issue 驱动开发中的 PR 处理闭环：当用户要求“根据 issue 做 PR”“处理 issue 编号列表”“issue 驱动开发”“分析父子 issue/关联 issue/近期 PR 后产出 PR”时触发。执行输入归一化、关系分析、意图审计、用户对齐、实现验证、提交、推送、Draft 创建与 Ready 状态切换。多 issue 默认逐个独立处理，一个 PR 默认只关闭一个 issue，PR 正文末尾必须包含唯一一条 Closes #<issue_number>。
---

# Issue-to-PR Workflow

将 issue 需求转化为可审查、可合并、可回归验证、且已经实际创建完成的 PR 交付闭环。
先理解真实意图，再实现与验证，最后提交代码、创建 PR，并向用户做交付简报。

> 正文命令以 GitHub (`gh`) 为例；GitLab 环境的等效命令（issue 查询、关系分析、`glab mr create`
> 等）见 [references/glab.md](references/glab.md)。本仓库为内网 GitLab。

## Core Rules (Non-negotiable)

1. 过时引导识别：issue 中出现具体实现建议时，默认视为可疑线索，必须基于当前代码和近期 PR 重新验证。
2. 关系优先：先分析父子 issue、关联 issue、近期 PR，再决定实现策略，避免重复或冲突改动。
3. 单 PR 单关闭：默认一个 issue 对应一个 PR；除非用户明确授权合并处理。
4. 证据化 PR：PR 中必须包含测试命令与结果摘要，不可仅写“已测试”。
5. 末尾关闭：PR 正文末尾必须包含 `Closes #<当前issue编号>`，且全文仅保留这一条关闭语句；其后只允许出现工具自动附加的署名行。
6. 默认完成态：除非用户明确要求“只分析 / 只实现不提 PR / 先别提交”，否则任务完成态必须是 PR 已成功创建，而不是停留在 PR 文案、待确认提交或待执行 `gh pr create`。
7. 草稿生命周期：PR/MR 默认以 Draft 创建；计划内实现、必要验证、提交范围与正文均完成，且不存在预期后续提交后，才切换为 Ready。Draft 阶段不请求人工审查。
8. 阻塞才暂停：只有在遇到真实阻塞（如鉴权失败、远端权限不足、必需信息缺失且无法合理推断）时，才允许停在创建 PR 之前；此时必须明确说明卡点与下一步。

## Default Scope and Strategy

- 用户输入多个 issue 编号时，默认逐个独立处理。
- 如果发现 issue 强耦合，先说明耦合原因，再向用户确认是否允许合并处理。
- 若未获授权，不合并 PR。

## Workflow (Follow in Order)

### Step 1. Normalize Input

1. 解析用户提供的 issue 编号列表，去重并标准化为 `#N`。
2. 识别每个 issue 的状态（open/closed）、优先级、标签。
3. 通过依赖关系和优先级排序，生成处理队列。
4. 明确当前轮只处理队列首个 issue，其他 issue 作为待处理项保留。

建议命令（按需）：

```bash
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
gh issue view <ISSUE_NUMBER> --repo "$OWNER/$REPO"
gh issue list --state open --repo "$OWNER/$REPO" --limit 200 --json number,title,labels
```

### Step 2. Gather Context

针对当前 issue 收集以下信息：

1. Issue 详情：标题、描述、验收标准、最近评论。
2. 关系信息：父 issue、子 issue、关联 issue、阻塞关系。
3. 近期/相关 PR：最近合并与进行中的 PR，重点关注是否覆盖相同模块或目标。
4. 本地状态：当前分支、未提交改动、与 issue 相关文件的当前行为。

建议命令（按需）：

```bash
gh issue view <ISSUE_NUMBER> --repo "$OWNER/$REPO" \
  --json number,title,body,state,labels,assignees,comments,projectItems
gh issue view <ISSUE_NUMBER> --repo "$OWNER/$REPO" --comments
gh pr list --repo "$OWNER/$REPO" --state all --limit 50 \
  --json number,title,state,mergedAt,closedAt,headRefName,baseRefName
git status --short
git log --oneline -20
```

### Step 3. Run Intent Audit

按 [issue-intent-audit.md](references/issue-intent-audit.md) 输出审计结果，至少包含：

1. 需求目标：用户真正要达成的结果。
2. 现状事实：从代码与 issue 证据确认的当前状态。
3. 过时引导：issue 中可能过时或次优的实现提示。
4. 风险点：技术风险、回归风险、依赖风险。
5. 待确认决策：高影响且无法从上下文推断的取舍。

### Step 4. Align with User

1. 仅对高影响分歧提问，不重复询问可从代码或上下文得到的事实。
2. 优先给出 2-4 个有明确权衡的选项，并给推荐项。
3. 锁定范围边界与验收标准后再开始实现。
4. 如果用户未回复且存在默认策略，采用推荐策略并明确记录假设。

### Step 5. Implement and Verify

1. 按已对齐范围完成实现，保持改动最小必要。
2. 探测仓库约定的验证命令并执行，记录结果摘要。探测顺序：CLAUDE.md / CONTRIBUTING → package.json scripts / Makefile / Cargo.toml / pyproject.toml → CI 配置（`.github/workflows/`、`.gitlab-ci.yml`）。例如 JS 仓库常见为：
   - `pnpm lint`
   - `pnpm test`
   - `pnpm exec tsc --noEmit`
3. 若某项无法执行，明确说明原因与影响范围。

### Step 6. Commit and Push

1. 确认当前分支策略符合仓库约定；若无约定，为每个 issue 从**最新默认分支**切出独立工作分支，命名格式 `<type>/<issue编号>-<slug>`（如 `fix/42-token-refresh-race`）。禁止在上一个 issue 的工作分支上直接开新分支，否则新 PR 会带入上一个 PR 的 commit。
2. 将本轮改动按可审查粒度提交，commit message 尽量遵循仓库约定。
3. 将分支推送到远端，确保后续 `gh pr create` 有可用 head branch。
4. 若工作区中存在与当前任务无关的改动，不要混入提交；必要时明确说明如何隔离。

### Step 7. Create PR

使用 [pr-body-template.md](references/pr-body-template.md) 组装 PR 内容并直接创建 PR，必须包含：

1. 变更摘要（聚焦问题与结果，不堆实现细节）。
2. 测试证据（命令 + 结果摘要）。
3. 风险与回滚思路（如有）。
4. 关联关系说明（Related to #N）。
5. 使用 Draft PR 作为默认创建选项，在 Draft 阶段继续提交改动、更新验证证据和完善正文。
6. 通过 `gh pr create --draft`（或仓库等效方式）实际创建 PR，不要只输出标题/正文草稿后结束。
7. 完成最终就绪检查：计划内实现已完成，必要验证结果已记录，提交范围与 PR 正文准确，且不存在预期后续提交。全部满足后执行 Ready 状态切换并开始请求人工审查；尚未满足时保持 Draft 并继续完成工作。

建议命令（按需）：

```bash
git fetch origin
git checkout -b <type>/<issue编号>-<slug> origin/<默认分支>
git add <files>
git commit -m "<type(scope): summary>"
git push -u origin <branch-name>
gh pr create --draft --base <base-branch> --head <branch-name> --title "<pr-title>" --body-file <body-file>

# 完成最终就绪检查后
gh pr ready <pr-number>
```

### Step 8. Enforce Closing Line

1. PR 正文末尾必须包含：`Closes #<当前issue编号>`；其后只允许出现工具自动附加的署名行。
2. 关闭语句仅保留一个，且仅对应当前 issue。
3. 若当前 issue 不应关闭，停止并向用户确认，不要提交错误关闭语句。

### Step 9. Report Back and Continue Queue

1. 向用户返回交付简报，而不是再次询问是否要开 PR。
2. 简报至少包含：PR 编号与链接、当前 Draft/Ready 状态、分支名、测试结果摘要、关键假设/取舍、剩余风险（如有）。
3. 如果用户不满意，再基于当前分支或同一 PR 继续迭代；不要把“是否创建 PR”作为默认待办留给用户补做。
4. 若 Step 1 的处理队列仍有未处理 issue，简报后立即回到 Step 2 处理下一个（必须重新从最新默认分支切分支），直到队列清空或用户叫停。不要在处理完首个 issue 后停下来等待指示。

## Output Checklist

- [ ] 已完成 issue 关系分析（父子/关联/近期 PR）。
- [ ] 已完成意图审计并处理过时引导。
- [ ] 已与用户对齐高影响决策。
- [ ] 已给出测试证据摘要。
- [ ] 工作分支从最新默认分支切出，未混入其他 issue 的 commit。
- [ ] 已完成提交并推送当前分支。
- [ ] 已实际创建 PR，而非仅输出 PR 草稿。
- [ ] PR 默认以 Draft 创建；计划内实现、必要验证、提交范围与正文完成后才切换为 Ready。
- [ ] PR 正文末尾为唯一 `Closes #<当前issue编号>`（工具署名行除外）。
- [ ] 处理队列已清空，或已明确记录剩余 issue 与原因。

## References

- [Issue Intent Audit](references/issue-intent-audit.md)
- [PR Body Template](references/pr-body-template.md)
