export function buildGatewayConfigPath(host: string, gatewayId: string, ...parts: Array<string | number>): string {
  const suffix = parts
    .filter((part) => part !== "")
    .map((part) => String(part))
    .join(".")
  return suffix ? `hosts.${host}.gateways.${gatewayId}.${suffix}` : `hosts.${host}.gateways.${gatewayId}`
}
