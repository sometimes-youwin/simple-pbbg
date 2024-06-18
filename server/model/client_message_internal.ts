import { ClientMessage } from "@/model.ts";
import * as row from "@/rows.ts";

export type Command =
  "NONE" |
  "ADD_USER" |
  "REMOVE_USER";

export type Base = ClientMessage.Base & {
  type: "INTERNAL",
  command: Command,
};

export type AddUser = Base & {
  command: "ADD_USER",
  user: row.User,
  ownedResources: row.OwnedResources,
  actionMetadata: row.ActionMetadata,
};

export type RemoveUser = Base & {
  command: "REMOVE_USER",
  userId: number,
};
