import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { setupFieldHelp } from "~/lib/setup-field-help"

type HostProvider = "hetzner" | "aws"

export function HostProviderSettingsSection(props: {
  provider: HostProvider
  saving: boolean
  onSave: () => void
  serverType: string
  setServerType: (value: string) => void
  hetznerImage: string
  setHetznerImage: (value: string) => void
  hetznerLocation: string
  setHetznerLocation: (value: string) => void
  hetznerAllowTailscaleUdpIngress: boolean
  setHetznerAllowTailscaleUdpIngress: (value: boolean) => void
  awsRegion: string
  setAwsRegion: (value: string) => void
  awsInstanceType: string
  setAwsInstanceType: (value: string) => void
  awsAmiId: string
  setAwsAmiId: (value: string) => void
  awsVpcId: string
  setAwsVpcId: (value: string) => void
  awsSubnetId: string
  setAwsSubnetId: (value: string) => void
  awsUseDefaultVpc: boolean
  setAwsUseDefaultVpc: (value: boolean) => void
  awsAllowTailscaleUdpIngress: boolean
  setAwsAllowTailscaleUdpIngress: (value: boolean) => void
}) {
  if (props.provider === "hetzner") {
    return (
      <SettingsSection
        title="Hetzner Cloud"
        description="Provider-specific settings for Hetzner hosts."
        actions={<Button disabled={props.saving} onClick={props.onSave}>Save</Button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="serverType" help={setupFieldHelp.hosts.hetznerServerType}>
              Server type
            </LabelWithHelp>
            <Input id="serverType" value={props.serverType} onChange={(event) => props.setServerType(event.target.value)} />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="location" help={setupFieldHelp.hosts.hetznerLocation}>
              Location
            </LabelWithHelp>
            <Input id="location" value={props.hetznerLocation} onChange={(event) => props.setHetznerLocation(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <LabelWithHelp htmlFor="image" help={setupFieldHelp.hosts.hetznerImage}>
              Image
            </LabelWithHelp>
            <Input id="image" value={props.hetznerImage} onChange={(event) => props.setHetznerImage(event.target.value)} />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Switch checked={props.hetznerAllowTailscaleUdpIngress} onCheckedChange={props.setHetznerAllowTailscaleUdpIngress} />
            <div className="text-sm text-muted-foreground">{setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}</div>
          </div>
        </div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      title="AWS"
      description="Provider-specific settings for AWS hosts."
      actions={<Button disabled={props.saving} onClick={props.onSave}>Save</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="awsRegion" help={setupFieldHelp.hosts.awsRegion}>
            Region
          </LabelWithHelp>
          <Input id="awsRegion" value={props.awsRegion} onChange={(event) => props.setAwsRegion(event.target.value)} placeholder="us-east-1" />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="awsInstanceType" help={setupFieldHelp.hosts.awsInstanceType}>
            Instance type
          </LabelWithHelp>
          <Input id="awsInstanceType" value={props.awsInstanceType} onChange={(event) => props.setAwsInstanceType(event.target.value)} placeholder="t3.large" />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="awsAmiId" help={setupFieldHelp.hosts.awsAmiId}>
            AMI ID
          </LabelWithHelp>
          <Input id="awsAmiId" value={props.awsAmiId} onChange={(event) => props.setAwsAmiId(event.target.value)} placeholder="ami-0123456789abcdef0" />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="awsVpcId" help={setupFieldHelp.hosts.awsVpcId}>
            VPC ID
          </LabelWithHelp>
          <Input id="awsVpcId" value={props.awsVpcId} onChange={(event) => props.setAwsVpcId(event.target.value)} placeholder="vpc-..." />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="awsSubnetId" help={setupFieldHelp.hosts.awsSubnetId}>
            Subnet ID
          </LabelWithHelp>
          <Input id="awsSubnetId" value={props.awsSubnetId} onChange={(event) => props.setAwsSubnetId(event.target.value)} placeholder="subnet-..." />
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={props.awsUseDefaultVpc} onCheckedChange={props.setAwsUseDefaultVpc} />
          <div className="text-sm text-muted-foreground">{setupFieldHelp.hosts.awsUseDefaultVpc}</div>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={props.awsAllowTailscaleUdpIngress} onCheckedChange={props.setAwsAllowTailscaleUdpIngress} />
          <div className="text-sm text-muted-foreground">{setupFieldHelp.hosts.awsAllowTailscaleUdpIngress}</div>
        </div>
      </div>
    </SettingsSection>
  )
}
