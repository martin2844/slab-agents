import "server-only";

import { db, now } from "@/lib/db/database";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type {
  AgentEmailAccess,
  EmailSendPolicy,
  IntegrationStatus,
} from "@/lib/types";

function mapAgentEmailAccess(row: Row, accountIds: string[]): AgentEmailAccess {
  return {
    agentId: String(row.agent_id),
    profileId: String(row.profile_id),
    profileName: String(row.profile_name),
    accountIds,
    readEnabled: bool(row.read_enabled),
    draftEnabled: bool(row.draft_enabled),
    sendEnabled: bool(row.send_enabled),
    sendPolicy: row.send_policy as EmailSendPolicy,
    tokenId: String(row.token_id),
    tokenPrefix: String(row.token_prefix),
    tokenCreatedAt: String(row.token_created_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const emailAccessRepository = {
  getEmailIntegrationRecord() {
    const row = db
      .prepare("SELECT * FROM email_integrations WHERE id='email'")
      .get() as Row | undefined;
    return row
      ? {
          serviceUrl: String(row.service_url),
          status: row.status as IntegrationStatus,
          lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
          lastError: row.last_error ? String(row.last_error) : null,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }
      : null;
  },
  saveEmailIntegration(input: {
    serviceUrl: string;
    status: IntegrationStatus;
    lastTestedAt: string | null;
    lastError: string | null;
  }) {
    const timestamp = now();
    db.prepare(
      `INSERT INTO email_integrations
        (id,service_url,status,last_tested_at,last_error,created_at,updated_at)
       VALUES ('email',?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        service_url=excluded.service_url,
        status=excluded.status,
        last_tested_at=excluded.last_tested_at,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at`,
    ).run(
      input.serviceUrl,
      input.status,
      input.lastTestedAt,
      input.lastError,
      emailAccessRepository.getEmailIntegrationRecord()?.createdAt ?? timestamp,
      timestamp,
    );
    return emailAccessRepository.getEmailIntegrationRecord()!;
  },
  listAgentEmailAccess(): AgentEmailAccess[] {
    const rows = db
      .prepare("SELECT * FROM agent_email_access ORDER BY profile_name")
      .all() as Row[];
    const accountStatement = db.prepare(
      "SELECT account_id FROM agent_email_accounts WHERE agent_id=? ORDER BY account_id",
    );
    return rows.map((row) =>
      mapAgentEmailAccess(
        row,
        (
          accountStatement.all(String(row.agent_id)) as Array<{
            account_id: string;
          }>
        ).map(({ account_id }) => account_id),
      ),
    );
  },
  getAgentEmailAccess(agentId: string) {
    const row = db
      .prepare("SELECT * FROM agent_email_access WHERE agent_id=?")
      .get(agentId) as Row | undefined;
    if (!row) return null;
    const accountIds = (
      db
        .prepare(
          "SELECT account_id FROM agent_email_accounts WHERE agent_id=? ORDER BY account_id",
        )
        .all(agentId) as Array<{ account_id: string }>
    ).map(({ account_id }) => account_id);
    return mapAgentEmailAccess(row, accountIds);
  },
  saveAgentEmailAccess(input: {
    agentId: string;
    profileId: string;
    profileName: string;
    accountIds: string[];
    readEnabled: boolean;
    draftEnabled: boolean;
    sendEnabled: boolean;
    sendPolicy: EmailSendPolicy;
    tokenId: string;
    tokenPrefix: string;
    tokenCreatedAt: string;
  }) {
    const current = emailAccessRepository.getAgentEmailAccess(input.agentId);
    const timestamp = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO agent_email_access
          (agent_id,profile_id,profile_name,read_enabled,draft_enabled,send_enabled,send_policy,token_id,token_prefix,token_created_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(agent_id) DO UPDATE SET
          profile_id=excluded.profile_id,
          profile_name=excluded.profile_name,
          read_enabled=excluded.read_enabled,
          draft_enabled=excluded.draft_enabled,
          send_enabled=excluded.send_enabled,
          send_policy=excluded.send_policy,
          token_id=excluded.token_id,
          token_prefix=excluded.token_prefix,
          token_created_at=excluded.token_created_at,
          updated_at=excluded.updated_at`,
      ).run(
        input.agentId,
        input.profileId,
        input.profileName,
        Number(input.readEnabled),
        Number(input.draftEnabled),
        Number(input.sendEnabled),
        input.sendPolicy,
        input.tokenId,
        input.tokenPrefix,
        input.tokenCreatedAt,
        current?.createdAt ?? timestamp,
        timestamp,
      );
      db.prepare("DELETE FROM agent_email_accounts WHERE agent_id=?").run(
        input.agentId,
      );
      const insert = db.prepare(
        "INSERT INTO agent_email_accounts (agent_id,account_id) VALUES (?,?)",
      );
      for (const accountId of [...new Set(input.accountIds)]) {
        insert.run(input.agentId, accountId);
      }
    })();
    return emailAccessRepository.getAgentEmailAccess(input.agentId)!;
  },
  deleteAgentEmailAccess(agentId: string) {
    db.prepare("DELETE FROM agent_email_access WHERE agent_id=?").run(agentId);
  },
};
