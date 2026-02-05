import type { ProvisionerDriver, HostProvisionSpec, HostProvisionSpecBase } from "../types.js";
import type { ProvisioningProvider } from "../../config/providers/index.js";
import type { ClawletsHostConfig } from "../../config/schema.js";
import { awsProvisionerDriver } from "./aws/index.js";
import { buildAwsProvisionSpec } from "./aws/spec.js";
import { hetznerProvisionerDriver } from "./hetzner/index.js";
import { buildHetznerProvisionSpec } from "./hetzner/spec.js";

export type ProvisionSpecBuilder = (params: {
  base: HostProvisionSpecBase;
  hostCfg: ClawletsHostConfig;
  hostName: string;
}) => HostProvisionSpec;

const provisionerDrivers: Record<ProvisioningProvider, ProvisionerDriver> = {
  aws: awsProvisionerDriver,
  hetzner: hetznerProvisionerDriver,
};

const provisionSpecBuilders: Record<ProvisioningProvider, ProvisionSpecBuilder> = {
  aws: buildAwsProvisionSpec,
  hetzner: buildHetznerProvisionSpec,
};

export function getProvisionerDriver(provider: ProvisioningProvider): ProvisionerDriver {
  const driver = provisionerDrivers[provider];
  if (!driver) {
    throw new Error(`unsupported provisioning provider: ${provider}`);
  }
  return driver;
}

export function getProvisionSpecBuilder(provider: ProvisioningProvider): ProvisionSpecBuilder {
  const builder = provisionSpecBuilders[provider];
  if (!builder) {
    throw new Error(`unsupported provisioning provider: ${provider}`);
  }
  return builder;
}

export { provisionerDrivers, provisionSpecBuilders };
