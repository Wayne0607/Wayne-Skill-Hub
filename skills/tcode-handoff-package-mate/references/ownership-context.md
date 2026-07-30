# Ownership Context

Ownership is a working conclusion about who is accountable for an outcome in the current task. It
is built from identity, standing responsibilities, delivery context, repository evidence, and human
confirmation.

## Contents

- Four separate contexts
- Evidence signals and confidence
- Human correction
- Responsibility map
- Repository anchors
- Cross-responsibility review

## Four separate contexts

| Context | Meaning | Primary source |
| --- | --- | --- |
| Personal identity | the person currently collaborating with the Agent | authenticated GitLab account plus effective Git author |
| Standing responsibilities | durable areas where the person leads, reviews, or coordinates | `TEAM.md` |
| Current work context | the role and outcome the person is carrying in this task | current request and explicit statements |
| Target work area | code, docs, service, product surface, or external repo affected | Issue/MR and repository inspection |

Cross-area work changes the current work context. The person's identity and standing
responsibilities remain available as review and coordination context.

## Evidence signals

Use several signals and explain the conclusion:

1. **Explicit human confirmation** — strongest signal for current accountability and requested
   collaboration.
2. **Primary Issue and related Issues** — assignee, author, mentions, checklist, acceptance owner,
   and recent decisions.
3. **`TEAM.md` registry** — GitLab ID, real name, and standing responsibilities from the startup
   preflight.
4. **Module and platform declarations** — `module_manifest`, contracts, CODEOWNERS when present,
   architecture docs, and registered integration surfaces.
5. **Recent MRs and git history** — active maintainers, reviewers, and delivery patterns for the
   affected surface.
6. **Repository paths and tests** — useful clues about technical cohesion and review needs.

Paths describe technical impact and help find reviewers. Personal identity, current authority, and
accountability come from the combined evidence above.

## Confidence vocabulary

| Confidence | Meaning | Action |
| --- | --- | --- |
| `confirmed` | a human or current Issue explicitly names the accountable person | route and assign as recorded |
| `inferred` | several repository and team signals agree | explain the evidence and request correction before assignment |
| `unknown` | signals are missing or conflict | ask for the owner, reviewer, or GitLab ID |

Record confidence in the responsibility brief and in every newly created Issue.

## Human correction

When a person is listed in `TEAM.md` with blank responsibilities, follow the registry's dedicated
identity-update flow. Continue the current coordination with the responsibility stated in the
conversation and mark it `confirmed for this task`.

When the collaborator is absent from `TEAM.md`, ask whether the authenticated account maps to an
existing GitLab ID. A confirmed new member follows the dedicated identity MR flow.

When a self-described identity differs from the authenticated GitLab account, show both signals and
request the mapping before remote assignment. Preserve the stated role as unverified current work
context until the person confirms it.

When standing responsibility and current work area differ, state both:

```text
@<gitlab-id> 的常设职责为 <from TEAM.md>；本次以 <current role> 处理 <target area>。
该交叉工作由当前请求确认，并邀请受影响责任域的协作者评审。
```

When evidence conflicts, present the conflict in one sentence and ask the relevant person to choose
the accountable owner or reviewer.

## Responsibility map

For each workstream, record:

| Field | Question |
| --- | --- |
| Outcome owner | Who accepts the end-to-end result and closes the primary Issue? |
| Accountable owner | Who decides and delivers this workstream? |
| Contributors | Who supplies context or implementation? |
| Reviewers | Whose standing responsibility or expertise must review the result? |
| Current role | What role is each person carrying in this task? |
| Evidence | Which explicit statement, Issue, registry row, declaration, or history supports this? |
| Confidence | Is the conclusion confirmed, inferred, or unknown? |
| Artifact | Which Issue, MR, external commit, or durable document carries the result? |

One person may appear in several roles. Each role stays explicit.

## Current repository anchors

These anchors guide inspection and reviewer selection:

- `modules/<key>/**` and its registered frontend/tests indicate module-package context.
- A module business repository indicates scanner, analysis, prompt, report, or service context.
- `frontend/src/app`, `frontend/src/features`, and `frontend/src/components` indicate shared product
  interaction context.
- `packages/platform-core`, `packages/run-bridge`, `frontend/src/app/api`, `supabase`, and
  `contracts` indicate platform API, data, runtime, and shared-contract context.
- Root configuration, deployment, CI, documentation, and Agent skills indicate repository-level
  stewardship context.

Use these anchors to describe affected surfaces, discover recent owners/reviewers, and plan
validation. The responsibility map remains open to explicit human correction.

## Cross-responsibility review

A combined MR can serve several responsibility domains when the Issue names the accountable owner
for each domain, the affected reviewers agree to the shape, and validation covers every surface.
Separate Issues and MRs fit independently schedulable work, distinct acceptance, or separate
deployment risk.

Record the chosen shape and reason in the primary Issue so future agents inherit the decision.
