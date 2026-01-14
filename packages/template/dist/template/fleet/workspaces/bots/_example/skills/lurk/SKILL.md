# lurk (example skill)

This is an example custom/local skill file, shaped like clawdinator’s `workspace/skills/<skill>/SKILL.md`.

Put real skills here:
- shared: `fleet/workspaces/common/skills/<skill>/SKILL.md`
- per-bot: `fleet/workspaces/bots/<bot>/skills/<skill>/SKILL.md`

Contract
- Trigger: when asked to “lurk” or “monitor”.
- Behavior: do not speak unless you have a concrete, actionable update.
- Output: write a short status line to `memory/lurk.log` (no secrets).

