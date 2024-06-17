import * as rows from "/rows.ts";

export type Type =
  "NONE" |
  "INTERNAL" |
  "CONNECT" |
  "DISCONNECT";

export type Base = {
  type: Type,
  [key: string]: unknown
};

export type InternalCommand =
  "NONE" |
  "ADD_USER" |
  "REMOVE_USER";

export type Internal = Base & {
  type: "INTERNAL",
  command: InternalCommand,
};

export type InternalAddUser = Internal & {
  user: rows.User,
};

export type InternalRemoveUser = Internal;

export type External = Base & {
  userId: number,
};

export type Connect = External & {
  type: "CONNECT",
};

export type Disconnect = External & {
  type: "DISCONNECT"
};
