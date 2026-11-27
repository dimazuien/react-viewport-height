---
name: review-spelling-words
description: Review the repository's cspell word lists, and remove the entries that no committed file needs any more. The lists are the config's words and overrides, its custom dictionaries, and in-file `words`, `ignore`, and `disable` directives. Also find words that an imported config already lists. In a run across several repositories, find the words that belong in a shared config one of them publishes. Also find the shared words that none of them needs. Verify the end state with the repository's own cspell, and apply it after the user's review. Use when the user asks to review, prune, clean up, audit, or reconcile cspell words, the spelling dictionary, or spell-check exceptions, to find stale or unused words, or to move shared terms into a shared config. Also use after a cspell update, which can make listed words redundant. Not for fixing a spelling failure or adding a word during other work.
---

# Review Spelling Words

## Purpose

Keep the spelling word lists exact. Work adds a word whenever new text needs one, but nothing removes the word once that text changes or leaves. A cspell update can also make a listed word redundant, because its bundled dictionaries now know it. `scripts/review-words.ts` finds both cases. It empties every list and lints the committed files with the repository's own cspell. It keeps a word only where a committed file still fails without it. It then lints the proposed end state, and keeps every word whose removal makes cspell report a fragment of it.

## Ground rules

- **Only the files git tracks or would commit count.** A word that only an ignored file uses is stale, because the repository's own cspell runs skip that file.
- **The script edits nothing until `--apply`.** A review writes its plan and outputs to a temporary folder outside the repositories.
- **A shared config belongs to the repository that publishes it.** Change it only there, through that repository's normal change and release. Another repository drops a word that moves there only after it installs the release that adds it.
- **Unless the run covers every repository that imports a shared word, the word stays.** A run that covers fewer can't tell an unused word from one another repository needs. A folder outside the run can also import the shared config, such as a template for new repositories. If such a folder contains a shared word, the word stays.
- **Never commit.** Leave every change unstaged for the user's review.

## Steps

1. **Read the repository's spelling rules.** Read `AGENTS.md` and `CONTRIBUTING.md`. Note the spell-check command, where a new word goes, and how the repository formats and checks changed files.

2. **Choose the repositories.** Unless the user names more, review the current repository. If its config imports a shared config whose source is in a sibling repository, offer a run that includes that repository.
   - For a run across several repositories, ask which ones to include. Never assume a list.
   - List the repository that publishes a shared config first, then each repository that imports it.
   - Ask the user whether the run includes every repository that imports the shared config.
   - Also ask which folders outside the run import the shared config, such as a template for new repositories. The script doesn't see them, so step 5 searches each one with `git -C <folder> grep -n -i <word>`.

3. **Check the starting point.**
   - Run `git status --short` in each repository, and note the changes that predate the run. The review reads the working tree as it stands.
   - If a config imports a package, install the repository's dependencies first. Otherwise the script stops at the import.

4. **Run the review** from the repository root: `node .agents/skills/review-spelling-words/scripts/review-words.ts`. For several repositories, add `--repo <path>` for each, in the order from step 2.
   - The script runs cspell many times, about half a minute per large repository. Without a local cspell, it uses `npx --yes cspell`.
   - It prints the report and the path of its plan.
   - If it exits with an error, report the message and stop. An unsupported config format or an import that doesn't resolve needs the user.

5. **Read the report.** Each finding has a default:
   - **Remove** a word no committed file needs. A bundled dictionary now knows it, no committed file contains it, or it appears only where cspell doesn't check it. Remove it.
   - **Remove** a word that another list already holds, such as an imported config, the config of a directive's file, or the same config for every file. Remove it.
   - **Add to** a shared config, with the matching **Remove** in each repository: words that two or more repositories in the run need. Move them. A repository that imports the shared config drops them only after it installs the release, as the report marks.
   - **Remove** a shared word that no repository in the run needs. If the run covers every repository that imports the shared config, and no folder from step 2 contains the word, remove it. Otherwise, keep it.
   - **Remove a disable directive** that nothing it covers needs. First check whether the file is a template or source that a generator copies into other files. If it is, the directive may protect the output, so keep it.
   - **Keep:** a word the end state needs, because cspell reports only a fragment of it without it. No action.
   - **Decide:** a shared word that only one repository needs. If a folder from step 2 contains it, keep it. Otherwise, ask the user whether to move it into that repository's own config.
   - **Note:** failures that predate the run, a published config reviewed without the repositories that import it, and a nested cspell config the root config doesn't import. If the repository checks such a folder on its own, review it too, with `--repo <folder>`. The plan adds no failure of its own.

6. **Review with the user once.** For each repository, give the changes with their counts and reasons, the questions, and the notes. Wait for the go-ahead and the answers.

7. **Apply.**
   - Delete from the plan file each change the user declines.
   - For each question the user answers yes, set its `accept` to `true` in the plan file. `--apply` then adds the word to that repository's root config, and removes it from the shared config.
   - Run `node .agents/skills/review-spelling-words/scripts/review-words.ts --apply <plan file>`.
   - It skips the changes marked for after a release. It refuses a config that holds comments, since a rewrite would drop them: make those edits by hand.

8. **Format and check.**
   - Format each changed file with the repository's formatter, since `--apply` writes configs as plain JSON.
   - Run the repository's spell-check command, and the checks its instructions require for the changed files.
   - Run the review again. It proposes nothing new, apart from the changes left for a release.

9. **Hand over.** For each repository, report the files changed, the number of words removed and added, the changes left for a release, and the open questions. Suggest a commit message in each repository's convention.

## Releasing a move

When words move into a shared config, the repository that publishes it changes first, and releases through its normal flow.

- Each repository that imports it then installs the release, and runs the review again. The review now proposes the moved words as words the imported config already lists.
- Until then, the importing repositories keep the words, or check against the local source of the shared config the way their docs describe.

When a word moves out of a shared config, the repository that needs it adds the word at once. Merge that change before the repository installs the release that drops the word.

## Output

Word lists holding only the words committed files need, unstaged for the user to commit, and a plan of the changes left for a release.

## Don't

- Don't edit word lists by hand where `--apply` can make the change.
- Don't remove a shared word in a run that misses a repository that imports it.
- Don't remove a disable directive that a generator copies into its output.
- Don't commit.
