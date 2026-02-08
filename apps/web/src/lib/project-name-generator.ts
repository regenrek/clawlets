const UINT32_MAX = 0x100000000

export const PROJECT_NAME_ADJECTIVES = [
  "impartial",
  "brisk",
  "lucid",
  "steady",
  "eager",
  "nimble",
  "keen",
  "sturdy",
  "vivid",
  "calm",
  "fierce",
  "resolute",
  "bold",
  "swift",
  "radiant",
] as const

export const PROJECT_NAME_DBZ_TERMS = [
  "saiyan",
  "namekian",
  "kamehameha",
  "capsulecorp",
  "zenkai",
  "kaioken",
  "senzu",
  "potara",
  "fusion",
  "dragonball",
  "spiritbomb",
  "vegeta",
  "piccolo",
  "gohan",
  "trunks",
] as const

function randomIndex(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer")
  }

  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const limit = UINT32_MAX - (UINT32_MAX % maxExclusive)
    const buf = new Uint32Array(1)
    do {
      cryptoApi.getRandomValues(buf)
    } while (buf[0] >= limit)
    return buf[0] % maxExclusive
  }

  return Math.floor(Math.random() * maxExclusive)
}

function pickWord(words: readonly string[]): string {
  if (words.length === 0) throw new Error("project-name dictionary cannot be empty")
  return words[randomIndex(words.length)]
}

export function generateProjectName(): string {
  const adjective = pickWord(PROJECT_NAME_ADJECTIVES)
  const dbzTerm = pickWord(PROJECT_NAME_DBZ_TERMS)
  return `${adjective}-${dbzTerm}`.toLowerCase()
}
