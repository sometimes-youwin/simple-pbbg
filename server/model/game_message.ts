export * as Internal from "@/model/game_message_internal.ts";

export type Type =
  "NONE" |
  "INTERNAL" |
  "SYSTEM" |
  "GLOBAL";

export type Base = {
  type: Type,
  [key: string]: unknown,
};

export type System = Base & {
  type: "SYSTEM",
  message: string
};

export type Global = Base & {
  type: "GLOBAL",
  message: string
};
