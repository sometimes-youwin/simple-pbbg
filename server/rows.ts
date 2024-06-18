import { Database } from "@db/sqlite";

import { AppState } from "@/app_state.ts";
import * as log from "@/logger.ts";
import * as dateUtil from "@/date_util.ts";
import * as auth from "@/auth.ts";

/**
 * Types in this file are purposely mapped 1-to-1 with their sql equivalents.
 * These types should be used as a reference for what the db tables actually
 * look like since the migration sql files can drift after multiple migrations.
 * 
 * Data types are not necessarily indicative of the actual type. SQLite only
 * allows for a few data types by default.
 * 
 * # Errors
 * 
 * All normal row functions will throw errors. Migrations are the only caught
 * errors, since those are, in theory, recoverable.
 * 
 * # NOTE
 * 
 * All types queried from the database follow column null constraints. Therefore,
 * no validation functions should be defined since they are already handled by
 * the database.
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

// export function writeObject<T>(state: AppState, obj: T) {
//   state.prepare()
// }

export const ROOT_USER_ID = 0;
export const SYSTEM_USER_ID = 1;

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

export function userExists(state: AppState, username: string, email: string) {
  const stmt = state.prepare(
    "select * from user where username = ? or email = ?");

  const user = stmt.get<User>(username, email);

  return user ? true : false;
}

export function getUserByUsername(state: AppState, username: string) {
  const stmt = state.prepare("select * from user where username = ? limit 1");

  const user = stmt.get<User>(username);

  return user ?? null;
}

export function getUserById(state: AppState, id: number) {
  const stmt = state.prepare("select * from user where id = ? limit 1");

  const user = stmt.get<User>(id);

  return user ?? null;
}

export function createUser(
  state: AppState,
  username: string,
  hashedPassword: string,
  email: string
) {
  const stmt = state.prepare(`
    insert into user (username, hashedPassword, email)
    values (?, ?, ?)
    returning *;
  `);

  const user = stmt.get<User>(username, hashedPassword, email);

  return user ?? null;
}

export function saveUser(state: AppState, user: User) {
  const stmt = state.prepare(`
    update user
    set lastAction = ?
    where id = ?;
  `);

  stmt.run(user.lastAction, user.id);
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

export const SYSTEM_CHANNEL_ID = 0;
export const GLOBAL_CHANNEL_ID = 1;

export type Channel = {
  id: number,
  forId: number,
  channelName: string,
};

export function createChannel(state: AppState, forId: number, channelName: string) {
  const stmt = state.prepare(`
    insert into channel (forId, channelName)
    values (?, ?)
    returning *;
  `);

  const channel = stmt.get<Channel>(forId, channelName);

  return channel ?? null;
}

export function deleteChannel(state: AppState, channel: Channel) {
  const stmt = state.prepare("delete from channel where id = ?");

  stmt.run(channel.id);
}

export function getChannelByName(state: AppState, channelName: string) {
  const stmt = state.prepare("select * from channel where channelName = ?");

  const channel = stmt.get<Channel>(channelName);

  return channel ?? null;
}

export type ChannelSubscription = {
  forId: number,
  channelId: number,
};

export function createChannelSubscription(state: AppState, userId: number, channelId: number) {
  const stmt = state.prepare(`
    insert into channelSubscription (forId, channelId)
    values (?, ?)
    returning *;
  `);

  const channelSub = stmt.get<ChannelSubscription>(userId, channelId);

  return channelSub ?? null;
}

export function getChannelSubscriptionByUserId(state: AppState, userId: number) {
  const stmt = state.prepare(
    "select * from channelSubscription where forId = ?;");

  const subs = stmt.all<ChannelSubscription>(userId);

  return subs ?? null;
}

export type OwnedResources = {
  forId: number,

  credits: number,
  dust: number,
  shards: number,

  metal: number,
  elec: number,
  bio: number
};

export function createOwnedResources(state: AppState, userId: number) {
  const stmt = state.prepare(`
    insert into ownedResources (forId)
    values (?)
    returning *;
  `);

  const ownedResources = stmt.get<OwnedResources>(userId);

  return ownedResources ?? null;
}

export function getOwnedResources(state: AppState, userId: number) {
  const stmt = state.prepare("select * from ownedResources where forId = ?");

  const ownedResources = stmt.get<OwnedResources>(userId);

  return ownedResources ?? null;
}

export function saveOwnedResources(state: AppState, ownedResources: OwnedResources) {
  const stmt = state.prepare(`
    update ownedResources
    set
      credits = ?,
      dust = ?,
      shards = ?,

      metal = ?,
      elec = ?,
      bio = ?,
    where forId = ?;
  `);

  const {
    credits,
    dust,
    shards,

    metal,
    elec,
    bio,

    forId
  } = ownedResources;

  stmt.run(
    credits,
    dust,
    shards,

    metal,
    elec,
    bio,

    forId,
  );
}

export type ActionMetadata = {
  forId: number,

  battleCount: number,
  metalCount: number,
  elecCount: number,
  bioCount: number
};

export function createActionMetadata(state: AppState, userId: number) {
  const stmt = state.prepare(`
    insert into actionMetadata (forId)
    values (?)
    returning *;
  `);

  const actionMetadata = stmt.get<ActionMetadata>(userId);

  return actionMetadata ?? null;
}

export function getActionMetadata(state: AppState, userId: number) {
  const stmt = state.prepare("select * from actionMetadata where forId = ?");

  const actionMetadata = stmt.get<ActionMetadata>(userId);

  return actionMetadata ?? null;
}

export function saveActionMetadata(state: AppState, actionMetadata: ActionMetadata) {
  const stmt = state.prepare(`
    update actionMetadata
    set
      battleCount = ?,
      metalCount = ?,
      elecCount = ?,
      bioCount = ?
    where forId = ?;
  `);

  const {
    forId,
    battleCount,
    metalCount,
    elecCount,
    bioCount,
  } = actionMetadata;

  stmt.run(
    battleCount,
    metalCount,
    elecCount,
    bioCount,

    forId,
  );
}

export type UserSession = {
  ipAddress: string,
  forId: number,

  sessionId: string,

  createdAt: string,
  lastAccessedAt: string,
}

export function createSessionForUser(
  state: AppState,
  address: string,
  userId: number
) {
  const stmt = state.prepare(`
    insert into userSession (ipAddress, forId, sessionId, createdAt, lastAccessedAt)
    values (?, ?, ?, ?, ?)
    return *;
  `);

  const sessionId = auth.createSessionId();
  const now = dateUtil.now().toISOString();

  const sessionRow = stmt.get<UserSession>(address, userId, sessionId, now, now);

  return sessionRow ?? null;
}

export function getSessionByAddressAndId(
  state: AppState,
  address: string,
  userId: number,
) {
  const stmt = state.prepare(
    "select * from userSession where ipAddress = ? and forId = ? limit 1;");

  const session = stmt.get<UserSession>(address, userId);

  return session ?? null;
}

export function getUserBySession(state: AppState, sessionId: string) {
  const stmt = state.prepare(
    "select * from userSession where sessionId = ? limit 1;");

  const userSession = stmt.get<UserSession>(sessionId);
  if (!userSession) {
    log.error(`no user session found for ${sessionId}`);
    return null;
  }

  const user = getUserById(state, userSession.forId);

  return user ?? null;
}

export function verifySessionId(
  state: AppState,
  sessionId: string,
) {
  const stmt = state.prepare(
    "select * from userSession where sessionId = ?;");

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
    deleteSessionId(state, sessionId);

    return false;
  }

  return true;
}

export function deleteSessionId(state: AppState, sessionId: string) {
  const stmt = state.prepare(
    "delete from userSession where sessionId = ?;");

  stmt.run(sessionId);
}

export function deleteAllSessionsByUserId(state: AppState, userId: number) {
  const stmt = state.prepare(
    "delete from userSession where forId = ?;");

  stmt.run(userId);
}

export function updateSessionLastAccessed(state: AppState, sessionId: string) {
  const stmt = state.prepare(
    "update userSession set lastAccessedAt = ? where sessionId = ?;");

  stmt.run(dateUtil.now().toISOString(), sessionId);
}
