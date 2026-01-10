import { createHash } from "node:crypto";

type HcloudSshKey = {
  id: number;
  name: string;
  public_key: string;
};

type ListSshKeysResponse = {
  ssh_keys: HcloudSshKey[];
};

type CreateSshKeyResponse = {
  ssh_key: HcloudSshKey;
};

async function hcloudRequest<T>(params: {
  token: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}): Promise<{ ok: true; json: T } | { ok: false; status: number; bodyText: string }> {
  const res = await fetch(`https://api.hetzner.cloud/v1${params.path}`, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  if (!res.ok) {
    return { ok: false, status: res.status, bodyText: await res.text() };
  }

  return { ok: true, json: (await res.json()) as T };
}

export async function ensureHcloudSshKeyId(params: {
  token: string;
  name: string;
  publicKey: string;
}): Promise<string> {
  const normalizedKey = params.publicKey.trim();
  const nameBase = params.name.trim();
  const nameHash = createHash("sha256").update(normalizedKey).digest("hex").slice(0, 10);
  const nameHashed = `${nameBase}-${nameHash}`;

  const list = await hcloudRequest<ListSshKeysResponse>({
    token: params.token,
    method: "GET",
    path: "/ssh_keys",
  });
  if (!list.ok) {
    throw new Error(`hcloud list ssh keys failed: HTTP ${list.status}: ${list.bodyText}`);
  }

  const existing = list.json.ssh_keys.find((k) => k.public_key.trim() === normalizedKey);
  if (existing) return String(existing.id);

  const tryCreate = async (name: string) =>
    await hcloudRequest<CreateSshKeyResponse>({
      token: params.token,
      method: "POST",
      path: "/ssh_keys",
      body: { name, public_key: normalizedKey },
    });

  const create = await tryCreate(nameHashed);
  if (create.ok) return String(create.json.ssh_key.id);

  if (create.status === 409) {
    // Name collision or uniqueness constraint: retry with alternate name,
    // then fall back to public_key lookup.
    const createAlt = await tryCreate(`${nameHashed}-2`);
    if (createAlt.ok) return String(createAlt.json.ssh_key.id);

    const listAgain = await hcloudRequest<ListSshKeysResponse>({
      token: params.token,
      method: "GET",
      path: "/ssh_keys",
    });
    if (!listAgain.ok) {
      throw new Error(
        `hcloud list ssh keys failed after 409: HTTP ${listAgain.status}: ${listAgain.bodyText}`,
      );
    }

    const existingAfter409 = listAgain.json.ssh_keys.find(
      (k) => k.public_key.trim() === normalizedKey,
    );
    if (existingAfter409) return String(existingAfter409.id);
  }

  throw new Error(`hcloud create ssh key failed: HTTP ${create.status}: ${create.bodyText}`);
}
