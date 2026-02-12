import {
  HETZNER_DEFAULT_LOCATION,
  HETZNER_DEFAULT_SERVER_TYPE,
  HETZNER_LOCATIONS,
  HETZNER_SERVER_TYPES,
  type HetznerLocation,
  type HetznerServerType,
} from "@clawlets/core/lib/config/providers/hetzner"
import type { ComponentType, SVGProps } from "react"
import FlagDe from "~icons/flagpack/de"
import FlagFi from "~icons/flagpack/fi"
import FlagSg from "~icons/flagpack/sg"
import FlagUs from "~icons/flagpack/us"

export type HetznerServerTypeOption = {
  value: HetznerServerType
  title: string
  description: string
}

export type HetznerLocationOption = {
  value: HetznerLocation
  title: string
  description: string
  flag: ComponentType<SVGProps<SVGSVGElement>>
}

export const HETZNER_SERVER_TYPE_OPTIONS: readonly HetznerServerTypeOption[] = [
  {
    value: "cpx22",
    title: "Starter: 1 Agent",
    description: "CPX22 (2 vCPU, 4 GB RAM)",
  },
  {
    value: "cpx32",
    title: "Balanced: 2-6 Agents",
    description: "CPX32 (4 vCPU, 8 GB RAM)",
  },
  {
    value: "cpx42",
    title: "Heavy: 6-12 Agents",
    description: "CPX42 (8 vCPU, 16 GB RAM)",
  },
]

export const HETZNER_LOCATION_OPTIONS: readonly HetznerLocationOption[] = [
  { value: "nbg1", title: "Nuremberg", description: "eu-central", flag: FlagDe },
  { value: "fsn1", title: "Falkenstein", description: "eu-central", flag: FlagDe },
  { value: "hel1", title: "Helsinki", description: "eu-central", flag: FlagFi },
  { value: "sin", title: "Singapore", description: "ap-southeast", flag: FlagSg },
  { value: "hil", title: "Hillsboro, OR", description: "us-west", flag: FlagUs },
  { value: "ash", title: "Ashburn, VA", description: "us-east", flag: FlagUs },
]

export const HETZNER_RADIO_CUSTOM_VALUE = "__custom__"
export const HETZNER_SETUP_DEFAULT_SERVER_TYPE = HETZNER_DEFAULT_SERVER_TYPE
export const HETZNER_SETUP_DEFAULT_LOCATION = HETZNER_DEFAULT_LOCATION

export function isKnownHetznerServerType(value: string): value is HetznerServerType {
  return HETZNER_SERVER_TYPES.includes(value as HetznerServerType)
}

export function isKnownHetznerLocation(value: string): value is HetznerLocation {
  return HETZNER_LOCATIONS.includes(value as HetznerLocation)
}
