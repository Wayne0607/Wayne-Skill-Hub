# 测试用例生成规则

本文件指导 Agent 把来源上下文整理成结构化测试用例计划。确定测试范围和编写 `test-case-plan.json` 时读取。

## 1. 来源与模式

`source.kind` 支持：

| 值 | 典型来源 |
| --- | --- |
| `bug` | 已登记或准备登记的 Bug |
| `issue` | 非 Bug 类型的 GitLab Issue |
| `requirement` | 产品需求、验收标准、飞书说明 |
| `module` | 一个功能模块或页面 |
| `mr` | Merge Request 的行为变更 |
| `release` | 版本发布与回归范围 |
| `manual` | 用户直接描述的测试目标 |

Bug 来源可在 `source.bug_id` 中写入 GitLab 完整引用，例如 `group/project#159`。其他来源仅在用户明确给出 Bug 引用时填写 `bug_id`。

## 2. 生成顺序

1. 提取显式需求、验收标准、约束、角色、状态和数据边界。
2. 把可独立验证的行为拆成场景。
3. 为每个场景选择必要的测试性质：
   - 主路径：`正向`
   - 长度、数量、空值、极值：`边界值`
   - 非法输入、失败响应、超时：`异常处理`
   - 输入输出契约：`契约回归`
   - 跨模块数据一致性：`数据对账`
   - 故障恢复与历史缺陷：`故障注入/回归`
4. 为每条用例写可复现的前置条件、测试数据、步骤和可观察期望。
5. 把来源证据写入 `generation_basis`，把尚未确认的前提写入 `assumptions`。
6. 只生成与当前来源相关的最小用例集。用户指定数量或范围时严格遵循。

## 3. 字段策略

- `actual_result`、`evidence` 属于执行阶段，只有用户提供已有结果时填写。
- `reviewer` 属于人工审核信息，只有用户指定时填写。
- `created_at` 使用 `YYYY-MM-DD HH:mm:ss`，只有用户要求登记创建时间时填写。
- `submitter` 默认使用当前飞书账号的名称和 `openId`；用户可以覆盖或留空。
- `status` 默认 `待开始`，`review_status` 默认 `待审核`。
- `automation_status` 默认 `待实现`。
- `automation_script_path` 只登记已经存在或用户明确指定的路径。
- `module` 可以包含多个受影响模块，使用可读文本表达。
- `scenario_tags` 使用便于筛选的短标签，例如 `版本展示, 长文本, Tooltip`。

每个字段都接受用户覆盖或 `omit`。默认值不构成必填要求。

## 4. 编号与查重

编号按以下顺序确定：

1. 用例的 `fields.case_id`；
2. 用例的 `case_id`；
3. 计划的 `case_id_prefix` 加三位顺序号；
4. Bug 来源自动生成 `TC-BUG-<issue iid>-NNN`。

编号缺失时仍可生成候选，预览提示无法自动查重。推荐独立用例使用稳定、语义化前缀，例如 `TC-AUTH-LOGIN`。

## 5. 结构化计划

```json
{
  "source": {
    "kind": "bug",
    "key": "group/project#159",
    "bug_id": "group/project#159",
    "module": "项目详情, 成分分析",
    "priority": "P1",
    "project_version": "v1.2.3"
  },
  "case_id_prefix": "TC-BUG-159",
  "defaults": {
    "case_type": "UI",
    "execution_role": "测试人员",
    "environment": "测试环境"
  },
  "omit": [],
  "cases": [
    {
      "case_key": "long-version-tooltip",
      "fields": {
        "description": "长版本号截断并展示完整提示",
        "nature": "边界值",
        "preconditions": "项目包含长度超过展示区域的版本号",
        "test_data": "v0.0.0-20220412211240-33c...",
        "steps": [
          "进入项目成分分析页",
          "观察版本号展示",
          "将鼠标悬停在版本号上"
        ],
        "expected": [
          "版本号单行截断并显示省略号",
          "悬停提示展示完整版本号"
        ],
        "scenario_tags": "版本展示, 长文本, Tooltip"
      },
      "generation_basis": [
        "Issue 描述要求长版本号截断并支持悬停查看"
      ],
      "assumptions": [
        "桌面端支持鼠标悬停"
      ]
    }
  ]
}
```

字段键使用 `tcode-test-case-profile.json` 中的 semantic。`steps` 和 `expected` 支持字符串或字符串数组。

## 6. 覆盖补齐

覆盖补齐时，先读取目标范围内现有用例，按模块、功能点、性质、类型和版本归类。只对明确缺口生成候选，并在 `generation_basis` 中写明缺失维度。已有用例编号和内容保持不变。

## 7. 自动化扩展边界

当前产物保留三个稳定信息：

- `case_key`：Agent 侧稳定场景键；
- `automation_status`：自动化规划状态；
- `automation_script_path`：已有脚本位置。

后续代码物化可以消费已审核的测试用例计划，并把生成、执行和结果回写作为独立阶段。当前候选生成器固定输出：

```json
{
  "automation": {
    "materialized": false,
    "executed": false
  }
}
```
