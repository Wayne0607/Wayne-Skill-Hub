# Collaboration Shapes and Flow

Read this when routing a request, creating its Issue structure, or executing as a receiving owner.
Identity and responsibility evidence live in `ownership-context.md`; Issue content lives in
`handoff-template.md`.

## Contents

- Three collaboration shapes
- Related Issue decision
- Requester flow
- Assignment and mentions
- Receiving-owner flow
- Status and durable documentation
- Area-specific prompts

## The three collaboration shapes

Lane names describe how responsibility moves through the current request. They can coexist in one
primary Issue.

### Lane A — Own external deliverable

The accountable person changes an external module/business repository, private service, benchmark,
report generator, prompt set, or operational artifact.

Record:

- accountable person and current role;
- repository, service, or artifact;
- requested outcome and acceptance;
- commit, release, deployment, or evidence link;
- dependencies on TCode Issues or MRs.

### Lane B — Accountable delivery in TCode

The current collaborator is confirmed as accountable for the TCode delivery. Their standing
responsibilities and the current cross-area role remain visible in the responsibility brief.

Record:

- affected surfaces and why they belong in one delivery;
- accountable owner, contributors, and required reviewers;
- current Issue and MR;
- validation for every affected responsibility domain;
- end-to-end acceptance owner.

### Lane C — Responsibility handoff

Another person owns an independently schedulable, implementable, reviewable, or deployable
workstream.

Record:

- the owner-specific capability gap;
- the related Issue and its assignee;
- mentioned contributors and reviewers;
- relationship to the primary Issue;
- dependencies, acceptance, and expected artifact;
- the MR that closes the execution Issue.

## When to create related Issues

Create a related Issue when at least one condition applies:

- another accountable owner needs an explicit queue item;
- the work can be scheduled, accepted, or rejected independently;
- the work produces its own MR, external commit, or deployment;
- the work blocks another responsibility domain;
- the primary Issue would otherwise contain several unrelated implementation discussions.

Keep the work in the primary Issue when one owner carries the whole delivery and one MR or artifact
can be reviewed and accepted coherently.

## Requester flow

1. Resolve the collaborator through the startup identity preflight.
2. Search open and closed Issues plus recent MRs for the same original intent.
3. Reuse the matching primary Issue or prepare one with `issue-creator`.
4. Capture the request in the user's words, user value, current behavior, reproduction, evidence,
   dependencies, and end-to-end acceptance.
5. Build the responsibility map with outcome owner, workstream owners, contributors, reviewers,
   evidence, and confidence.
6. Explain every cross-area role and every inferred responsibility; invite correction.
7. Classify the collaboration shapes and decide the primary/related Issue structure.
8. When publication is requested, create the primary Issue first, then owner-specific related
   Issues. Assign each accountable owner and mention contributors/reviewers.
9. Link Issues using the platform's supported relationship and add a checklist to the primary
   Issue.
10. Report the created links, assignments, mentions, dependency order, and unresolved identity
    gaps.

## Assignment and mention policy

- The primary Issue has one outcome owner whenever responsibility can be represented clearly.
- Each related execution Issue has the accountable workstream owner as assignee.
- Contributors, reviewers, and people whose responsibility is affected receive an `@GitLab-ID`
  mention in the Issue body or a focused comment.
- Review and context mentions preserve the reviewer/contributor role. Implementation assignment
  comes from separately confirmed accountability.
- Multiple assignees represent explicitly confirmed shared accountability.
- An unknown or inferred mapping is confirmed before assignment. The Issue can still be created
  with the candidate mentioned and the responsibility question visible.
- The authenticated initiator remains visible through Issue authorship; the responsibility brief
  explains the initiator's current role.

## Receiving-owner flow

1. Run the identity preflight and compare the authenticated ID with the Issue assignee.
2. Read the primary Issue, responsibility brief, dependencies, requested capability, and
   acceptance criteria.
3. Confirm or correct accountability in the Issue before implementation planning.
4. Mark the Issue accepted, blocked, triaged, or redirected through a concise comment and next
   action.
5. Inspect current code and choose the implementation.
6. Use `issue-to-pr` to implement, validate, commit, push, and create the MR.
7. Request the reviewers named in the responsibility map and add reviewers discovered from the
   affected code/history.
8. Keep design decisions and validation evidence in the MR; keep coordination state and dependency
   updates in the Issue.
9. Close the execution Issue through the MR and update the primary Issue checklist.
10. Ask the outcome owner to verify end-to-end acceptance after all related work completes.

## Status vocabulary

Use clear Issue comments and checklists. Labels are optional and follow the repository's existing
label vocabulary.

| Status | Meaning | Required update |
| --- | --- | --- |
| `ready` | responsibility and acceptance are confirmed | owner and next action |
| `in-progress` | implementation or external delivery has started | branch/MR/artifact link when available |
| `blocked` | a dependency, decision, identity, access, or environment is missing | blocker and person who can resolve it |
| `triaged` | evidence shows the requested code change is unnecessary or belongs elsewhere | conclusion and routing evidence |
| `in-review` | an MR or artifact awaits review | review link and named reviewers |
| `done` | the execution artifact and validation are complete | final link and validation summary |
| `accepted` | the outcome owner verified the end-to-end result | acceptance evidence |

## Durable documentation decision

Create or update a repository document when the completed work produces reusable knowledge:

- a contract future producers or consumers implement;
- an ADR-worthy decision;
- an operating or deployment procedure;
- a reusable integration guide;
- production evidence needed by future diagnosis or audit.

Link the document from the Issue/MR and name its future audience. Routine ownership, progress,
reminders, status, and review conversation stay in GitLab.

## Area-specific prompts

- **Module context:** identify the module lead from `TEAM.md`, the business repo, module package,
  manifest/contract, result fields, fixtures, and end-to-end consumer.
- **Frontend context:** identify the frontend lead and the product interaction, data source,
  registration contract, current visual behavior, and acceptance journey.
- **Platform context:** identify the repository/platform owner and the shared contract, API, data,
  run lifecycle, deployment, or governance surface.
- **Cross-area contributor:** retain their standing responsibilities, name the current delivery
  role, and request the domain reviewers affected by the change.
