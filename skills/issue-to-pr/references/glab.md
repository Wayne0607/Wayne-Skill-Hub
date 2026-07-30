# GitLab (glab) 命令参考

SKILL.md 正文的命令以 GitHub (`gh`) 为例；本文件是 GitLab 环境的等效命令。`glab api` 的 `:id`
占位符会自动替换为当前项目。GitLab 的 Merge Request 对应 GitHub 的 Pull Request（本文用 MR）。

## 归一化输入 / 收集上下文（对应 Step 1–2）

```bash
glab repo view --output json
glab issue view <ISSUE_IID> --output json | jq '{iid, title, state, labels}'
glab issue list --state opened --output json | jq '[.[] | {iid, title, labels}]'

# issue 详情、评论、关联（GitLab 用 issue links 表达父子/依赖）
glab issue view <ISSUE_IID> --output json | jq '{iid, title, description, state, labels, assignees}'
glab issue view <ISSUE_IID> --comments
glab api "projects/:id/issues/<ISSUE_IID>/links" | jq '[.[] | {iid, title, state, link_type}]'

# 近期/相关 MR（关系优先，避免重复或冲突改动）
glab mr list --state all --per-page 50 --output json \
  | jq '[.[] | {iid, title, state, source_branch, target_branch, merged_at}]'
git status --short
git log --oneline -20
```

## 分支 / 提交 / 推送 / 创建 MR（对应 Step 6–7）

```bash
git fetch origin
git switch -c <type>/<iid>-<slug> origin/<目标分支>   # 从最新目标分支切独立分支，如 fix/42-token-refresh-race
git add <files>
git commit -m "<type(scope): 摘要>"
git push -u origin <源分支>

glab mr create \
  --draft \
  --source-branch <源分支> \
  --target-branch <目标分支> \
  --title "[Area] 结果导向标题" \
  --description "$(cat <<'MR_EOF'
[MR 正文，末尾唯一一条 Closes #<iid>]
MR_EOF
)"

# 计划内实现、必要验证、提交范围与正文均完成，且不存在预期后续提交后
glab mr update <mr-iid> --ready
```

要点：
- 同时给 `--title` 与 `--description` 可跳过交互式编辑器；也可用 `glab mr create --fill` 从 commit 自动填标题/正文。
- 默认使用 `--draft` 创建 MR；Draft 阶段继续提交改动、更新验证证据和完善正文，不请求人工审查。
- 完成最终就绪检查后执行 `glab mr update <mr-iid> --ready`，再请求人工审查。
- `glab mr create` 返回新 MR 的 URL，末尾数字即 MR iid。
- 分支命名 `<type>/<iid>-<slug>`；禁止在上一个 issue 的工作分支上直接开新分支，否则新 MR 会带入上一个 MR 的 commit。

## 关闭语义

MR 正文里的 `Closes #<iid>`（或 `Fixes` / `Resolves`）在 **MR 合并时**自动关闭对应 issue，与 GitHub
一致。全文仅保留一条关闭语句、且对应当前 issue；仅关联不关闭时用 `Related to #N`。
