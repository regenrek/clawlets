export type HostSetupContextMode = "first_host" | "host_setup"

export function deriveHostSetupContextMode(hostCount: number): HostSetupContextMode {
  return hostCount === 1 ? "first_host" : "host_setup"
}
