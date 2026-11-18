export PATH="/c/Program Files/GitHub CLI:$PATH"
SHA=$(git rev-parse HEAD)
for i in $(seq 1 120); do
  m=$(gh pr view 236 --json mergeable -q .mergeable 2>/dev/null)
  if [ "$m" = "CONFLICTING" ]; then echo "CONFLICTING"; exit 0; fi
  runs=$(gh run list --commit "$SHA" --json databaseId,status,conclusion,name -q '.[] | "\(.name) \(.status) \(.conclusion)"' 2>/dev/null)
  if [ -n "$runs" ] && ! echo "$runs" | grep -qv " completed "; then echo "$runs"; exit 0; fi
  sleep 60
done
echo TIMEOUT; echo "$runs"
