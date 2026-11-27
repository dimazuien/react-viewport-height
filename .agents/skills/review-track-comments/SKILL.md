---
name: review-track-comments
description: Independently audit every TRACK source comment. Re-check linked upstream work, installed fix versions, and whether unlinked items can now be fixed. Compare fresh findings with the saved `.agents/skills/review-track-comments/track-comments.md` report, and refresh that report. Flag new, removed, or materially changed findings in chat. Use when the user asks to review, audit, refresh, or check TRACK comments or their saved review, in one repository or across several.
---

# Review TRACK Comments

## Purpose

Maintain an evidence-backed review of every `TRACK` source comment and its current disposition in `.agents/skills/review-track-comments/track-comments.md`. `TRACK` is reserved for necessary changes that are blocked outside the codebase.

## Workflow

1. Perform the fresh audit before opening `.agents/skills/review-track-comments/track-comments.md`. Keep fresh findings in working memory or temporary notes outside the report path, so previous verdicts do not anchor the review.
2. Find every `TRACK` occurrence with `rg`, including hidden tracked source directories. Exclude `.git`, dependency directories, build output, coverage output, and generated artifacts. Inspect candidate prose such as changelogs, and exclude entries that are not source comments.
3. Read the complete logical comment block and nearby code for every occurrence. A URL on a continuation line belongs to the same TRACK item.
   - Verify that the comment represents necessary work blocked outside the codebase. Classify locally actionable work, technical debt, product ideas, or reminders as misuse.
   - Reserve the misuse verdict for work whose fix belongs in this repository, not for an upstream defect that upstream declined to fix. While such a defect still reproduces in the installed version, it is not misuse, even with no local workaround beside the comment.
4. Group identical blockers while preserving every location and occurrence count. When one comment block tracks independent concerns, keep separate rows.
5. For a direct GitHub issue or pull-request URL, check its current state from GitHub. Use official issue, pull-request, release, tag, changelog, commit, and package-registry evidence. Do not infer that a closed item was fixed.
6. When a linked item is closed or merged:
   - Determine whether it was fixed, declined, duplicated, or closed as stale.
   - If it was fixed, establish the first released package version containing the fix. Compare it with the currently resolved package version: the fix is available locally only when that version contains it.
   - If it closed without a fixing change or release, it is not a removable tracker. Keep the TRACK and recheck it on upgrades.
7. For non-GitHub URLs, search-result URLs, or comments without a URL, decide whether the item is fixable now. Investigate the current dependency source, official upstream tracker, repository context, and read-only diagnostics that the decision needs.
8. Prefer read-only virtual checks for tentative cleanup, such as linting in-memory source with a suppression removed or typechecking an in-memory variant.
9. Record a fresh verdict for every item: keep, fixable now, upgrade then remove, correct or retire the tracker while preserving the workaround, misclassified local work or product backlog item, or insufficiently specified and requiring a reproduction.
10. Only after the independent audit is complete, read the existing report and compare it semantically with the fresh findings.
11. When a committed revision of the saved report exists, locate the newest commit whose report contents match the baseline being compared.
    - Resolve each saved local link against that commit, and inspect the historical TRACK block and nearby code.
    - If no matching commit exists or the saved line is invalid at that revision, use the saved row data directly. State that the match has lower confidence.
12. Match historical and fresh items primarily by the recovered local comment block, nearby workaround context, and stable tracking key. Use Git rename and copy detection to follow file changes. Treat upstream URLs as supporting evidence rather than the primary identity.
13. Treat a line-number-only shift within the same file as non-material and silently refresh its link. Treat a confirmed file move or rename as a relocation. Treat copies added by a split, merged occurrences, and removed occurrences as changes to the occurrence set.
14. When identity remains ambiguous, report the possible removal and addition instead of guessing that they are the same item.
15. Treat these as material deltas: a new or removed TRACK occurrence, a changed occurrence set, a file relocation, a changed comment block, upstream state or resolution changes, a newly identified fixing release, a resolved installed-version comparison, changed local behavior, changed evidence, or a changed verdict or recommended action. Review-date-only and line-number-only changes are not material.
16. Refresh the report with the complete current audit, not only the deltas. Format every location as a repository-relative Markdown link to the exact source line. Keep the existing report structure stable where practical, so Git diffs remain useful. Record the review date and concise supporting URLs in the report so the next run can independently re-check them.
17. If an external lookup or local dependency inspection fails, flag the audit as incomplete. Do not overwrite a previously verified verdict with an unverified assumption. When the missing evidence could change its outcome, leave the report unchanged.
18. Validate the changed report with Prettier, cspell, and `markdownlint-cli2`. If `markdownlint-cli2` is not installed locally, use `pnpm dlx markdownlint-cli2`.

## Multi-Repository Runs

Single-repository is the default.

- When the user asks for a multi-repository run, ask which repositories to include and where they are. Never assume a list.
- Order them by dependency direction: a repository whose published packages another included repository consumes, through the registry or `file:` overrides, goes first. A fix it releases can resolve a consumer's TRACK.
- Finish steps 1–9 in every repository before opening any saved report, so no repository's previous verdicts anchor another's audit.
- When several repositories track an upstream item, check it once, and use that evidence in each. Compare its fixing release with each repository's own installed version.
- Then run steps 10–18 in each repository, in the same order, against its own report and with its own validation tools.
- In chat, give the material deltas per repository, and name each upstream item that several repositories share.

## Chat Output

- Lead with material deltas and identify whether each item is new, removed, relocated, or substantively updated.
- Include the old and new state plus the practical consequence for every updated item.
- If a report did not exist, state that you created a baseline, and give the finding and occurrence counts. Do not describe every baseline row as a new regression.
- If nothing material changed, say so explicitly.
- Always link the refreshed report and mention any incomplete checks.
- Keep the full inventory in the reports instead of reproducing the complete tables in chat.

## Evidence Rules

- Use resolved installed versions from the current pnpm graph or installed package metadata, not only manifest declarations.
- Prefer upstream primary sources and exact release evidence. Distinguish maintainer confirmation from community inference.
- For an open issue, repository evidence can suggest that the comment may be stale or linked to the wrong issue. In that case, still inspect whether the local workaround remains connected to the reported behavior.
