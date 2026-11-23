#!/bin/sh
# Scans publishable files for credentials and private machine layout.
set -u
root=$(git rev-parse --show-toplevel) || exit 2
cd "$root" || exit 2
home_prefix=$(printf '/%s/' Users)
b='(^|[^A-Za-z0-9_-])'
pattern="${home_prefix}[A-Za-z0-9._-]+/|/home/[a-z][a-z0-9_-]+/|[A-Za-z]:\\\\Users\\\\[^\\\\]+|${b}sk-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|npm_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|hooks\\.slack\\.com/services/[A-Za-z0-9/]+|open\\.feishu\\.cn/open-apis/bot/v2/hook/[a-f0-9-]{20,}"
status=0
files=$(mktemp "${TMPDIR:-/tmp}/network-portal-leak-files.XXXXXX") || exit 2
matches=$(mktemp "${TMPDIR:-/tmp}/network-portal-leak-matches.XXXXXX") || exit 2
trap 'rm -f "$files" "$matches"' EXIT
if ! git ls-files -z --cached --others --exclude-standard -- ':!scripts/leak-check.sh' ':!pnpm-lock.yaml' > "$files"; then
  echo "leak-check: could not enumerate publishable files" >&2
  exit 2
fi
if [ -d dist ] && ! find dist -type f -print0 >> "$files"; then
  echo "leak-check: could not enumerate publishable dist files" >&2
  exit 2
fi
scan_status=0
if [ -s "$files" ]; then
  xargs -0 sh -c '
    pattern=$1
    shift
    for file do
      grep -I -l -E "$pattern" -- "$file"
      code=$?
      if [ "$code" -gt 1 ]; then exit "$code"; fi
    done
    exit 0
  ' sh "$pattern" < "$files" > "$matches"
  scan_status=$?
fi
if [ -s "$matches" ]; then
  while IFS= read -r path; do
    printf 'leak-check: replace a potential private value in %s\n' "$path" >&2
  done < "$matches"
  status=1
elif [ "$scan_status" -ne 0 ]; then
  echo "leak-check: could not read every publishable file" >&2
  status=2
fi
stray=$(
  xargs -0 sh -c '
    for file do
      case "$file" in
        dist/*) ;;
        fixtures/*|*/fixtures/*) continue ;;
      esac
      case "$file" in
        proxy.env|*/proxy.env|auth.json|*/auth.json|.claude.json|*/.claude.json|.npmrc|*/.npmrc|id_rsa|*/id_rsa|id_ed25519|*/id_ed25519|*.pem|*.env|*.env.*) printf "%s\n" "$file" ;;
      esac
    done
  ' sh < "$files"
) || exit 2
if [ -n "$stray" ]; then
  printf '%s\n' "$stray" | while IFS= read -r path; do
    printf 'leak-check: credential-shaped file would be published: %s\n' "$path" >&2
  done
  status=2
fi
[ "$status" -eq 0 ] && echo "leak-check: clean"
exit "$status"
