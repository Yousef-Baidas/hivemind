# Worktrees

One worktree per ticket. Workers never share a checkout, a dev server, or a database.

```bash
# lead, before dispatch
git worktree add ../<repo>-<ticket-id> -b <ticket-id>

# worker, when green
git -C ../<repo>-<ticket-id> push -u origin <ticket-id>

# lead, merge in dependency order, one at a time
git merge --no-ff <ticket-id>
git worktree remove ../<repo>-<ticket-id>
git branch -d <ticket-id>
```

Rules:

- Ownership is decided before launch. A worker that needs a file it does not own stops and posts to the task list.
- Merge sequentially. Never merge two branches that touched the same module in the same round.
- Ports and temp dirs are per worktree; derive them from the ticket id.
