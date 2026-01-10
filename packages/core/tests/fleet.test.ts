import { describe, it, expect } from "vitest";
import { parseBotsFromFleetNix } from "../src/lib/fleet";

describe("fleet", () => {
  it("parses bots list", () => {
    const text = `
      { ... }:
      {
        bots = [ "alpha" "beta" "alpha" ];
      }
    `;
    expect(parseBotsFromFleetNix(text)).toEqual(["alpha", "beta"]);
  });

  it("returns [] when missing", () => {
    expect(parseBotsFromFleetNix("bots = [];")).toEqual([]);
  });
});

