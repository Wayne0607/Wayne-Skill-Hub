# 执行工作流

## 目录

1. 输入与临时目录
2. GitLab 数据
3. 飞书目标与账号
4. 生成预览
5. 查重、确认与写入
6. 写后校验与清理

以下示例使用 Windows PowerShell。Windows 必须调用 `lark-cli.cmd`；macOS/Linux 使用 `lark-cli`。

## 1. 输入与临时目录

必须有 `$IssueUrl` 和用户本次提供的 `$FeishuUrl`。缺少 `$FeishuUrl` 时询问用户并等待回复。飞书 URL 用于确定外部写入目标，不属于 Bug 记录字段。

```powershell
$SkillRoot = "<本 Skill 根目录>"
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$LarkCli = (Get-Command lark-cli.cmd -ErrorAction Stop).Source
$RunRoot = Join-Path ([IO.Path]::GetTempPath()) (
  "gitlab-issue-to-feishu-bug-" + [guid]::NewGuid().ToString("N")
)
[IO.Directory]::CreateDirectory($RunRoot) | Out-Null
```

所有临时文件放在 `$RunRoot`。Token 只保存在进程变量中。

## 2. GitLab 数据

```powershell
glab issue view $IssueUrl --output json |
  Set-Content -LiteralPath "$RunRoot/issue.json" -Encoding UTF8
$Issue = Get-Content "$RunRoot/issue.json" -Raw -Encoding UTF8 |
  ConvertFrom-Json
$IssueUri = [Uri]$Issue.web_url

glab api --hostname $IssueUri.Host `
  "projects/$($Issue.project_id)/issues/$($Issue.iid)/related_merge_requests" |
  Set-Content -LiteralPath "$RunRoot/related-mrs.json" -Encoding UTF8
```

映射器会核对 URL、IID、`references.full` 和关联 MR 的 host/project。

## 3. 飞书目标与账号

```powershell
$Profile = Get-Content "$SkillRoot/references/tcode-bug-profile.json" `
  -Raw -Encoding UTF8 | ConvertFrom-Json

$Resolved = & $LarkCli base +url-resolve --as user `
  --url $FeishuUrl --format json | Out-String | ConvertFrom-Json
$BaseToken = $Resolved.data.base_token

$Tables = & $LarkCli base +table-list --as user `
  --base-token $BaseToken --limit 100 --format json |
  Out-String | ConvertFrom-Json
$Matches = @($Tables.data.tables | Where-Object {
  $_.name -ceq $Profile.table_name
})
if ($Matches.Count -ne 1) {
  throw "目标 Base 中必须且只能有一张精确匹配的表"
}
$Table = $Matches[0]

& $LarkCli base +field-list --as user `
  --base-token $BaseToken --table-id $Table.id `
  --limit 200 --format json |
  Set-Content "$RunRoot/base-fields.json" -Encoding UTF8

$Auth = & $LarkCli auth status --json | Out-String | ConvertFrom-Json
$SubmitterOpenId = $Auth.identities.user.openId
$SubmitterName = $Auth.identities.user.userName
```

`提交人` 默认使用 `$SubmitterName` 对应的人员账号。API 写入值为 `$SubmitterOpenId`，预览显示名称。用户要求留空或指定其他提交人时遵循用户命令。

Issue 有 assignee 时，可以检查 `contact:user:search` 权限，再按姓名或企业邮箱搜索唯一飞书用户。无法唯一解析时让处理人字段保持为空。

## 4. 生成预览

用户命令优先于自动映射。把用户明确提供的值作为覆盖参数；把用户要求留空的字段作为 `--omit` 参数。字段缺失或推导冲突时保持为空，无需追问用户。

```powershell
$MapArgs = @(
  "--profile", "$SkillRoot/references/tcode-bug-profile.json",
  "--issue-json", "$RunRoot/issue.json",
  "--related-mrs-json", "$RunRoot/related-mrs.json",
  "--base-fields-json", "$RunRoot/base-fields.json",
  "--resolved-base-title", $Resolved.data.title,
  "--resolved-table-name", $Table.name,
  "--output-dir", "$RunRoot/output"
)
if ($SubmitterOpenId -and $OmittedFields -notcontains "提交人") {
  $MapArgs += @(
    "--submitter-open-id", $SubmitterOpenId,
    "--submitter-name", $SubmitterName
  )
}
if ($Status) { $MapArgs += @("--status", $Status) }
if ($Modules) { $MapArgs += @("--module", ($Modules -join ",")) }
if ($Priority) { $MapArgs += @("--priority", $Priority) }
if ($Severity) { $MapArgs += @("--severity", $Severity) }
if ($BugId) { $MapArgs += @("--bug-id", $BugId) }
if ($Description) { $MapArgs += @("--description", $Description) }
if ($IssueLink) { $MapArgs += @("--issue-url", $IssueLink) }
foreach ($Field in $OmittedFields) { $MapArgs += @("--omit", $Field) }
if ($HandlerOpenId) {
  $MapArgs += @("--handler-open-id", $HandlerOpenId, "--handler-name", $HandlerName)
}
if ($ProcessedAt) {
  $MapArgs += @("--processed-at", $ProcessedAt)
}
if ($PrUrl) {
  $MapArgs += @("--pr-url", $PrUrl)
}
& $Node "$SkillRoot/scripts/issue-to-bug-record.mjs" @MapArgs
```

只把用户命令或已解析的可用值加入参数。输出包括：

- `preview.json`，以及存在 BugID 时生成的 `dedup-filter.json`；
- 实际写入字段与实时 Schema 兼容时生成 `candidate-create-fields.json` 和 `candidate-update-fields.json`。

展示 Base 标题、表名、人员名称、用户覆盖、自动推导、留空字段、提示和 Schema 差异。业务字段提示不影响确认；目标或实际写入字段与实时 Schema 不兼容时，`ready_for_confirmation` 为 `false`。

## 5. 查重、确认与写入

存在 BugID 时执行查重。`lark-cli` 的 `@file` 必须位于当前目录内：

```powershell
Push-Location $RunRoot
try {
  $Dedup = & $LarkCli base +record-list --as user `
    --base-token $BaseToken --table-id $Table.id `
    --field-id "BugID(对应issue)" `
    --filter-json "@output/dedup-filter.json" `
    --limit 10 --format json | Out-String | ConvertFrom-Json
} finally {
  Pop-Location
}
```

- 0 条：候选创建。
- 1 条：候选更新；读取现有记录并保存唯一 `record_id`。
- 多条：停止并报告重复。

用户要求 BugID 留空时跳过自动查重，预览中说明重复风险，并将操作限制为创建新记录。

用户确认后立即重复查重。只允许 `0→0` 创建，或 `1→同一 record_id` 更新。其他变化都重新预览。

创建时复制已确认的创建候选为 `approved-create-fields.json`。更新时比较现有值，只生成用户确认过的最小 `approved-update-fields.json`。

```powershell
Push-Location $RunRoot
try {
  # 创建
  & $LarkCli base +record-upsert --as user `
    --base-token $BaseToken --table-id $Table.id `
    --json "@approved-create-fields.json"

  # 更新必须额外传入稳定的唯一记录 ID
  # & $LarkCli base +record-upsert --as user `
  #   --base-token $BaseToken --table-id $Table.id `
  #   --record-id "<record_id>" `
  #   --json "@approved-update-fields.json"
} finally {
  Pop-Location
}
```

## 6. 写后校验与清理

创建检查 `created: true`，更新检查 `updated: true`。按返回的记录 ID 读回全部实际变更字段，再按 BugID 查重；发现重复时报告，不自动删除。

无论成功、失败还是用户取消，最后清理：

```powershell
if (Test-Path $RunRoot) {
  [IO.Directory]::Delete($RunRoot, $true)
}
```
