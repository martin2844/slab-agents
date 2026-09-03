import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_INTEGRATION_TOOLS,
  collapseCompleteIntegrationToolGrants,
  expandIntegrationToolGrants,
  integrationToolIsGranted,
} from "../lib/integrations/tool-access.ts";

test("all-tools grants remain dynamic while granular grants remain fixed", () => {
  const available = ["metrics__usage", "metrics__prices"];
  const collapsed = collapseCompleteIntegrationToolGrants(
    {
      all: available,
      granular: ["metrics__usage"],
    },
    available,
  );

  assert.deepEqual(collapsed.all, [ALL_INTEGRATION_TOOLS]);
  assert.deepEqual(collapsed.granular, ["metrics__usage"]);
  assert.deepEqual(
    expandIntegrationToolGrants(collapsed.all, [
      ...available,
      "metrics__customers",
    ]),
    ["metrics__usage", "metrics__prices", "metrics__customers"],
  );
  assert.deepEqual(
    expandIntegrationToolGrants(collapsed.granular, [
      ...available,
      "metrics__customers",
    ]),
    ["metrics__usage"],
  );
  assert.equal(
    integrationToolIsGranted(collapsed.all, "metrics__customers"),
    true,
  );
  assert.equal(
    integrationToolIsGranted(collapsed.granular, "metrics__customers"),
    false,
  );
});
