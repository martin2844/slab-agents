# Operator Packs

Operator Packs are versioned, declarative configurations that turn Slab's
Agents, Work, Docs, Automations, and integrations into a repeatable operating
outcome. They are configuration—not executable plugins.

The initial built-in catalog contains:

- **Founder Ops:** evidence-based company reviews with bounded follow-up Work;
- **Sales Ops:** assignment-focused opportunity analysis with correct
  `done`/`review`/`blocked` semantics;
- **Engineering Ops:** bounded incident and bug triage grounded in Work and
  Docs.

## Install from the UI

1. Open **Operator Packs** in the Configure navigation.
2. Select a pack and inspect every proposed Agent, quick action, Automation,
   and starter Doc.
3. Review the required/optional capabilities and external-write policy.
4. Choose how to handle conflicts. **Keep existing** is the default and
   preserves user-owned configuration. **Replace** applies the values shown in
   the preview.
5. Install the pack and connect any missing required capabilities.
6. Run the synthetic acceptance scenario. The resulting Run and durable Work
   evidence remain inspectable like normal activity.

Automations shipped by the official packs are disabled by default. Installing
a pack never silently starts a schedule.

## Manifest contract

The current schema version is `1`. A pack can declare:

- metadata and minimum compatible Slab version;
- Agent identity, visible instructions, and quick actions;
- disabled-by-default or explicitly enabled Automation templates;
- required and optional capability categories;
- recommended permission policy for external writes;
- Work conventions and starter Docs;
- synthetic acceptance fixtures and a deterministic rubric;
- upgrade notes.

Stable pack IDs, resource keys, Agent slugs, and semantic capability categories
are used instead of local database UUIDs. Unknown fields are rejected.

```json
{
  "schemaVersion": 1,
  "id": "example-ops",
  "version": "1.0.0",
  "name": "Example Ops",
  "author": "Example",
  "description": "A repeatable example operating configuration.",
  "outcome": "Produce a durable example result without prompt design.",
  "compatibility": { "minimumSlabVersion": "0.1.0" },
  "agents": [
    {
      "key": "operator",
      "name": "Example Operator",
      "slug": "example-operator",
      "role": "Example operator",
      "instructions": "Read current Work and record a verifiable result.",
      "model": "default",
      "enabled": true,
      "fullAccess": false,
      "quickActions": []
    }
  ],
  "automations": [],
  "capabilities": [
    {
      "category": "work",
      "required": true,
      "description": "Current commitments and durable outcomes."
    }
  ],
  "permissions": [],
  "workConventions": [],
  "docs": [],
  "acceptanceScenarios": [
    {
      "id": "basic",
      "title": "Complete a synthetic item",
      "description": "Reads and completes a synthetic Work fixture.",
      "agentKey": "operator",
      "execution": "assignment",
      "fixture": {
        "issueTitle": "Synthetic analysis",
        "issueDescription": "Record the result and mark this item done.",
        "priority": "medium"
      },
      "prompt": "Read the synthetic fixture and persist the result in Work.",
      "rubric": {
        "requiresWorkRead": true,
        "requiresDocsRead": false,
        "requiresWorkWrite": true,
        "expectedIssueStatus": "done",
        "maxCreatedWorkItems": 0
      }
    }
  ],
  "upgradeNotes": []
}
```

Allowed capability categories are `work`, `docs`, `email`, `calendar`, `crm`,
`metrics`, `product_analytics`, `error_monitoring`, and `github`.

Doc fixtures are optional unless `requiresDocsRead` is `true`; when present,
`docTitle` and `docBody` must be supplied together and Docs must be a required
capability. Work is always required because every acceptance scenario uses a
synthetic Work item.

## Security boundary

The manifest schema has no credential, provider account, executable JavaScript,
shell, arbitrary MCP command, or hidden prompt URL fields. Strict validation
rejects unknown fields rather than ignoring them. Do not place secrets inside
human-readable descriptions, instructions, prompts, or fixture text. All Agent
instructions, Automation prompts, resource values, permission implications,
and synthetic acceptance inputs are rendered in the install preview.

Packs cannot grant Agent `fullAccess`. Elevated access remains an explicit
post-install operator decision, so a pack preview never hides an implied global
write scope.

Packs refer to integrations only by semantic capability category. A scoped
capability is ready only when its connector is healthy and every pack Agent has
an explicit tool/account grant. Integration secrets remain in the existing
encrypted/server-side stores and capability snapshots remain run-scoped.

## Reconciliation and upgrades

Local database resources are applied in one SQLite transaction. Each managed
resource stores the pack ID, stable resource key, local resource ID, and the
last applied non-secret baseline.

On a later install or version update:

- an unchanged managed resource is reconciled normally;
- an unmodified managed resource can receive the visible pack update;
- a user-edited resource becomes a conflict;
- conflicts show baseline/current/proposed values and are preserved unless the
  operator explicitly confirms **Replace**;
- resources removed by a newer manifest are detached, and removed managed
  Automations are disabled without deleting product data;
- disabling and reinstalling can safely reattach resources originally created
  by the pack while keeping adopted user resources user-owned.

Starter Docs are remote resources. Each receives a deterministic pack tag.
Reconciliation resolves that exact tag (rather than hydrating the whole Docs
collection), compares the full visible body, and serializes installs per pack in
the control plane. Disable and definition removal join that same per-pack
lifecycle queue. Individual results are recorded, and an interruption leaves
the install in `partial_failure`. Re-running install resumes missing remote
resources without duplicating successful ones.

Disabling a pack disables managed Automations and detaches pack ownership. It
does not delete Agents, quick actions, Docs, Work, Runs, comments, or user
changes. A local imported definition can be deleted only after its installation
is disabled; created product data remains.

## Import and export

The UI can import a non-secret JSON manifest and export any official or local
manifest. Official IDs cannot be replaced. Updating a local pack requires a
strictly newer semantic version.

Official packs are compiled into this repository for the current release.
Remote distribution and signing are intentionally deferred until a public pack
catalog exists.

## Synthetic acceptance

Acceptance QA creates uniquely tagged synthetic Work and Docs fixtures. It does
not use customer PII. It launches the same review or assignment path used by
normal operation and evaluates completed behavior rather than exact prose:

- successful Work/Docs reads referenced the synthetic fixtures;
- a required Work write occurred;
- a durable Work comment exists;
- the fixture reached the expected semantic status;
- created Work stayed within the declared bound;
- the Run completed.

Acceptance evidence is versioned with the installed pack, so an older passing
run is never presented as proof for a newer manifest. The latest current-version
Run, evidence, failures, aggregate pass rate, and median time to first accepted
outcome are shown on the Operator Packs page. Synthetic fixtures are retained
for auditability and can be removed manually from Work/Docs after evaluation.

## Current limitations

- no public/community marketplace or remote official-pack distribution;
- no signatures until remote distribution exists;
- no executable extensions or arbitrary provider configuration in manifests;
- no automatic rollback or deletion of remote/user data;
- acceptance evaluates deterministic product evidence, not the prose quality of
  the Agent's answer.
