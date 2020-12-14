#!/usr/bin/env bash
set -o errexit
# set -o nounset

# For debugging purposes
# set -o xtrace
# set -o pipefail

if [ -n "${CIRCLE_PULL_REQUEST}" ]
then
  echo "This is a pull request"
  PULL_REQUEST_NUMBER=$(echo "${CIRCLE_PULL_REQUEST}" | cut -d/ -f7)
  UPSTREAM_PROJECT_USERNAME=$(echo "${CIRCLE_PULL_REQUEST}" | cut -d/ -f4)
  CURL_URL="https://api.github.com/repos/${UPSTREAM_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}/pulls/${PULL_REQUEST_NUMBER}"
  PULL_REQUEST_DETAILS=$(curl ${CURL_URL})
  REPO_IS_PUBLIC=$(echo "${PULL_REQUEST_DETAILS}" | jq -r .url)
  if [ -n "${REPO_IS_PUBLIC}" ]
  then
    echo "Public repo"
  else
    echo "Private repo"
    PULL_REQUEST_DETAILS=$(curl -H "Authorization: token ${GITHUB_TOKEN_COMMITLINT}" ${CURL_URL})
  fi

  BASE_SHA1=$(echo "${PULL_REQUEST_DETAILS}" | jq -r .base.sha)
  HEAD_SHA1=$(echo "${PULL_REQUEST_DETAILS}" | jq -r .head.sha)

  COMMIT_RANGE="${BASE_SHA1}...${HEAD_SHA1}"
else
  COMMIT_RANGE=$(echo "${CIRCLE_COMPARE_URL}" | cut -d/ -f7)
  FIRST_COMMIT=$(echo "${COMMIT_RANGE}" | cut -d. -f1)
  echo "This is a normal commit range: ${COMMIT_RANGE} with first commit: ${FIRST_COMMIT}"
  if git cat-file -e ${FIRST_COMMIT}; then
    echo "${FIRST_COMMIT} exists"
  else
    echo "${FIRST_COMMIT} does not exist"
    echo "rebase support is limited, will compare against master"
    COMMIT_RANGE=origin/master...${CIRCLE_SHA1}
  fi
fi
echo "${COMMIT_RANGE}"
git log ${COMMIT_RANGE} --pretty=%B | commitlint
