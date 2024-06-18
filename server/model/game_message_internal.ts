import { GameMessage } from "@/model.ts";
import { Player } from "@/model.ts";

export type Command =
  "NONE" |
  "SHUTDOWN" |
  "SAVE_SINGLE" |
  "SAVE_ALL";

export type Base = GameMessage.Base & {
  type: "INTERNAL",
  command: Command,
  comment?: string,
};

export type Shutdown = Base & {
  command: "SHUTDOWN",
};

export type SaveSingle = Base & {
  command: "SAVE_SINGLE",
  player: Player,
};

export type SaveAll = Base & {
  command: "SAVE_ALL",
};
