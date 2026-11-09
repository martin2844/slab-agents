# Docs commits and proposed changes

Each human save publishes a commit containing full before/after snapshots, including metadata. Agents edit a private, durable changeset per run. Existing read scopes and denied tools continue to apply. Effective tool policies determine whether the changeset publishes automatically after a successful run or waits for one owner approval. Failed or cancelled runs retain their drafts for review. Review never keeps a runtime alive.

The Docs workspace and run view show the proposed diff, author, state and conflicts. Publishing is atomic and checks original document versions (including intervening edits with identical content), unique slugs, collection availability and the resulting hierarchy. Rejection preserves the audit trail. Reverts create new commits and cannot overwrite newer work. Agents can request a revert through the same draft and permission flow.

Implementation:
1. Add immutable commit history and persistent private drafts to Docs; retain legacy run journals and tokens.
2. Negotiate draft support before bypassing per-tool prompts, using the original effective policy to choose automatic publication or owner review.
3. Close changesets independently of runtime approvals, expose merge/reject and history/revert APIs, and show them in Docs and run details.
4. Verify isolation, scope, conflicts, crash recovery, batch atomicity, UI and compatibility; deploy with database backups and health checks.

Historical revisions remain available. The new history records exact metadata only from this migration onward; it does not invent earlier commits.

## Validation and deployment — 2026-09-21

- Implemented immutable commits, persistent private changesets, atomic merge, reject, conflict detection, collection/hierarchy checks, safe commit reverts and optimistic version checks for editor saves.
- Full Docs editing publishes one commit after a successful run. Guarded/custom policies that require review stage permitted tools without per-tool prompts and request one owner merge after execution. Explicit denials and source scopes remain enforced; reverting cannot bypass denied mutation tools.
- Docs exposes pending proposals, commit history, full content/metadata diffs, pagination and reverts. Run details and chats show pending-review notices. Existing revisions and legacy run journals remain available.
- Docs: 60 tests, typecheck and lint passed, including a second-connection test proving private overlay rows are never externally visible. Agents isolated release: 321 tests passed; local typecheck/lint and isolated Docker production build passed. Browser checks covered merge, failed merge, reject, revert, conflicts, desktop and mobile.
- Migration tested on a production snapshot: all 82 document rows unchanged; foreign keys and FTS integrity passed. Production backup is in `/root/migrations/docs-versioning-20260921`.
- Deployed `slab-docs:versioning-20260921` and `slab-agents:docs-versioning-20260921`. Runner remains `slab-runner:docs-run-20260914`. Authenticated checks passed for history, versioned document reads, published UI and review controls; unauthenticated and cross-origin mutations were rejected.
- The first deployment automatically rolled back because the verification script did not fall back to `DOCS_MCP_URL` when the URL was unset in settings. Fixed the script; the second deployment passed. Both pre-deployment backups were retained. No document content was changed by verification.
- Recovered VPS space by removing obsolete build cache and unreferenced historical Agents images. Current and recent rollback images were preserved. Maintenance is off.

Commits begin at this migration; older text revisions are preserved without fabricating past metadata. A conflicting proposal must be replaced with a new proposal based on current documents. Reverts refuse to overwrite later changes.

Final production browser verification passed: the Docs history controls render and load without client errors, and the real Docs page has no horizontal overflow at 390px. Verification remained read-only; temporary authentication sessions and the local production database copy were removed.

### Follow-up: editable tool permissions

The COO used Guarded permissions, which intentionally disabled individual tool rules. Added an explicit “Customize tool rules” control beside those rules, an explanation of the active preset, and guards against editing while a permission-mode save is pending. Failed mode saves restore the preset. Connector maximum permissions remain enforced.

Deployed `slab-agents:tool-permissions-20260921` on 2026-09-21. Isolated release source: `/tmp/slab-agents-tool-permissions-release-20260921`; backup and deployment scripts: `/root/migrations/tool-permissions-20260921`. Lint, production build/typecheck, browser checks for success/failure/concurrent edits and mobile, and authenticated production checks passed. Agent permissions were not changed by verification.
