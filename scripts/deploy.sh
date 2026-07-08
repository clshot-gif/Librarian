#!/usr/bin/env bash
# Publish the production build to the gh-pages branch — deterministically.
#
# Why not the gh-pages npm tool: it builds the gh-pages branch as an orphan
# that inherits the source branch's committed dotfiles (.gitignore, .env.example,
# .prettierrc.json, …) and its cleanup step doesn't purge them, so every publish
# merged those stragglers into the deploy. This instead commits ONLY the freshly
# built dist/ as a single orphan commit and force-pushes it, so the branch always
# contains exactly the build output — nothing else.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

REMOTE_URL="$(git remote get-url origin)"
# The throwaway repo below doesn't inherit the main repo's committer identity,
# so carry it over explicitly (fall back to a generic one if unset).
GIT_NAME="$(git config user.name || echo 'Deploy')"
GIT_EMAIL="$(git config user.email || echo 'deploy@localhost')"

cd dist
touch .nojekyll                 # tell GitHub Pages not to run the files through Jekyll
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed dist/ to gh-pages on $REMOTE_URL"
