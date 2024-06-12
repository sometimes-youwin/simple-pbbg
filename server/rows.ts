import { Database } from "@db/sqlite";

import { AppState } from "./app_state.ts";
import * as log from "./logger.ts";
import * as dateUtil from "./date_util.ts";
import * as auth from "./auth.ts";

/**
 * Types in this file are purposely mapped 1-to-1 with their sql equivalents.
 * These types should be used as a reference for what the db tables actually
 * look like since the migration sql files can drift after multiple migrations.
 * 
 * Data types are not necessarily indicative of the actual type. SQLite only
 * allows for a few data types by default.
 */

/**
 * Apply migrations if they have not been applied yet.
 * @param db The database to run migrations against.
 * @param dbAlreadyExists A new database will need to have a migration table manually created.
 */
export function applyMigrations(db: Database, dbAlreadyExists: boolean) {
  log.info("applying migrations");

  type MigrationFile = {
    idx: number,
    path: string;
  };

  const MIGRATION_DIR = "./migrations";

  log.debug(`reading migrations from ${Deno.cwd() + MIGRATION_DIR}`);

  const files: MigrationFile[] = [];
  try {
    for (const dir of Deno.readDirSync(MIGRATION_DIR)) {
      if (dir.isDirectory || dir.isSymlink) {
        continue;
      }

      const fileName = dir.name;
      const splitFileName = fileName.split("_", 2);
      if (splitFileName.length !== 2) {
        log.error(`failed to split ${fileName}`);
        return;
      }

      const migration_idx = parseInt(splitFileName[0]);
      if (isNaN(migration_idx)) {
        log.error(`unable to get idx for ${fileName}`);
        return;
      }

      files.push({
        idx: migration_idx,
        path: `${MIGRATION_DIR}/${fileName}`
      });
    }
  } catch (err) {
    log.error(`failed to apply migrations ${err}`);
  }

  if (files.length < 1) {
    throw new Error(`${Deno.cwd() + MIGRATION_DIR} was empty`);
  }

  files.sort((a, b) => a.idx - b.idx);

  /**
   * Helper function for safety reading a file while catching errors. 
   * @param path The path to read from.
   * @returns The contents of the file or null.
   */
  function readFile(path: string): string | null {
    try {
      return Deno.readTextFileSync(path);
    } catch (err) {
      log.error(`unable to read file from path ${path} - ${err}`);
      return null;
    }
  }

  const datetime = dateUtil.now().toISOString();

  if (!dbAlreadyExists) {
    log.debug("creating migration table");

    // Guaranteed to not be empty
    const file = files.shift() as MigrationFile;
    const content = readFile(file.path);
    if (!content) {
      log.error("unable to create migration table");
      return;
    }

    try {
      db.exec(content);
    } catch (err) {
      log.error(`failed to execute sql to create migration table - ${err}`);
      return;
    }

    // Hardcoded sql is necessary here since we cannot prepare any statements
    // involving the migration table until after it has been created
    try {
      db.exec(
        "insert into migration (migrationName, appliedAt) values (?, ?)",
        file.path,
        datetime
      );
    } catch (err) {
      log.error(`failed to log the creation of the migration table, db is corrupt - ${err}`);
      return;
    }
  }

  const migrationAlreadyApplied = db.prepare("select * from migration where migrationName = ?");
  const writeMigrationApplied = db.prepare(`
    insert into migration (migrationName, appliedAt)
    values (?, ?);
  `);

  for (const file of files) {
    log.debug(`processing migration ${file.path}`);

    const migration = migrationAlreadyApplied.get<Migration>(file.path);
    if (migration) {
      log.debug(`migration ${file.path} has already been applied`);
      continue;
    }

    log.info(`applying migration ${file.path}`);

    const content = readFile(file.path);
    if (!content) {
      log.error(`unable to read migration from ${file.path}`);
      return;
    }

    try {
      db.exec(content);
    } catch (err) {
      log.error(`failed to run migration ${file.path} - ${err}`);
      return;
    }

    try {
      writeMigrationApplied.run(file.path, datetime);
    } catch (err) {
      log.error(`unable to write to db that ${file.path} was applied, db is corrupt - ${err}`);
      return;
    }

    log.info(`applied migration ${file.path}`);
  }

  log.debug("the following migrations are applied to the database");
  const output = db.prepare("select * from migration order by id").all<Migration>();
  for (const i of output) {
    log.debug(`${i.id} ${i.migrationName} at ${i.appliedAt}`);
  }

  log.info("finished applying migrations");
}

export type Migration = {
  id: number,
  migrationName: string,
  appliedAt: string,
};

export function findMigrationById(state: AppState, id: number) {
  const stmt = state.prepare("select * from migration where id = ?");
  if (!stmt) {
    return null;
  }

  return stmt.get<Migration>(id);
}

export type User = {
  id: number,

  username: string,
  hashedPassword: string,
  email: string,

  userRole: UserRole,

  verified: boolean,
  banned: boolean,

  lastAction: LastAction,
};

/**
 * Not quite RBAC. Each user can have 1 role only.
 */
export type UserRole =
  /**
   * An invalid role.
   */
  "NONE" |
  /**
   * The root account. Anything done by this role is completely unchecked.
   */
  "ROOT" |
  /**
   * The game account. Everything done by this role is controlled by the game.
   */
  "SYSTEM" |
  /**
   * Most users will have this role. Used for playing the game but does not
   * have access to any dangerous commands.
   */
  "PLAYER" |
  /**
   * A user with access to additional options to help moderate the game.
   */
  "MODERATOR" |
  /**
   * A user with essentially root access. Some actions, like raw sql access,
   * are not available.
   */
  "ADMIN";

/**
 * The last action the user was taking. Used if the client disconnects and
 * reconnects.
 */
export type LastAction = "NONE" | "BATTLE" | "METAL_SCRAP" | "ELEC_SCRAP" | "BIO_SCRAP";

export function getUserByUsername(state: AppState, username: string) {
  const stmt = state.prepare("select * from user where username = ? limit 1");
  if (!stmt) {
    log.error("unable to create prepared statement to get user by username");
    return null;
  }

  const user = stmt.get<User>(username);

  return user ?? null;
}

export function getUserById(state: AppState, id: number) {
  const stmt = state.prepare("select * from user where id = ? limit 1");
  if (!stmt) {
    log.error("unable to create prepared statement to get user by id")
    return null;
  }

  const user = stmt.get<User>(id);

  return user ?? null;
}

export type ServerLog = {
  id: number,

  logType: LogType,
  createdAt: string,
  content: string,

  involvedId: number,
  involvedType: InvolvedType
}

export type LogType =
  "NONE" |
  "SERVER" |
  "ADMIN" |
  "USER" |
  "CHANNEL" |
  "MARKET";

export type InvolvedType = "NONE" | "USER" | "CHANNEL";

export type Channel = {
  id: number,
  forId: number,
  channelName: string,
};

export type ChannelSubscription = {
  forId: number,
  channelId: number,
};

export type OwnedResources = {
  forId: number,

  credits: number,
  dust: number,
  shards: number,

  metal: number,
  elec: number,
  bio: number
};

export type UserSession = {
  ipAddress: string,
  forId: number,

  sessionId: string,

  createdAt: string,
  lastAccessedAt: string,
}

export async function createSessionForUser(
  state: AppState,
  address: string,
  userId: number
) {
  const stmt = state.prepare(`
    insert into userSession (ipAddress, forId, sessionId, createdAt, lastAccessedAt)
    values (?, ?, ?, ?, ?)
  `);
  if (!stmt) {
    log.error(`unable to create new session for ${userId} - ${address}`);
    return null;
  }

  const sessionId = await auth.createSessionId();
  const now = dateUtil.now().toISOString();

  stmt.run(address, userId, sessionId, now, now);

  return sessionId;
}

export function getSessionByAddressAndId(
  state: AppState,
  address: string,
  userId: number,
) {
  const stmt = state.prepare(
    "select * from userSession where ipAddress = ? and forId = ? limit 1");
  if (!stmt) {
    log.error("unable to prepare sql statement to get user session by address and user id");
    return null;
  }

  const session = stmt.get<UserSession>(address, userId);

  return session ?? null;
}

export function verifySessionId(
  state: AppState,
  sessionId: string,
) {
  const stmt = state.prepare(
    "select * from userSession where sessionId = ?");
  if (!stmt) {
    log.error("unable to prepare sql statement to get user session by session id");
    return false;
  }

  const session = stmt.get<UserSession>(sessionId);
  if (!session) {
    log.error(`no session found`);
    return false;
  }

  const createdAt = new Date(session.createdAt);
  if (isNaN(createdAt.getTime())) {
    log.error(`session created at ${session.createdAt} is invalid (NaN)`);
    return false;
  }

  const diffInHours = dateUtil.timeBetween(
    "HOURS", createdAt, dateUtil.now());

  if (diffInHours > 24) {
    // TODO
  }

  return true;
}

export function updateSessionLastAccessed(state: AppState, sessionId: string) {
  const stmt = state.prepare(
    "update userSession set lastAccessedAt = ? where sessionId = ?");
  if (!stmt) {
    log.error(
      "unable to prepare sql statement to update user session last accessed date");
    return false;
  }

  stmt.run(dateUtil.now().toISOString(), sessionId);

  return true;
}
