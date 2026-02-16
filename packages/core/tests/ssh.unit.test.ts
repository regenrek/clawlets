import { describe, it, expect } from "vitest";

import {
  looksLikeHcloudSshKeyContents,
  looksLikeSshKeyContents,
  looksLikeSshPrivateKey,
  normalizeHcloudSshPublicKey,
  normalizeSshPublicKey,
  parseSshPublicKeyLine,
  parseSshPublicKeysFromText,
} from "../src/lib/security/ssh";
import { makeEd25519PublicKey } from "./helpers/ssh-keys";

describe("ssh public key parsing", () => {
  it("normalizes common key types", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 1 });
    expect(normalizeSshPublicKey(`${ed25519} test`)).toBe(ed25519);
    expect(
      normalizeSshPublicKey("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= comment"),
    ).toBe("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=");
  });

  it("canonicalizes base64 variants", () => {
    const type = "ecdsa-sha2-nistp256";
    const padded = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=";
    const unpadded = padded.replace(/=+$/, "");
    expect(normalizeSshPublicKey(`${type} ${unpadded} comment`)).toBe(`${type} ${padded}`);
    expect(normalizeSshPublicKey(`${type} ${padded} comment`)).toBe(`${type} ${padded}`);
  });

  it("rejects invalid base64 padding", () => {
    expect(normalizeSshPublicKey("ssh-ed25519 AAAA=== comment")).toBeNull();
    expect(parseSshPublicKeyLine("ssh-ed25519 AAAA=== comment")).toBeNull();
  });

  it("detects key contents vs paths", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 2, comment: "test" });
    expect(looksLikeSshKeyContents(ed25519)).toBe(true);
    expect(looksLikeSshKeyContents("/tmp/id_ed25519.pub")).toBe(false);
  });

  it("parses authorized_keys style options", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 3 });
    const base64 = ed25519.split(/\s+/)[1] ?? "";
    const parsed = parseSshPublicKeyLine(`from="*.example.com",no-pty ${ed25519} user@host`);
    expect(parsed).toEqual({
      type: "ssh-ed25519",
      base64,
    });
  });

  it("extracts multiple keys from text", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 4 });
    const keys = parseSshPublicKeysFromText([
      "# comment",
      "",
      `${ed25519} one`,
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= two",
      "",
    ].join("\n"));
    expect(keys).toEqual([
      ed25519,
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=",
    ]);
  });

  it("validates hcloud-compatible key material", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 7 });
    expect(normalizeHcloudSshPublicKey(`${ed25519} comment`)).toBe(ed25519);
    expect(looksLikeHcloudSshKeyContents(ed25519)).toBe(true);
    expect(normalizeHcloudSshPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7dummy")).toBeNull();
    expect(looksLikeHcloudSshKeyContents("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7dummy")).toBe(false);
  });
});

describe("ssh private key detection", () => {
  it("recognizes private key PEM headers", () => {
    expect(looksLikeSshPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("-----BEGIN PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("ssh-ed25519 AAAA test")).toBe(false);
  });
});
