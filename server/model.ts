import { Body } from "jsr:@oak/oak@^16.1.0/body";

import * as log from "@/logger.ts";
import * as row from "@/rows.ts";

export * as GameMessage from "@/model/game_message.ts";
export * as ClientMessage from "@/model/client_message.ts";

/**
 * Configuration for the app.
 */
export type AppConfig = {
  /**
   * Enable debug logging. Overridden by quiet if quiet is true.
   */
  verbose: boolean,
  /**
   * Supress all logs except for errors. Overrides verbose if defined.
   */
  quiet: boolean,
  /**
   * The port to serve the application on. Defaults to 42069.
   */
  port: number,
  /**
   * The path to a sqlite database. Defaults to `pbbg.db`. If set to `:memory:`,
   * then no db file is created.
   */
  dbPath: string,

  testing: boolean,
};

/**
 * Parses commandline args into a config.
 * @returns The parsed config.
 */
export function parseArgs(): AppConfig {
  const args = Deno.args;
  const verbose = args.includes("-v") || args.includes("--verbose");
  const quiet = args.includes("-q") || args.includes("--quiet");
  let port = 42069;
  {
    const idx = args.findIndex((v) => v === "-p" || v === "--port");
    if (idx > -1 && idx < args.length) {
      port = parseInt(args[idx]);
    }
  }
  let dbPath = "pbbg.db";
  {
    const idx = args.findIndex((v) => v === "-db" || v === "--database");
    if (idx > -1 && idx < args.length) {
      dbPath = args[idx];
    }
  }

  const testing = args.includes("--testing");

  return { verbose, quiet, port, dbPath, testing };
}

export type ApiErrorType =
  "NONE" |

  "LOGIN" |
  "REGISTER" |
  "WEBSOCKET";

export type ApiError = {
  type: ApiErrorType,
  path: string,
  message?: string,
  [key: string]: unknown
}

export function apiErrorString(input: ApiError): string {
  return JSON.stringify(input);
}

export async function tryParseJson<T>(body: Body) {
  try {
    const out: T = await body.json();
    return out;
  } catch (e) {
    log.error(e);
    return null;
  }
}

/**
 * Verifies that a given object contains the given fields. If a field is missing,
 * that field is returned otherwise null.
 * @param obj The object to validate.
 * @param fields The expected fields.
 * @returns The missing field or null.
 */
function validateModelInner<T extends object>(obj: T, fields: string[]) {
  for (const field of fields) {
    if (!Object.hasOwn(obj, field)) {
      return field;
    }
  }

  return null;
}

export type RegisterRequest = {
  username: string,
  password: string,
  email: string,
};

export function validateRegisterRequest(req: RegisterRequest) {
  return validateModelInner(req, [
    "username",
    "password",
    "email"
  ]);
}

export type LoginRequest = {
  username: string,
  password: string,
};

export function validateLoginRequest(req: LoginRequest) {
  return validateModelInner(req, [
    "username",
    "password"
  ]);
}

export type Player = {
  user: row.User,
  ownedResources: row.OwnedResources,
  actionMetadata: row.ActionMetadata,
};
