# packages/template

Project template generator.

Source of truth:
- `packages/template/skeleton/` (template-only files)
- repo `docs/` + `infra/` (copied into the template)
- selected repo `scripts/`
- repo `flake.nix` + `flake.lock`

Generate (updates `packages/template/dist/template/`):
- `pnpm -C packages/template build`

CI enforces `packages/template/dist/` is up to date. Don’t hand-edit dist.
