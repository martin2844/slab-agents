# Knowledge sources

Slab Sources synchronizes external, read-only knowledge into Slab Docs. Agents
continue to use the existing Docs MCP tools, so adding a source does not add a
new generic browser or HTTP tool to a run.

```text
WordPress / GitHub / Website
            ↓ scheduled server-side sync
        slab-agents
      encrypted credentials
            ↓ Docs MCP
         Slab Docs
  managed documents + revisions
            ↓
     agent Docs capability
```

## Common lifecycle

1. Create a source in **Sources**.
2. Use **Test** to validate remote access without writing documents.
3. Use **Sync** or configure an interval of 15–10,080 minutes.
4. Slab creates one root document and one managed child per remote item.
5. Later syncs update changed children and preserve revisions. When a complete
   remote collection no longer contains an item, its mirrored document is
   archived rather than deleted.

Every mirrored document records the source name, canonical URL when available,
external identifier, remote update time, and a managed-content warning.

## WordPress

WordPress uses the standard REST API under `/wp-json/wp/v2`.

- **Site URL:** the WordPress origin, for example `https://example.com`.
- **Content types:** REST collection names such as `posts,pages`.
- **Authentication:** none for public content, Basic for a WordPress application
  password, or Bearer when the site has a compatible authentication plugin.
- **Username:** required with Basic authentication.
- **Secret:** the application password or bearer token. It is encrypted locally
  and is never returned by the Sources API.

Slab requests only published content by default, converts rendered HTML to
Markdown, and follows WordPress pagination up to the configured document limit.

## GitHub repositories

GitHub sources read selected Markdown and text blobs from one branch.

- Public repositories can use **Public repository**.
- A fine-grained personal access token can be used for a private repository,
  but a GitHub App is preferred.
- Path prefixes such as `docs` or `handbook` scope the indexed tree.
- Extensions such as `md,mdx,txt` define the accepted document formats.
- Individual files over 1 MiB and truncated repository trees are rejected or
  require a narrower path scope.

### Connect a GitHub App

1. Select **Sources → GitHub Apps → Connect**.
2. Choose a unique App name. Enter an organization only when the App should be
   owned by that organization; otherwise it is created for the signed-in user.
3. GitHub shows the App manifest. Confirm registration.
4. Back in Slab, choose **Install repository access**.
5. In GitHub, select only the repositories Slab may read.
6. Create a GitHub source, choose **GitHub App**, then select the repository.

The App requests only repository contents and metadata with read access. Slab
stores the App private key using authenticated local encryption. It verifies
that the installation belongs to the registered App and mints short-lived
installation tokens server-side. Private keys and tokens never enter prompts,
run events, source API responses, or browser state.

If organization policy requires approval for new GitHub Apps, an organization
owner must approve the installation before repository discovery succeeds.

## Website and sitemap

Website sources read same-origin pages from an XML sitemap.

- **Website URL** establishes the only allowed origin.
- **Sitemap URL** defaults to `/sitemap.xml` and must use that origin.
- Sitemap indexes are followed only on the configured origin.
- Include paths can narrow the collection, for example `/docs,/guides`.
- Redirects to another origin are rejected. Credentials are never sent to a
  redirected host.

This connector is appropriate for public documentation and simple internal
knowledge sites. It extracts the main article/body and removes navigation,
scripts, forms, iframes, and other non-document content.

## Security boundary

- Operators choose the source host. Tool/model arguments cannot change it.
- URLs cannot contain embedded credentials.
- Secrets use the same AES-256-GCM local key as other Slab integrations.
- Changing a website origin or authentication identity requires entering the
  secret again, preventing accidental credential forwarding to a new host.
- HTTP calls have a 15-second timeout, same-origin redirect enforcement, and
  bounded response sizes.
- A 32 MiB aggregate decoded-content budget, collection limits, and per-file
  limits prevent a valid but oversized source from exhausting the control
  plane.
- GitHub setup states are random, stored only as hashes, expire after one hour,
  and can be consumed only once.

Private/internal URLs are intentionally supported because Slab is self-hosted.
The trust boundary is therefore the operator-configured origin, not a blanket
ban on private networks.

## Troubleshooting

### WordPress returns 401 or 403

Verify the username and application password, and confirm that the requested
content types are registered with `show_in_rest`.

### GitHub repository is not listed

Open the GitHub App installation settings and grant that repository. Then use
**Test**. Repository access changes apply on the next discovery/sync.

### GitHub tree is truncated

Narrow **Included paths**. Slab deliberately refuses an incomplete tree rather
than silently treating missing files as deletions.

### Website has no documents

Verify that the sitemap is valid XML, contains same-origin page URLs, and that
the configured include paths match those URLs.

### A sync fails midway

The source is marked `error` with a compact reason. Existing Docs and revisions
remain available. Retry the sync after correcting the remote issue; unchanged
items are not rewritten.

### Deletion fails after it starts

The source remains in `deleting` state and cannot be edited or synchronized.
This reserves ownership before any managed Docs are archived. Fix the Docs
connection, reload Sources, and retry Delete; archive operations are
idempotent and the source record is removed only after they finish.
