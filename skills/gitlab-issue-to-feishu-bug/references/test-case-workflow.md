# 测试用例执行工作流

本文件负责实时读取飞书表结构、生成候选、查重、确认和写后校验。确定测试内容前先读取 [test-case-generation.md](test-case-generation.md)。

以下示例使用 Windows PowerShell。Windows 调用 `lark-cli.cmd`，macOS/Linux 调用 `lark-cli`。

## 1. 准备临时目录

```powershell
$SkillRoot = "<本 Skill 根目录>"
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$LarkCli = (Get-Command lark-cli.cmd -ErrorAction Stop).Source
$RunRoot = Join-Path ([IO.Path]::GetTempPath()) (
  "gitlab-issue-to-feishu-test-case-" + [guid]::NewGuid().ToString("N")
)
[IO.Directory]::CreateDirectory($RunRoot) | Out-Null
```

所有中间文件放在 `$RunRoot`。Token 只保存在进程变量中。

## 2. 解析目标表和当前账号

每次使用用户本次提供的 `$FeishuUrl`：

```powershell
$Profile = Get-Content "$SkillRoot/references/tcode-test-case-profile.json" `
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
  throw "目标 Base 中必须且只能有一张精确匹配的测试用例表"
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

## 3. 生成结构化计划

依据来源与用户命令生成 `$RunRoot/test-case-plan.json`。计划遵循 [test-case-generation.md](test-case-generation.md)，并保留每条用例的 `generation_basis` 与 `assumptions`。

来源为 GitLab Issue 时，使用实时 Issue 内容：

```powershell
glab issue view $IssueUrl --output json |
  Set-Content -LiteralPath "$RunRoot/issue.json" -Encoding UTF8
```

来源为需求、模块、MR、版本或用户描述时，将可验证上下文直接整理到计划中。独立测试用例省略 `source.bug_id`。

## 4. 生成候选

```powershell
$Args = @(
  "--profile", "$SkillRoot/references/tcode-test-case-profile.json",
  "--plan-json", "$RunRoot/test-case-plan.json",
  "--base-fields-json", "$RunRoot/base-fields.json",
  "--resolved-base-title", $Resolved.data.title,
  "--resolved-table-name", $Table.name,
  "--output-dir", "$RunRoot/output"
)
if ($SubmitterOpenId -and $OmittedFields -notcontains "提交人") {
  $Args += @(
    "--submitter-open-id", $SubmitterOpenId,
    "--submitter-name", $SubmitterName
  )
}
foreach ($Field in $OmittedFields) {
  $Args += @("--omit", $Field)
}

& $Node "$SkillRoot/scripts/test-case-plan-to-records.mjs" @Args
```

输出：

- `preview.json`：模式、来源、字段、依据、假设、留空项、Schema 校验和安全状态；
- `candidate-test-cases.json`：准备写入的多条候选记录；
- `test-case-dedup-filters.json`：有编号候选的查重过滤器。

候选器只在系统临时目录写文件，没有飞书写入参数。

## 5. 查重

读取 `test-case-dedup-filters.json`，把每个非空 `filter` 单独保存为系统临时目录中的 JSON 文件，再逐项执行查询：

```powershell
$Filters = Get-Content "$RunRoot/output/test-case-dedup-filters.json" `
  -Raw -Encoding UTF8 | ConvertFrom-Json

Push-Location $RunRoot
try {
  for ($Index = 0; $Index -lt $Filters.Count; $Index++) {
    if ($null -eq $Filters[$Index].filter) { continue }
    $FilterPath = "dedup-$Index.json"
    $Filters[$Index].filter | ConvertTo-Json -Depth 10 |
      Set-Content -LiteralPath $FilterPath -Encoding UTF8
    $Dedup = & $LarkCli base +record-list --as user `
      --base-token $BaseToken --table-id $Table.id `
      --field-id "用例编号" `
      --filter-json "@$FilterPath" `
      --limit 10 --format json | Out-String | ConvertFrom-Json
    # 将结果与 $Filters[$Index].case_key 关联保存到预览。
  }
} finally {
  Pop-Location
}
```

- 0 条：候选创建；
- 1 条：展示现有记录与候选差异，由用户决定创建、更新或跳过；
- 多条：停止该编号写入并报告重复。

编号为空的候选跳过自动查重，预览说明重复风险。

覆盖补齐模式还要读取目标范围内的现有用例，按功能点和场景核对语义重复。

## 6. 预览与确认

向用户展示完整候选摘要。`ready_for_confirmation: true` 表示目标表和实际字段与实时 Schema 兼容。

用户确认后立即重复查重。查重状态或候选内容发生变化时重新预览并确认。

## 7. 写入

将用户确认的每条候选复制为独立 JSON 文件。创建调用：

```powershell
Push-Location $RunRoot
try {
  & $LarkCli base +record-upsert --as user `
    --base-token $BaseToken --table-id $Table.id `
    --json "@approved-test-case.json"
} finally {
  Pop-Location
}
```

更新需要携带唯一稳定的 `record_id`，并只提交用户确认的最小字段差异。

## 8. 写后校验与清理

按返回的记录 ID 读回实际变更字段，并按用例编号再次查重。发现重复时报告记录 ID，保留数据供用户处理。

最后清理：

```powershell
if (Test-Path $RunRoot) {
  [IO.Directory]::Delete($RunRoot, $true)
}
```
