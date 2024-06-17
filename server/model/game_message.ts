export type Type =
  "NONE" |
  "INTERNAL" |
  "SYSTEM" |
  "GLOBAL";

export type Base = {
  type: Type,
  [key: string]: unknown,
}

export type InternalCommand =
  "NONE" |
  "SHUTDOWN";

export type Internal = Base & {
  type: "INTERNAL",
  command: InternalCommand,
  comment: string,
};

export type System = Base & {
  type: "SYSTEM",
  message: string
};

export type Global = Base & {
  type: "GLOBAL",
  message: string
}
