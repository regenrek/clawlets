export type SetupBootstrapRequirements = {
  adminPasswordRequired: boolean;
  adminPasswordReady: boolean;
  requiresTailscaleAuthKey: boolean;
  requiredHostSecretsConfigured: boolean;
};

export function deriveSetupBootstrapRequirements(params: {
  wantsTailscaleLockdown: boolean;
  isTailnet: boolean;
  sshExposureMode?: string;
  adminPasswordConfigured: boolean;
  pendingAdminPassword?: string;
  hasTailscaleAuthKeyForSetup: boolean;
}): SetupBootstrapRequirements {
  const adminPasswordRequired = !params.adminPasswordConfigured;
  const adminPasswordReady = !adminPasswordRequired || Boolean(String(params.pendingAdminPassword || "").trim());
  const sshExposureMode = String(params.sshExposureMode || "").trim();
  const requiresTailscaleAuthKey =
    params.wantsTailscaleLockdown || params.isTailnet || sshExposureMode === "tailnet";
  const requiredHostSecretsConfigured =
    !requiresTailscaleAuthKey || params.hasTailscaleAuthKeyForSetup;
  return {
    adminPasswordRequired,
    adminPasswordReady,
    requiresTailscaleAuthKey,
    requiredHostSecretsConfigured,
  };
}
