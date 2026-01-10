import path from "node:path";

export type RepoLayout = {
  repoRoot: string;

  infraDir: string;
  terraformDir: string;
  configsDir: string;
  fleetConfigPath: string;

  nixDir: string;
  nixHostsDir: string;

  secretsDir: string;
  secretsHostsDir: string;
  secretsOperatorsDir: string;
  sopsConfigPath: string;
};

export function getRepoLayout(repoRoot: string): RepoLayout {
  const infraDir = path.join(repoRoot, "infra");
  const terraformDir = path.join(infraDir, "terraform");
  const configsDir = path.join(infraDir, "configs");
  const fleetConfigPath = path.join(configsDir, "fleet.nix");
  const nixDir = path.join(infraDir, "nix");
  const nixHostsDir = path.join(nixDir, "hosts");
  const secretsDir = path.join(infraDir, "secrets");
  const secretsHostsDir = path.join(secretsDir, "hosts");
  const secretsOperatorsDir = path.join(secretsDir, "operators");
  const sopsConfigPath = path.join(secretsDir, ".sops.yaml");

  return {
    repoRoot,
    infraDir,
    terraformDir,
    configsDir,
    fleetConfigPath,
    nixDir,
    nixHostsDir,
    secretsDir,
    secretsHostsDir,
    secretsOperatorsDir,
    sopsConfigPath,
  };
}

export function getHostNixPath(layout: RepoLayout, host: string): string {
  return path.join(layout.nixHostsDir, `${host}.nix`);
}

export function getHostSecretsPath(layout: RepoLayout, host: string): string {
  return path.join(layout.secretsDir, `${host}.yaml`);
}

export function getHostExtraFilesDir(layout: RepoLayout, host: string): string {
  return path.join(layout.secretsDir, "extra-files", host);
}

export function getHostExtraFilesKeyPath(layout: RepoLayout, host: string): string {
  return path.join(getHostExtraFilesDir(layout, host), "var", "lib", "sops-nix", "key.txt");
}

