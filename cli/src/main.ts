import { defineCommand, runMain } from "citty";
import { bootstrap } from "./commands/bootstrap.js";
import { doctor } from "./commands/doctor.js";
import { infra } from "./commands/infra.js";
import { lockdown } from "./commands/lockdown.js";
import { project } from "./commands/project.js";
import { secrets } from "./commands/secrets.js";
import { server } from "./commands/server.js";
import { stack } from "./commands/stack.js";

const main = defineCommand({
  meta: {
    name: "clawdlets",
    description: "Clawdbot Hetzner fleet helper (stack-based).",
  },
  subCommands: {
    bootstrap,
    doctor,
    infra,
    lockdown,
    project,
    secrets,
    server,
    stack,
  },
});

runMain(main);
