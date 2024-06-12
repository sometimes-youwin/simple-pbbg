import { Database, Statement } from "@db/sqlite";

import * as log from "./logger.ts";

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
   * The database connection.
   */
  db: Database;

  /**
   * Cached prepared statements.
   */
  #preparedStmts = new Map<RawSql, Statement>();
  /**
   * Weird way of implementing an LRU. When statements are cached, the raw sql
   * is also inserted here. When the cache is full, the first element is popped
   * and the corresponding prepared statement is removed.
   */
  #preparedStmtsInsertOrder: RawSql[] = [];
  /**
   * The max amount of prepared statements to cache.
   */
  #preparedStmtCacheMax: number = 128;

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
  #channels = new Map<ChannelId, UserId[]>()

  constructor(db: Database, opts?: AppStateOpts) {
    log.info("creating app state");

    this.db = db;

    if (opts?.preparedStmtCacheMax) {
      this.#preparedStmtCacheMax = opts.preparedStmtCacheMax;
    }

    log.info("created app state");
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
      return this.#prepare(sql);
    }

    let stmt = this.#preparedStmts.get(sql) ?? null;
    if (!stmt) {
      stmt = this.#prepare(sql);
      if (!stmt) {
        return null;
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
    return stmt as Statement;
  }

  addUser(userId: UserId, address: ConnectAddress, ws: WebSocket) {
    log.debug(`adding user ${userId} from address ${address}`);

    this.#wsConnections.set(address, ws);

    const addresses = findOrSetInMap(this.#connectedUsers, userId);
    addresses.push(address);

    ws.onclose = (_ev) => {
      this.#wsConnections.delete(address);

      const addressIdx = addresses.indexOf(address);
      if (addressIdx < 0) {
        log.error(`while cleaning up ws for ${userId} - ${address}, failed to remove user address`);
        return;
      }

      addresses.splice(addressIdx, 1);
    }
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
