import { Database, Statement } from "@db/sqlite";

import * as log from "@/logger.ts";
import * as row from "@/rows.ts";
import { AppConfig, ClientMessage, GameMessage, } from "@/model.ts";

type RawSql = string;

type ConnectAddress = string;

type UserId = number;

type ChannelId = number;

export type AppStateOpts = {
  preparedStmtCacheMax?: number;
};

export type AppStatePrepareOpts = {
  cache?: boolean;
};

/**
 * Holds global application state.
 */
export class AppState {
  /**
   * The parsed application config.
   */
  config: AppConfig;

  /**
   * The database connection.
   */
  db: Database;

  /**
   * The actual game that is running on a background thread.
   */
  gameWorker: Worker;

  /**
   * Cached prepared statements.
   */
  #preparedStmts = new Map<RawSql, SafeStatement>();
  /**
   * Weird way of implementing an LRU. When statements are cached, the raw sql
   * is also inserted here. When the cache is full, the first element is popped
   * and the corresponding prepared statement is removed.
   */
  #preparedStmtsInsertOrder: RawSql[] = [];
  /**
   * The max amount of prepared statements to cache.
   */
  #preparedStmtCacheMax: number = 64;

  /**
   * Active websocket connections. Tracks every active connection.
   */
  #wsConnections = new Map<ConnectAddress, WebSocket>();
  /**
   * Connected users. Users may connect multiple times from multiple addresses.
   */
  #connectedUsers = new Map<UserId, ConnectAddress[]>();
  /**
   * The channels a user is subscribed to.
   */
  #userChannels = new Map<UserId, ChannelId[]>();
  /**
   * Chat channels with a list of users subscribed to that channel.
   */
  #channels = new Map<ChannelId, UserId[]>();

  constructor(config: AppConfig, db: Database, gameWorker: Worker, opts?: AppStateOpts) {
    log.info("creating app state");

    this.config = config;
    this.db = db;
    this.gameWorker = gameWorker;
    this.gameWorker.onmessage = (evt) => this.#handleGameMessage(evt);

    if (opts?.preparedStmtCacheMax) {
      this.#preparedStmtCacheMax = opts.preparedStmtCacheMax;
    }

    this.#channels.set(row.SYSTEM_CHANNEL_ID, []);
    this.#channels.set(row.GLOBAL_CHANNEL_ID, []);

    log.info("created app state");
  }

  #handleGameMessage(evt: MessageEvent) {
    const data: GameMessage.Base = evt.data;
    switch (data.type) {
      case "INTERNAL": {
        this.#handleInternalMessage(data as GameMessage.Internal.Base);
        break;
      }
      case "SYSTEM": {
        this.sendChannel(row.SYSTEM_CHANNEL_ID, (data as GameMessage.System).message ?? "empty system message");
        break;
      }
      case "NONE":
      default: {
        log.error(`unhandled game message ${data}`);
        break;
      }
    }
  }

  #handleInternalMessage(m: GameMessage.Internal.Base) {
    switch (m.command) {
      case "SAVE_SINGLE": {
        // TODO
        break;
      }
      case "SHUTDOWN": {
        this.shutdown();
        break;
      }
      case "NONE":
      default: {
        log.error(`unhandled internal message ${m}`);
        break;
      }
    }
  }

  /**
   * Forwards a message from a connected client websocket to the game.
   * @param message The parsed message.
   */
  forwardClientMessage(message: ClientMessage.Base) {
    this.gameWorker.postMessage(message);
  }

  /**
   * Inner function to safely try to prepare a statement.
   * @param sql The sql to prepare.
   * @returns The prepared statement or null.
   */
  #prepare(sql: string) {
    try {
      return this.db.prepare(sql);
    } catch (err) {
      log.error(`failed to prepare sql - ${err}`);
      return null;
    }
  }

  /**
   * Created a prepared statement and cache it for future use.
   * @param sql The sql to prepare.
   * @param opts Options to use when generating the prepared statement.
   * @returns The prepared statement or null if an error occurred.
   */
  prepare(sql: string, opts?: AppStatePrepareOpts) {
    if (!opts?.cache) {
      return new SafeStatement(this.#prepare(sql));
    }

    let stmt = this.#preparedStmts.get(sql) ?? null;
    if (!stmt) {
      stmt = new SafeStatement(this.#prepare(sql));
      if (!stmt.stmt) {
        return stmt;
      }

      this.#preparedStmts.set(sql, stmt);
      this.#preparedStmtsInsertOrder.push(sql);

      if (this.#preparedStmtsInsertOrder.length > this.#preparedStmtCacheMax) {
        // Guaranteed to exist since we literally just checked the size in the if-statement
        const front = this.#preparedStmtsInsertOrder.shift() as string;
        if (!this.#preparedStmts.delete(front)) {
          console.error(`failed to delete ${front} from cached prepared statements`);
        }
      }
    }

    // Guaranteed to exist since the statement is created if it does not exist
    return stmt as SafeStatement;
  }

  addUser(user: row.User, address: ConnectAddress, ws: WebSocket) {
    log.debug(`adding user ${user.id} from address ${address}`);

    this.#wsConnections.set(address, ws);

    const addresses = findOrSetInMap(this.#connectedUsers, user.id);
    addresses.push(address);

    ws.onclose = (_ev) => {
      this.#wsConnections.delete(address);

      const addressIdx = addresses.indexOf(address);
      if (addressIdx < 0) {
        log.error(`while cleaning up ws for ${user.id} - ${address}, failed to remove user address`);
        return;
      }

      addresses.splice(addressIdx, 1);
    }

    // TODO subscribe user to channels
    const channelSubscriptions = row.getChannelSubscriptionByUserId(this, user.id);
    if (!channelSubscriptions) {
      // TODO stub
      return;
    }

    const ownedResources = row.getOwnedResources(this, user.id);
    if (!ownedResources) {
      // TODO stub
      return;
    }

    const actionMetadata = row.getActionMetadata(this, user.id);
    if (!actionMetadata) {
      // TODO stub
      return;
    }

    const internalMessage: ClientMessage.Internal.AddUser = {
      type: "INTERNAL",
      command: "ADD_USER",
      user,
      ownedResources,
      actionMetadata,
    };

    this.forwardClientMessage(internalMessage);
  }

  /**
   * Completely log out a user. This will remove all ws connections. This
   * method can be used to cleanup a partially cleaned up user.
   * 
   * Try not to call this on an already logged out user, since new arrays will
   * be created and then immediately deleted resulting in wasted cpu cycles.
   * 
   * # Note
   * All referenced arrays _should_ exist if the user was able to login, so
   * we _probably_ aren't allocating new arrays (unless the user was already
   * logged out).
   * 
   * @param userId The user to log out.
   */
  logoutUser(userId: UserId) {
    log.debug(`logging out user ${userId}`);

    const userChannels = findOrSetInMap(this.#userChannels, userId);
    for (const userChannel of userChannels) {
      const channel = findOrSetInMap(this.#channels, userChannel);
      const userIdx = channel.indexOf(userId);
      if (userIdx < 0) {
        log.error(`user ${userId} was not part of channel ${userChannel}`);
        continue;
      }

      channel.splice(userIdx, 1);
    }
    this.#userChannels.delete(userId);

    const addresses = findOrSetInMap(this.#connectedUsers, userId);
    for (const address of addresses) {
      this.#wsConnections.delete(address);
    }
    this.#connectedUsers.delete(userId);
  }

  addUserToChannel(userId: UserId, channelId: ChannelId) {
    log.debug(`adding user ${userId} to channel ${channelId}`);

    const channelSubs = findOrSetInMap(this.#channels, channelId);
    channelSubs.push(userId);
    const userChannels = findOrSetInMap(this.#userChannels, userId);
    userChannels.push(channelId);
  }

  removeUserFromChannel(userId: UserId, channelId: ChannelId) {
    log.debug(`removing user ${userId} from channel ${channelId}`);

    const channelSubs = this.#channels.get(channelId);
    if (channelSubs) {
      const userIdx = channelSubs.indexOf(userId);
      if (userIdx === undefined) {
        log.error(`tried to remove user ${userId} from channel ${channelId} but user not found`);
        return;
      }

      channelSubs.splice(userIdx, 1);
    } else {
      log.error(`tried to remove user ${userId} from nonexistent channel ${channelId}`);
    }
  }

  /**
   * Send a message to a given user on all their addresses. Invalid addresses
   * are automatically cleaned up from all relevant arrays.
   * @param userId The user to send to.
   * @param message The message to send.
   * @returns If the message was sent successfully.
   */
  sendUser(userId: UserId, message: string) {
    const addresses = this.#connectedUsers.get(userId);
    if (addresses) {
      const invalidAddresses: string[] = [];
      for (const address of addresses) {
        const ws = this.#wsConnections.get(address);
        if (!ws) {
          log.error(`address ${address} is invalid`);
          invalidAddresses.push(address);
          continue;
        }

        ws.send(message);
      }

      for (const invalidAddress of invalidAddresses) {
        this.#wsConnections.delete(invalidAddress);
      }
      this.#connectedUsers.set(
        userId,
        addresses.filter((v) => !(invalidAddresses.includes(v)))
      );

      return true;
    } else {
      log.error(`user ${userId} not found`);
      return false;
    }
  }

  /**
   * Send a message to a given channel. Invalid users are automatically
   * cleaned up from all relevant arrays.
   * @param channelId The channel to send to.
   * @param message The message to send.
   * @returns If the message was sent successfully.
   */
  sendChannel(channelId: ChannelId, message: string) {
    const userIds = this.#channels.get(channelId);
    if (userIds) {
      const invalidUsers: number[] = [];
      for (const userId of userIds) {
        if (!this.sendUser(userId, message)) {
          invalidUsers.push(userId);
        }
      }

      // NOTE do not need to cleanup actual user connections since that's
      // handled in the sendUser func
      this.#channels.set(
        channelId,
        userIds.filter((v) => !(invalidUsers.includes(v)))
      );

      return true;
    } else {
      log.error(`channel ${channelId} does not exist`);
      return false;
    }
  }

  shutdown() {
    // TODO stub

    this.gameWorker.terminate();
    Deno.exit();
  }
}

/**
 * Utility function to get a value from a map that may not already exist.
 * @param map The map to check.
 * @param key The key in the map.
 * @returns The value in the map that might be newly created.
 */
function findOrSetInMap(map: Map<UserId, ConnectAddress[]>, key: UserId): ConnectAddress[];
function findOrSetInMap(map: Map<UserId, ChannelId[]>, key: UserId): ChannelId[];
function findOrSetInMap(map: Map<ChannelId, UserId[]>, key: ChannelId): UserId[];
function findOrSetInMap<T>(map: Map<UserId | ChannelId, T[]>, key: UserId | ChannelId): T[] {
  let found = map.get(key);
  if (found) {
    return found;
  } else {
    found = []
    map.set(key, found);
  }

  return found;
}

/**
 * Wrapper for a sql statement that handles improperly prepared statements.
 */
class SafeStatement {
  stmt: Statement | null;

  constructor(stmt: Statement | null) {
    this.stmt = stmt;
  }

  // deno-lint-ignore no-explicit-any
  run(...args: any[]) {
    if (this.stmt) {
      try {
        return this.stmt.run(args);
      } catch (err) {
        log.error(err);
      }
    }

    return 0;
  }

  // deno-lint-ignore no-explicit-any
  get<T extends Record<string, unknown>>(...args: any[]) {
    if (this.stmt) {
      try {
        return this.stmt.get<T>(args) ?? null;
      } catch (err) {
        log.error(err);
      }
    }

    return null;
  }

  // deno-lint-ignore no-explicit-any
  all<T extends Record<string, unknown>>(...args: any[]) {
    if (this.stmt) {
      try {
        return this.stmt.all<T>(args);
      } catch (err) {
        log.error(err);
      }
    }

    return null
  }
}
