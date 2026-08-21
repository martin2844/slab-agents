# Custom integrations

Custom integrations let an agent use a configured HTTP API or an existing
Streamable HTTP MCP server. Configuration, credentials, assignment, and the
run capability snapshot live in `slab-agents`; no connector daemon is needed.

## HTTP API connector

HTTP connectors expose explicit read-only operations. The MVP accepts only
`GET` and `HEAD`; it never exposes a generic HTTP client to the model.

Each operation defines:

- a stable tool key and description;
- a path relative to the configured base URL;
- explicit path and query parameters;
- an optional JSON `responsePath` such as `data.customer`;
- response byte, array item, and timeout limits.

### Importing documentation or a manifest

The HTTP editor can create an unsaved draft from Markdown API documentation or
a versioned Slab manifest. Draft generation does not call the upstream API or
persist the pasted source. Do not paste credentials into the importer; enter the
connector secret separately after reviewing the inferred base URL,
authentication mode, parameters, response shaping, and agent access.

Markdown discovery recognizes read-only endpoint headings in this form:

```md
### GET /api/admin/metrics/users

Returns registration and activity statistics.
```

A section named `Common query parameters` may use a Markdown table; those
parameters are added to each discovered operation. Absolute URLs in examples
are used only to suggest the connector origin. A documented success envelope
containing `success` and `data` suggests `responsePath: data`.

For repeatable automation, prefer the strict JSON manifest:

```json
{
  "schemaVersion": 1,
  "kind": "custom_http",
  "name": "Clasificar Metrics",
  "baseUrl": "https://clasific.ar",
  "authentication": { "type": "bearer" },
  "defaults": {
    "timeoutMs": 15000,
    "responsePath": "data",
    "maxResponseBytes": 32768,
    "maxItems": 50
  },
  "operations": [
    {
      "key": "get_metrics",
      "name": "Get metrics",
      "description": "Return the curated metrics snapshot",
      "method": "GET",
      "path": "/api/admin/metrics",
      "parameters": []
    }
  ]
}
```

The manifest deliberately has no credential field. Authentication secrets are
entered separately in the editor and remain in encrypted server-side storage.
Only `GET` and `HEAD` operations are accepted.

For example, the following UI configuration creates the tool
`clasificar_internal__get_customer_usage`:

```json
{
  "name": "Clasificar Internal",
  "baseUrl": "https://example.internal/api",
  "operations": [
    {
      "key": "get_customer_usage",
      "name": "Get customer usage",
      "description": "Get API usage for a customer",
      "method": "GET",
      "path": "/customers/{customerId}/usage",
      "parameters": [
        {
          "name": "customerId",
          "location": "path",
          "type": "string",
          "required": true
        }
      ],
      "responsePath": "data.customer",
      "maxResponseBytes": 32768,
      "maxItems": 50
    }
  ]
}
```

Authentication can be disabled, a bearer token, or a configured API-key
header. The model supplies only declared operation arguments; it cannot change
the protocol, origin, port, headers, or base URL.

## MCP connector

An MCP connector stores a Streamable HTTP URL and optional bearer/API-key
authentication. Saving or refreshing the connector performs MCP discovery and
stores tool names, descriptions, input schemas, and safety annotations. Tool
permissions can then be assigned to agents.

## Security boundary

- Secrets are encrypted with the local control-plane master key and never
  returned by management APIs.
- Authenticated discovery and connector calls reject redirects.
- HTTP responses are streamed up to the configured byte limit, then cancelled.
- Upstream responses and errors are sanitized before they reach the model.
- Calls are time-bounded and limited to four concurrent requests per
  integration.
- Internal API hosts may intentionally be local/private, but the host comes
  only from operator configuration. Tool arguments cannot select an origin.

## Agent assignment and run snapshots

Assign integrations from either the integration editor or an agent detail
page. At run start, `slab-agents` records the integration ID, version, agent,
and allowed tools, then issues a one-run credential whose hash is stored in
SQLite. The MCP endpoint resolves identity from that run snapshot, not from an
agent ID supplied by the caller.

If connector configuration changes while a run is active, that run receives a
structured capability-version error rather than silently using the new
definition. The next run receives the new version.

## Current limitations

- Custom HTTP write operations are not supported.
- OpenAPI and curl import are not supported. Markdown and the Slab JSON
  manifest described above are supported.
- HTTP response shaping supports a dotted property path and top-level array
  limits, not arbitrary transformation code.
- Remote MCP tool annotations are informative metadata; provider-side security
  remains authoritative.
