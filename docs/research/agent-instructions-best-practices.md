# Repository agent instructions: primary-source review

Checked 2026-10-23. Scope: DriveBeats, Codex and Claude Code, using frontier
models. This is a design recommendation, not a benchmark of the proposed guide.

## Assessment

Move substantial, conditional guidance into topic documents. Keep a small root
guide with repository-wide constraints, local workflow and explicit instructions
to read each relevant document **before** the action it governs. A directory of
links alone is insufficient: the agent still needs to know when each link matters.
This follows Anthropic's distinction between persistent project context and
on-demand knowledge, and its recommendation to retain information the agent
cannot infer reliably from code. [Claude Code best practices](https://code.claude.com/docs/en/best-practices#write-an-effective-claudemd)

## What the tools document

- **Codex:** builds its initial instruction chain once per run, combining global
  guidance with one instruction file per directory from project root to working
  directory. Closer guidance takes precedence; the default combined limit is
  32 KiB. The documented discovery path ends at the working directory, so starting
  at repository root does not put the app's nested guide in that initial chain.
  Keep the explicit app-guide pointer. Ordinary Markdown links are not a
  documented automatic import mechanism. [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- **Claude Code:** current docs describe native `AGENTS.md` support from
  v2.1.277, with settings and `CLAUDE.md` presence affecting loading. Its default
  falls back to `AGENTS.md` when no applicable project/ancestor `CLAUDE.md` or
  `CLAUDE.local.md` exists. Nested guides load when the Read tool opens files in
  their directory, subject to competing `CLAUDE.md` files there.
  Verify the actual session rather than assuming portability from the filename.
  [Claude instruction loading](https://code.claude.com/docs/en/memory#agentsmd)
- **Imports differ from pointers:** Claude `@path` imports expand into context
  with their importing file; splitting a file through eager imports does not
  reduce initial context. Plain links plus a read-before-action instruction
  preserve conditional retrieval. Instructions guide behavior rather than enforce
  access controls. [Claude imports and instruction semantics](https://code.claude.com/docs/en/memory#import-additional-files)

## Proposed allocation for DriveBeats

Adopted 2026-10-23: the data/sync contract and its checks moved to
`docs/data-and-sync.md`; Next.js resolution details moved to the app guide. The
small code, migration, mobile and base verification rules remain in root. This
note records research and alternatives; the guides own the standing rules.

The following is repository-specific judgment, based on the loading behavior
above and the current [root guide](../../AGENTS.md), rather than a vendor-mandated
layout. Keep one authoritative copy of each detailed rule. These are ownership
boundaries, not a requirement to create one new file per heading: a few naming or
mobile rules can remain inline when a pointer costs as much as the rule.

| Location | Guidance |
| --- | --- |
| Root `AGENTS.md` | Public-repository notice; pnpm/root execution; essential music read-only and remote-change boundaries; required validation gate; conditional document pointers. |
| `docs` topic: code conventions | Naming, table-query/service boundaries and forward-migration rules. Read before the corresponding code or schema changes. |
| `docs` topic: data boundaries | Cloud/device ownership, consent/migration gates, tag restoration, complete catalog publication and network-free `cache_only`. Read before changing those flows or contracts. |
| `docs` topic: verification | Auth, playback, sync, deletion and mobile scenarios; test-placement guidance. Read before planning verification and before delivering affected changes. |
| Existing app `AGENTS.md` | Generated Next.js instructions and installed-documentation discovery. Keep the root's read-before-app-code pointer. |
| Existing glossary/access/runbooks | Continue referencing the canonical documents; avoid additional copies. |

Keep the core safety boundary visible at root even if its implementation details
move. A broad trigger such as “before changing sync, storage, authentication,
Drive access, metadata or catalogs” covers cross-cutting work better than a
pointer tied to one directory. Use nested `AGENTS.md` for directory-wide rules;
use topic docs when a concern crosses UI, route handlers, services and database
code. These are design choices, not loading guarantees.

## Frontier models and evidence limits

Anthropic recommends starting with minimal sufficient context and the best
available model, then adding instructions in response to observed failures.
Minimal does not mean the fewest possible words. This supports pruning generic
advice without deleting project-specific constraints; it supplies no demonstrated
optimal root length for this repository. [Context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents#the-anatomy-of-effective-context)

The September 2026 revision of *Evaluating AGENTS.md* found no general task-success
improvement and higher inference cost from repository context files. It also
found no clear performance dependence on file length. Its evaluated models and
Python tasks do not establish the result for this repository's current frontier
models or compare this proposed router/topic-doc layout. Treat it as evidence
against redundant requirements, not proof that shorter always wins or that
required verification should be removed. [Paper, v3: evaluation, ablations and limitations](https://arxiv.org/html/2602.11988v3)

Not confirmed: a performance improvement from this restructuring, reliable
following of every conditional pointer, or effective loading in all local agent
sessions. The sources above document mechanisms and recommendations. After a
change, check links, compare every moved rule against the original, and observe
fresh Codex and Claude sessions on representative code, sync and documentation
tasks. Confirm they read the relevant guide before acting and retain the
validation gate; word count alone is not acceptance evidence.
