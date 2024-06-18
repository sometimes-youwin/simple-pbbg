export * as Internal from "@/model/client_message_internal.ts";

export type Type =
  "NONE" |
  "INTERNAL" |
  "CONNECT" |
  "DISCONNECT";

export type Base = {
  type: Type,
  [key: string]: unknown
};

export type External = Base & {
  userId: number,
};

export type Connect = External & {
  type: "CONNECT",
};

export type Disconnect = External & {
  type: "DISCONNECT"
};
