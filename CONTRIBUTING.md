# Contributing

Thanks for being willing to contribute, we really appreciate this.

**Working on your first Pull Request?** You can learn how from this [First Contributions guide](https://github.com/firstcontributions/first-contributions).

## Project setup

1. Fork and clone the repo
1. Run `yarn install` to install dependencies
1. Create a branch for your PR with `git checkout -b pr/your-branch-name`

> Tip: Keep your `main` branch pointing at the original repository and make
> pull requests from branches on your fork. To do this, run:
>
> ```sh
> git remote add upstream https://github.com/dimazuien/react-viewport-height.git
> git fetch upstream
> git branch --set-upstream-to=upstream/main main
> ```
>
> This will add the original repository as a "remote" called "upstream," Then
> fetch the git information from that remote, then set your local `main`
> branch to use the upstream main branch whenever you run `git pull`. Then you
> can make all of your pull request branches based on this `main` branch.
> Whenever you want to update your version of `main`, do a regular `git pull`.

## Development

1. Add new code or modify existing one in `src` folder. If you added new module, don't forget to add an export in `src/index.ts`
1. Add or/and modify tests in `tests` folder
1. Update documentation in `docs` folder

## Committing and Pushing changes

This repo uses [semantic-release](https://github.com/semantic-release/semantic-release) and [conventional commit messages](https://conventionalcommits.org) so prefix your commits with `fix:` or `feat:` if you want your changes to appear in [release notes](https://github.com/dimazuien/react-viewport-height/blob/main/CHANGELOG.md).

## Help needed

Another way of helping the project is to have a look at the [open issues](https://github.com/dimazuien/react-router-scroll-to-top/issues) and respond to questions, bug reports and feature requests.
