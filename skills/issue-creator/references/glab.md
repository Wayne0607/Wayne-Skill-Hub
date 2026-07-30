# GitLab (glab) 命令参考

GitHub 环境用 SKILL.md 正文中的 `gh` 命令；本文件是 GitLab 环境的等效命令。`glab api` 的 `:id` 占位符会自动替换为当前项目。

## 上下文收集（对应 Step 1）

```bash
glab issue list --output json | jq '[.[] | {iid, title, labels}]'
glab label list
```

## 查重（对应 Step 1.5）

GitLab 的 issues API 支持 `search` 参数（检索标题和描述，默认覆盖 open + closed）：

```bash
glab api "projects/:id/issues" -X GET -f search="<核心关键词>" \
  | jq '[.[] | {iid, title, state, web_url}]'

# 获取疑似重复 issue 的正文
glab issue view <iid>
```

## 创建 Issue（对应 Step 6）

```bash
glab issue create \
  --title "Issue 标题" \
  --label "enhancement" \
  --description "$(cat <<'ISSUE_EOF'
[Issue body]
ISSUE_EOF
)"
```

## 父子关联（对应 Step 6 的 sub-issue 关联）

GitLab 没有 GitHub 式 sub-issue（层级化 work item 属于较新版本/付费功能，不依赖它）。用两个机制组合表达父子关系：

**1. Issue links 表达关联**（从子 issue 视角指向父 issue）：

```bash
glab api "projects/:id/issues/<child_iid>/links" -X POST \
  -f target_project_id="<project_id>" \
  -f target_issue_iid="<parent_iid>" \
  -f link_type="relates_to"
```

`relates_to` 在所有版本可用。`blocks` 与 `is_blocked_by` 属于 Premium/Ultimate；在 CE 实例上
传它们会返回 `HTTP 400: link_type does not have a valid value`。用
`glab api metadata | jq .enterprise` 判断实例版本，或直接用 `relates_to` 并在父 issue 的任务
清单里表达依赖顺序。

**2. 父 issue 正文维护任务清单**（GitLab 会自动渲染进度）：

```markdown
## Sub-issues 总览

- [ ] #12 [子任务 1]
- [ ] #13 [子任务 2]
- [ ] #14 [子任务 3]（依赖 #12）
```
