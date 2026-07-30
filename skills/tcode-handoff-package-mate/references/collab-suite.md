# Collaboration Skill Suite

`tcode-handoff-package-mate` is the coordination layer. It resolves identity context, builds the
responsibility map, chooses the primary/related Issue structure, and preserves end-to-end
traceability. Companion skills perform the platform actions at each lifecycle station.

## Lifecycle map

| Lifecycle station | Companion skill | Input from Mate | Output |
| --- | --- | --- | --- |
| Create primary or related Issues | `issue-creator` | problem context, responsibility, assignee, mentions, acceptance, relationship | GitLab Issue structure |
| Deliver an accepted Issue | `issue-to-pr` | one owner-specific Issue and current repository state | focused MR that closes the Issue |
| Review the MR | `ai-reviewer` | MR plus named responsibility domains | line-anchored review comments |
| Resolve AI review | `ai-review-resolver` | review threads and implementation context | commits, replies, resolved threads |

Each companion remains independently useful. Mate invokes the companion for the current lifecycle
station and then records the resulting links in the primary Issue.

## Issue creation, assignment, and mentions

Mate supplies collaboration context to `issue-creator`:

- authenticated initiator;
- outcome owner for the primary Issue;
- accountable owner for each related execution Issue;
- contributors and reviewers who receive GitLab mentions;
- confidence and evidence for every mapping;
- dependency order and relationship to the primary Issue.

The GitLab execution layer creates the Issue with its accountable assignee. It adds `@GitLab-ID`
mentions in the body or a focused comment so every affected person receives visible context. A
candidate mapping remains unassigned until a human confirms it; the candidate can be mentioned in
the responsibility question.

## Autonomy posture

A request to hand off, create, publish, or execute cross-responsibility work authorizes the normal
Issue actions within that request: create or update the primary Issue, create the agreed related
Issues, assign confirmed owners, mention collaborators/reviewers, and link the records. The Agent
reports every remote artifact after creation.

A request for analysis, diagnosis, or design produces the responsibility brief and proposed Issue
structure for review.

Accepted execution follows `issue-to-pr`: inspect current relationships and intent, implement one
Issue, validate, commit, push, open the MR, and end the MR body with the single closing line for that
Issue.

## Security floor

Tokens, keys, secrets, credentials, and private operational data stay out of commits, pushes,
Issues, MRs, comments, screenshots, and command output. Companion skills use authenticated tooling
and run their key-safety checks before publication.

## Traceability

The primary Issue preserves:

- initiator identity and standing responsibilities;
- current role and outcome owner;
- owner-specific related Issues;
- assignments and mentions;
- external commits, deployments, documents, and MRs;
- dependency and status updates;
- final end-to-end acceptance.

Each execution Issue preserves its responsible owner and closes through its MR. Git authorship,
Issue authorship, assignment, review, and comments together show who initiated, who decided, who
implemented, and who accepted.

## Method and mechanics

Mate's Markdown references define the engineering-management method. Platform mechanics live in
the companion skills and authenticated GitLab/GitHub tooling. Team structure and responsibility
updates flow through `TEAM.md` and current Issue context, so the coordination method can evolve
through prose and human judgment.
