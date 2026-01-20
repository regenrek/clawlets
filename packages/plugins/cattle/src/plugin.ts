import { cattle } from "./commands/cattle.js";

export const plugin = {
  name: "cattle",
  command: cattle,
};

export const command = cattle;
