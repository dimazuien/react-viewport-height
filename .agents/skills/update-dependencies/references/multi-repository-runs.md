# Multi-repository runs

Single-repository is the default.

- When the user asks for a multi-repository run, ask which repositories to include and where they are. Never assume a list.
- Order them by dependency direction: a repository whose published package another included repository installs goes first. Repositories that install nothing from each other keep the user's order.
- Build one aligned plan: the same batch names everywhere, each with its per-repository package list, where a package may be absent in some repositories.
- Run each batch through every repository in order before handing it over. Apply, check, and report per repository, then wait for the user's go-ahead and stage each repository.
- Check each hold in `references/toolchain.md` → _TRACK-held pins_ once, and use that evidence in every repository that carries the hold.
- When a batch fails in one repository, report which one. Let the user decide whether to hold the batch everywhere or keep it where it passed.
- Steps 9 and 10 of `SKILL.md` also run per repository in the same order.
