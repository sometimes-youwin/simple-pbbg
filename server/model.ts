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

  return { verbose, quiet, port, dbPath };
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

export type RegisterRequest = {
  username: string,
  password: string,
  email: string,
};

export type LoginRequest = {
  username: string,
  password: string,
};

type Message = {
  type: string;
};

export type ClientMessageChat = Message & {
  content: string;
};

export type GameMessageChat = Message & {
  from: string,
  target: string,
  content: string,
};

