import type { ProvisionerDriver } from "../../types.js";

const AWS_NOT_READY =
  "AWS provisioning driver is not implemented yet. Use provisioning.provider=hetzner until Phase 2 image pipeline is shipped.";

async function fail(): Promise<never> {
  throw new Error(AWS_NOT_READY);
}

export const awsProvisionerDriver: ProvisionerDriver = {
  id: "aws",
  provision: fail,
  destroy: fail,
  lockdown: fail,
};
