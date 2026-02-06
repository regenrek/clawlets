import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: [
        "src/doctor.ts",
        "src/doctor/deploy-checks.ts",
        "src/doctor/repo-checks.ts",
        "src/repo-layout.ts",
        "src/lib/security/age.ts",
        "src/lib/security/age-keygen.ts",
        "src/lib/config/clawlets-config.ts",
        "src/lib/runtime/context.ts",
        "src/lib/storage/dot-path.ts",
        "src/lib/project/docs-index.ts",
        "src/lib/storage/dotenv-file.ts",
        "src/lib/storage/fs-safe.ts",
        "src/lib/vcs/github.ts",
        "src/lib/host/host-resolve.ts",
        "src/lib/security/mkpasswd.ts",
        "src/lib/nix/nix-tools.ts",
        "src/lib/nix/nix-flakes.ts",
        "src/lib/nix/nix-host.ts",
        "src/lib/storage/path-expand.ts",
        "src/lib/runtime/run.ts",
        "src/lib/secrets/secrets-policy.ts",
        "src/lib/security/sops-config.ts",
        "src/lib/security/sops.ts",
        "src/lib/security/ssh.ts",
        "src/lib/security/ssh-remote.ts",
        "src/lib/secrets/secrets-init.ts"
      ],
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 60,
        "src/lib/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80
        }
      }
    }
  }
});
