export type CodexLoginStatus =
  "pending" | "succeeded" | "failed" | "cancelled" | "expired";

export const codexLoginIdPattern = /^[A-Za-z0-9_-]{1,256}$/;

export type CodexDeviceLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  status: CodexLoginStatus;
  expiresAt: string;
};

export type CodexAuthStatus = {
  status: "authenticated" | "not_authenticated" | "unavailable";
  authMode: "chatgpt" | "api_key" | "cloud_provider" | "unknown" | null;
  email: string | null;
  planType: string | null;
  login: CodexDeviceLogin | null;
};
