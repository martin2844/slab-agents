import "server-only";

import { db, now } from "@/lib/db/database";
import { bool, json, type Row } from "@/lib/repositories/repository-helpers";

export type RuntimeConfigRecord = {
  runtimeId: string;
  enabled: boolean;
  authMode: "runtime_owned" | "api_key";
  credentialCiphertext: string | null;
  baseUrl: string | null;
  apiFormat: "responses" | "chat_completions" | null;
  openrouterRequireParameters: boolean;
  openrouterDataCollection: "allow" | "deny";
  openrouterZdr: boolean;
  defaultModel: string;
  models: string[];
  configVersion: number;
  lastVerificationStatus: "connected" | "failed" | null;
  lastVerificationDetail: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRuntimeConfig(row: Row): RuntimeConfigRecord {
  return {
    runtimeId: String(row.runtime_id),
    enabled: bool(row.enabled),
    authMode: row.auth_mode as RuntimeConfigRecord["authMode"],
    credentialCiphertext: row.credential_ciphertext
      ? String(row.credential_ciphertext)
      : null,
    baseUrl: row.base_url ? String(row.base_url) : null,
    apiFormat: row.api_format
      ? (String(row.api_format) as RuntimeConfigRecord["apiFormat"])
      : null,
    openrouterRequireParameters:
      row.openrouter_require_parameters === undefined
        ? true
        : bool(row.openrouter_require_parameters),
    openrouterDataCollection:
      row.openrouter_data_collection === "allow" ? "allow" : "deny",
    openrouterZdr:
      row.openrouter_zdr === undefined ? true : bool(row.openrouter_zdr),
    defaultModel: String(row.default_model ?? "default"),
    models: json(row.models_json, ["default"]),
    configVersion: Number(row.config_version ?? 1),
    lastVerificationStatus: row.last_verification_status
      ? (String(
          row.last_verification_status,
        ) as RuntimeConfigRecord["lastVerificationStatus"])
      : null,
    lastVerificationDetail: row.last_verification_detail
      ? String(row.last_verification_detail)
      : null,
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const runtimeConfigRepository = {
  listRuntimeConfigs() {
    return (
      db
        .prepare("SELECT * FROM runtime_configs ORDER BY runtime_id")
        .all() as Row[]
    ).map(mapRuntimeConfig);
  },
  getRuntimeConfig(runtimeId: string) {
    const row = db
      .prepare("SELECT * FROM runtime_configs WHERE runtime_id=?")
      .get(runtimeId) as Row | undefined;
    return row ? mapRuntimeConfig(row) : null;
  },
  saveRuntimeConfig(input: {
    runtimeId: string;
    enabled: boolean;
    authMode: RuntimeConfigRecord["authMode"];
    credentialCiphertext?: string | null;
    baseUrl?: string | null;
    apiFormat?: RuntimeConfigRecord["apiFormat"];
    openrouterRequireParameters?: boolean;
    openrouterDataCollection?: RuntimeConfigRecord["openrouterDataCollection"];
    openrouterZdr?: boolean;
    defaultModel: string;
    models: string[];
    lastVerificationStatus?: RuntimeConfigRecord["lastVerificationStatus"];
    lastVerificationDetail?: string | null;
    lastVerifiedAt?: string | null;
  }) {
    const current = runtimeConfigRepository.getRuntimeConfig(input.runtimeId);
    const timestamp = now();
    db.prepare(
      `INSERT INTO runtime_configs
        (runtime_id,enabled,auth_mode,credential_ciphertext,base_url,api_format,openrouter_require_parameters,openrouter_data_collection,openrouter_zdr,default_model,models_json,config_version,last_verification_status,last_verification_detail,last_verified_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(runtime_id) DO UPDATE SET
        enabled=excluded.enabled,
        auth_mode=excluded.auth_mode,
        credential_ciphertext=excluded.credential_ciphertext,
        base_url=excluded.base_url,
        api_format=excluded.api_format,
        openrouter_require_parameters=excluded.openrouter_require_parameters,
        openrouter_data_collection=excluded.openrouter_data_collection,
        openrouter_zdr=excluded.openrouter_zdr,
        default_model=excluded.default_model,
        models_json=excluded.models_json,
        config_version=excluded.config_version,
        last_verification_status=excluded.last_verification_status,
        last_verification_detail=excluded.last_verification_detail,
        last_verified_at=excluded.last_verified_at,
        updated_at=excluded.updated_at`,
    ).run(
      input.runtimeId,
      input.enabled ? 1 : 0,
      input.authMode,
      input.credentialCiphertext ?? current?.credentialCiphertext ?? null,
      input.baseUrl ?? current?.baseUrl ?? null,
      input.apiFormat ?? current?.apiFormat ?? null,
      (input.openrouterRequireParameters ??
        current?.openrouterRequireParameters ??
        true)
        ? 1
        : 0,
      input.openrouterDataCollection ??
        current?.openrouterDataCollection ??
        "deny",
      (input.openrouterZdr ?? current?.openrouterZdr ?? true) ? 1 : 0,
      input.defaultModel,
      JSON.stringify([...new Set(input.models)]),
      current ? current.configVersion + 1 : 1,
      "lastVerificationStatus" in input
        ? input.lastVerificationStatus
        : (current?.lastVerificationStatus ?? null),
      "lastVerificationDetail" in input
        ? input.lastVerificationDetail
        : (current?.lastVerificationDetail ?? null),
      "lastVerifiedAt" in input
        ? input.lastVerifiedAt
        : (current?.lastVerifiedAt ?? null),
      current?.createdAt ?? timestamp,
      timestamp,
    );
    return runtimeConfigRepository.getRuntimeConfig(input.runtimeId)!;
  },

  completeRuntimeVerification(input: {
    runtimeId: string;
    expectedConfigVersion: number;
    status: NonNullable<RuntimeConfigRecord["lastVerificationStatus"]>;
    detail: string;
    checkedAt: string;
    models?: string[];
    defaultModel?: string;
  }) {
    const result = input.models
      ? db
          .prepare(
            `UPDATE runtime_configs
           SET models_json=?, default_model=?, config_version=config_version+1,
               last_verification_status=?, last_verification_detail=?,
               last_verified_at=?, updated_at=?
           WHERE runtime_id=? AND config_version=?`,
          )
          .run(
            JSON.stringify([...new Set(input.models)]),
            input.defaultModel ?? "default",
            input.status,
            input.detail,
            input.checkedAt,
            now(),
            input.runtimeId,
            input.expectedConfigVersion,
          )
      : db
          .prepare(
            `UPDATE runtime_configs
           SET config_version=config_version+1,
               last_verification_status=?, last_verification_detail=?,
               last_verified_at=?, updated_at=?
           WHERE runtime_id=? AND config_version=?`,
          )
          .run(
            input.status,
            input.detail,
            input.checkedAt,
            now(),
            input.runtimeId,
            input.expectedConfigVersion,
          );
    return result.changes === 1;
  },
};
