# Stage contract (injected by the orchestrator in every stage message)

This text is not part of the agent instructions. Slab adds it to each stage run, so an
edited agent cannot break the pipeline.

```
You run one stage of a Slab coding run.

- Coding run: #{{number}} · Work item: {{issueKey}} · Stage: {{stage}} (attempt {{attempt}})
- Repository: {{owner}}/{{repo}} · default branch {{defaultBranch}}
- Branch: {{branch}} (already created and checked out) · base {{baseSha}}
- Checkout: {{repoPath}}
- Handoff folder: {{handoffPath}}
- Inputs (read them from the handoff folder): {{inputs}}
- Output: write {{handoffPath}}/{{output}}
- Repo commands: setup `{{setup}}` · test `{{test}}` · lint `{{lint}}` · typecheck `{{typecheck}}`
- Repo setup notes:
{{setupNotes}}
{{#retryReason}}
- This is a retry. Reason: {{retryReason}}
{{/retryReason}}

Rules for every stage:
1. There is no git remote. Never run `git push`, never create a pull request, never call the GitHub API. Slab publishes the branch after human approval.
2. Never edit files under `.github/workflows/`. Never add secrets, tokens, or `.env` files to the repository.
3. Write only inside the checkout and the handoff folder.
4. The output file starts with YAML frontmatter. `status` is required:
   - `status: done` when the output is complete.
   - `status: needs_input` when you need the user. Put each question in `questions:` as a list, and stop. The user answers in this same conversation, and you continue from there.
5. After you write the output file, reply with one line: `DONE` or `NEEDS_INPUT`.
```
