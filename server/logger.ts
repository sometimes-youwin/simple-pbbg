// deno-lint-ignore-file no-explicit-any

import * as log from "https://deno.land/std@0.224.0/log/mod.ts";
import { AppConfig } from "@/model.ts";

export function setup(config: AppConfig) {
  // TODO will probably need more configuration in the future
  // https://medium.com/deno-the-complete-reference/using-logger-in-deno-44c5b2372bf3
  const logLevel = config.quiet ? "ERROR" : config.verbose ? "DEBUG" : "INFO";
  log.setup({
    handlers: {
      default: new log.ConsoleHandler(
        logLevel,
        {
          useColors: true,
          formatter: (record) => {
            return `[${record.levelName}] ${record.datetime.toISOString()} ${record.msg}`;
          }
        }
      )
    },
    loggers: {
      default: {
        level: logLevel,
        handlers: ["default"],
      }
    }
  });
}

export function info(...args: any[]) {
  log.info(args)
}

export function warn(...args: any[]) {
  log.warn(args);
}

export function error(...args: any[]) {
  log.error(args);
}

export function debug(...args: any[]) {
  log.debug(args);
}
