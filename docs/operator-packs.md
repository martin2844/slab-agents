# Blueprints

Blueprints are installable operating capabilities that turn Slab's Agents,
Work, Docs, Automations, and integrations into a repeatable business outcome.
A founder can understand and install one without reading its underlying
package definition. Blueprints are configuration—not executable plugins.

The initial built-in catalog contains:

- **Founder Ops:** evidence-based company reviews with bounded follow-up Work;
- **Sales Ops:** assignment-focused opportunity analysis with correct
  `done`/`review`/`blocked` semantics;
- **Engineering Ops:** bounded incident and bug triage grounded in Work and
  Docs.

## Install from the UI

1. Open **Blueprints** in the Configure navigation.
2. Select a Blueprint and review its outcome, Agents, Automations, guides,
   integration requirements, and permissions.
3. If Slab detects conflicting user-owned configuration, choose **Keep my
   existing configuration** or **Replace with Blueprint configuration**.
4. Install the Blueprint and connect any missing required integrations.
5. Run its safe sample test. The resulting Run and durable Work evidence remain
   inspectable like normal activity.

Automations shipped by the official Blueprints are disabled by default.
Installing a Blueprint never silently starts a schedule.

## Internal package contract

The implementation retains the existing Operator Pack schema, persistence,
routes, and reconciliation semantics for compatibility. The manifest is an
advanced import/export format, not the primary product interface.

The current schema version is `1`. A Blueprint can declare:

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

Blueprints cannot grant Agent `fullAccess`. Elevated access remains an explicit
post-install operator decision, so a Blueprint preview never hides an implied global
write scope.

Blueprints refer to integrations only by semantic capability category. A scoped
capability is ready only when its connector is healthy and every pack Agent has
an explicit tool/account grant. Integration secrets remain in the existing
encrypted/server-side stores and capability snapshots remain run-scoped.

## Reconciliation and upgrades

Local database resources are applied in one SQLite transaction. Each managed
resource stores the Blueprint ID, stable resource key, local resource ID, and the
last applied non-secret baseline.

On a later Blueprint install or version update:

- an unchanged managed resource is reconciled normally;
- an unmodified managed resource can receive the visible Blueprint update;
- a user-edited resource becomes a conflict;
- conflicts are kept unless the operator explicitly chooses **Replace with
  Blueprint configuration**;
- resources removed by a newer manifest are detached, and removed managed
  Automations are disabled without deleting product data;
- disabling and reinstalling can safely reattach resources originally created
  by the pack while keeping adopted user resources user-owned.

Starter guides are remote Docs resources. Each receives a deterministic tag.
Reconciliation resolves that exact tag (rather than hydrating the whole Docs
collection), compares the full visible body, and serializes installs per Blueprint in
the control plane. Uninstall and definition removal join that same per-Blueprint
lifecycle queue. Individual results are recorded, and an interruption leaves
the install in `partial_failure`. Re-running install resumes missing remote
resources without duplicating successful ones.

Uninstalling a Blueprint pauses managed Automations and detaches Blueprint ownership. It
does not delete Agents, quick actions, Docs, Work, Runs, comments, or user
changes. A local imported definition can be deleted only after its installation
is disabled; created product data remains.

## Import and export

The UI can import a non-secret JSON definition and export any official or local
Blueprint. Official IDs cannot be replaced. Updating a local Blueprint requires a
strictly newer semantic version.

Official Blueprints are compiled into this repository for the current release.
Remote distribution and signing are intentionally deferred until a public Blueprint
catalog exists.

## Safe Blueprint tests

Blueprint tests create uniquely tagged sample Work and Docs records. They do
not use customer PII or modify existing customer and operational records. The
test launches the same review or assignment path used by normal operation and
evaluates completed behavior rather than exact prose:

- successful Work/Docs reads referenced the synthetic fixtures;
- a required Work write occurred;
- a durable Work comment exists;
- the fixture reached the expected semantic status;
- created Work stayed within the declared bound;
- the Run completed.

Test evidence is versioned with the installed Blueprint, so an older passing
run is never presented as proof for a newer manifest. The latest current-version
Run, evidence, failures, aggregate pass rate, and median time to first accepted
outcome are shown on the Blueprints page. Sample fixtures are retained
for auditability and can be removed manually from Work/Docs after evaluation.

## Current limitations

- no public/community marketplace or remote official-pack distribution;
- no signatures until remote distribution exists;
- no executable extensions or arbitrary provider configuration in manifests;
- no automatic rollback or deletion of remote/user data;
- acceptance evaluates deterministic product evidence, not the prose quality of
  the Agent's answer.
