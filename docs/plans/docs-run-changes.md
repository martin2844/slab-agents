# Docs changes by run

## Intended behavior

The first prompted Docs write asks for permission to create, edit and archive documents for this run. Subsequent eligible Docs writes reuse that decision, including simultaneous requests. Existing deny policies and collection boundaries remain enforced. Other tool approvals keep their current behavior. Runtimes without interactive approvals keep their existing restrictions.

Each actual document mutation records a full before/after snapshot in the same database transaction as the write. Run identity comes from a signed access token issued by Agents, never from tool arguments. The run displays consolidated changes per document during execution and after success, failure or cancellation. Undo is available after the run stops and creates new history; it never deletes audit records.

## Implementation sequence

1. Docs: signed run identity, mutation versions, transactional change journal, read and undo API. Include title, body, collection, parent, tags and archive state. Undo-created documents are archived. Undo-all preflights every document and commits atomically. Reject intervening writes, dependencies on newly-created documents, invalid restored hierarchies and repeat writes to a closed change set.
2. Runner: optional Docs run approval scope, centralized grouping for supported interactive adapters, one visible approval for concurrent writes, no grants across runs, explicit normalized scope metadata. Preserve per-tool deny decisions and cancellation behavior.
3. Agents: negotiate Docs audit support before enabling grouped permissions; pass trusted run identity and grant metadata; present clear approval copy; authenticated run change API and terminal-run-only rollback; client diff panel with individual/all undo and conflicts.
4. Validate migrations, permissions, concurrent approvals, restarts, repeated edits, partial failures, undo conflicts, metadata and hierarchy restoration, UI diff and rollback. Build isolated release artifacts preserving existing workspace changes. Deploy compatible Docs/Runner/Agents together using backups, maintenance and health checks.

## Important boundaries

Old runs lack exact run attribution and before snapshots; do not invent historical changes or offer unsafe rollback. Imported source collections remain read-only. Run changes cannot be undone while that run is active. New runs never inherit approval from a previous conversation turn. A newer document version blocks automatic undo even when its text matches the earlier content.

## Progress

- [x] Inspect existing revision, access-token, approval, runtime and run-detail contracts.
- [x] Implement transactional journal and safe undo in Docs.
- [x] Implement grouped runtime approval and metadata.
- [x] Add Agents integration, diff and undo UI.
- [x] Complete regression and browser validation.
- [x] Deploy and verify compatible services.

## Validation

- Docs: 47 tests, typecheck and lint passed. Migration verified against a production backup (76 unchanged documents), including foreign keys, full-text index integrity and version increments.
- Runner: 264 tests, typecheck and lint passed. The approval suite reproduces and guards a microtask race where a follow-up write arrives while the previous approvals finish.
- Agents: 318 tests, typecheck and lint passed. Browser checks cover the diff, individual undo, conflict blocking and mobile layout.
- All three isolated Docker release builds passed.

## Deployment

Deployed to agents.c5h.dev on 2026-09-14: slab-agents:docs-run-20260914, slab-runner:docs-run-20260914 and slab-docs:docs-run-20260914. All services healthy; maintenance disabled. Public authenticated checks verified the run tab, published diff UI, historical-run handling, Docs journal API, unauthenticated rejection and CSRF rejection. WhatsApp remains WORKING.

Production sets Docs SKIP_MIGRATIONS=true: apply Docs migration explicitly before starting the new services. Agents uses Knex migration validation; an older image missing migration 043 cannot start against the upgraded database. The compatible rollback image slab-agents:docs-run-rollback-20260914 contains the previous application plus migration 043. It passed migration validation. Use it when rolling back the application; preserve the additive schema and document audit history. Do not blindly restore a pre-deployment database after users resume work.

Backups and deployment scripts: /root/migrations/docs-run-20260914 on the VPS. The before and before-retry directories contain the databases before these migrations. The initial health gate caught the skipped Docs migration; a verification-script environment fallback error then caused a rollback attempt, exposing the missing migration file in the older Agents image. Recovery restored the new compatible services and passed verification.
