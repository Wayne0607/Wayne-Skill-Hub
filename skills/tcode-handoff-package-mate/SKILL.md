---
name: tcode-handoff-package-mate
description: "Use when TCode work spans people, responsibilities, modules, frontend, platform, or repositories. Resolve the collaborator from the identity preflight, separate standing responsibilities from the current work context, establish an explainable and human-correctable responsibility map, and coordinate one primary GitLab issue with assigned owner-specific issues and MRs. Use repository documents only for durable knowledge such as contracts, decisions, operating guidance, or production evidence."
---

# TCode Handoff Mate

Act as the coordination mate for AI-assisted team collaboration. Turn an informal request into
clear responsibility context, one durable coordination thread, owner-specific execution, and
end-to-end acceptance. The receiving owner chooses the implementation from the current codebase.

## Core principles

1. **Identity comes before routing.** Inherit the collaborator identity, real name, and standing
   responsibilities from the `TEAM.md` startup preflight. Keep identity, standing
   responsibilities, current work context, and target work area as four separate facts.
2. **Responsibility is an explainable working conclusion.** Use explicit human statements, the
   team registry, the current Issue/MR, module declarations, code context, and git history as
   evidence. Record confidence and invite correction whenever the conclusion is inferred.
3. **One original request has one primary Issue.** The primary Issue carries the handoff context,
   outcome owner, acceptance, related work, and status. Reuse an existing Issue when it already
   represents the request.
4. **Independent responsibility receives an independent execution Issue.** Create a related
   Issue when a workstream has its own accountable owner, schedule, implementation, or acceptance.
   Assign that owner and mention contributors or reviewers by their GitLab IDs.
5. **MRs carry implementation and review.** Each owner implements from an accepted Issue, opens
   the corresponding MR, records validation, and closes that Issue. The primary Issue closes after
   end-to-end acceptance.
6. **Repository documents carry durable knowledge.** Contracts, architecture decisions,
   operating guidance, and reusable production evidence belong in the repository and are linked
   from the Issue. Routine coordination remains in Issue/MR history.
7. **The receiver owns implementation judgment.** Handoff context states the problem, evidence,
   requested capability, dependencies, and acceptance criteria.

## Responsibility brief

Before routing or editing, publish a compact brief:

```markdown
## 协作者与责任上下文

- 当前协作者：@<gitlab-id>（<real name>）
- 常设职责：<from TEAM.md>
- 当前工作上下文：<role and outcome in this task>
- 目标工作区域：<affected surfaces>
- 结果负责人：@<gitlab-id>（已确认）
- 协作者/评审人：@<gitlab-id>
- 判断依据：TEAM.md、当前 Issue、当前对话、相关 MR 历史
- 置信度：confirmed
- 协作形态：Lane B + Lane C
```

Use `confirmed`, `inferred`, or `unknown` for confidence. An inferred or unknown owner receives a
short explanation and a direct confirmation question before assignment.

## Collaboration shapes

Lane names describe coordination shape. They are context for planning and communication.

- **Lane A — own external deliverable.** The accountable person changes a module business repo,
  service, benchmark, report generator, or another external deliverable they own.
- **Lane B — accountable delivery in TCode.** The current collaborator is confirmed as the
  accountable owner for the TCode change. Cross-area work stays visible in the responsibility
  brief and receives the relevant reviewers.
- **Lane C — responsibility handoff.** Another person owns an independently schedulable or
  reviewable workstream. Create or update their Issue, assign them, mention collaborators, and link
  it to the primary Issue.

A request may use several shapes. Paths and module boundaries provide evidence for the map; the
current responsibility and human confirmation decide the route. Full flow:
`references/lanes-and-flow.md`.

## Requester flow

1. Load the identity preflight context from `TEAM.md`.
2. Search current Issues and MRs for the original request and reuse its primary Issue.
3. Capture intent, user value, reproduction, current evidence, dependencies, and end-to-end
   acceptance.
4. Build the responsibility brief from the signals in `references/ownership-context.md`.
5. Explain cross-area work and surface every inferred or unknown responsibility for correction.
6. Decide which work stays in the primary Issue and which responsibility domains need related
   execution Issues.
7. When the user has requested handoff or publication, use `issue-creator` to create the Issue
   structure, assign the accountable GitLab IDs, and mention contributors/reviewers.
8. Link durable documentation outputs only when the work creates reusable knowledge.

Use `references/handoff-template.md` for Issue content. A context gap produces a focused question
or gap report.

## Receiving-owner flow

1. Resolve the receiving collaborator through the same identity preflight.
2. Read the Issue intent, responsibility brief, acceptance, dependencies, and related artifacts.
3. Confirm or correct the recorded owner and current role in the Issue.
4. Use `issue-to-pr` for accepted implementation work.
5. Record decisions, validation, MR link, blockers, and next action in the Issue/MR thread.
6. Request the named reviewers and include every affected responsibility domain.
7. Close the execution Issue through its MR; update the primary Issue checklist.
8. Ask the outcome owner for end-to-end acceptance when all related work is complete.

## Companion skills

- `issue-creator` creates the primary and related Issues from the approved responsibility map.
- `issue-to-pr` turns one accepted Issue into one focused MR.
- `ai-reviewer` publishes line-anchored review feedback.
- `ai-review-resolver` closes AI review discussions with code or engineering rationale.

The companions own platform mechanics. Mate owns identity context, responsibility reasoning,
coordination structure, and traceability. See `references/collab-suite.md`.

## References

Load a reference when its detail is needed:

| Read | When |
| --- | --- |
| `references/overview.md` | understand the Issue-centered lifecycle and document policy |
| `references/ownership-context.md` | infer and explain identity, responsibility, and cross-area work |
| `references/lanes-and-flow.md` | classify collaboration shapes or execute as a receiver |
| `references/handoff-template.md` | create the primary or owner-specific Issue content |
| `references/collab-suite.md` | invoke issue, MR, review, or review-resolution mechanics |
| `examples/` | inspect a worked Issue-centered handoff example |

## Success standard

- The collaborator is identified as a person with standing responsibilities and a separate
  current work context.
- One primary Issue explains the outcome, owner, evidence, dependencies, and acceptance.
- Independently accountable work has an assigned related Issue and a visible GitLab mention.
- Each implementation MR links to and closes its execution Issue.
- Cross-area work names the reason and required reviewers, with human correction available.
- Repository documents contain durable knowledge that future work will reuse.
- The primary outcome owner can verify the completed user journey from the linked evidence.
