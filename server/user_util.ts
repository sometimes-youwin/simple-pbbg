import { AppState } from "/app_state.ts";
import * as rows from "/rows.ts";
import * as log from "/logger.ts";

export type CreateUserOutput = {
  user: rows.User,
  channelSubs: rows.ChannelSubscription[],
  ownedResources: rows.OwnedResources,
  actionMetadata: rows.ActionMetadata,
};

export function createUser(
  state: AppState,
  username: string,
  hashedPassword: string,
  email: string
) {
  log.debug(`creating new user ${username}`);

  try {
    const res = state.db.transaction((): CreateUserOutput => {
      const user = rows.createUser(state, username, hashedPassword, email);
      if (!user) {
        throw new Error("user null");
      }

      const systemChannelSub = rows.createChannelSubscription(
        state, user.id, rows.SYSTEM_CHANNEL_ID);
      if (!systemChannelSub) {
        throw new Error("system channel sub null")
      }
      const globalChannelSub = rows.createChannelSubscription(
        state, user.id, rows.GLOBAL_CHANNEL_ID);
      if (!globalChannelSub) {
        throw new Error("global channel sub null");
      }

      const ownedResources = rows.createOwnedResources(state, user.id);
      if (!ownedResources) {
        throw new Error("owned resources null");
      }

      const actionMetadata = rows.createActionMetadata(state, user.id);
      if (!actionMetadata) {
        throw new Error("action metadata null");
      }

      return {
        user,
        channelSubs: [
          systemChannelSub,
          globalChannelSub
        ],
        ownedResources,
        actionMetadata
      };
    })();

    return res;
  } catch (err) {
    log.error(`unable to create user - ${err}`);
    return null;
  }
}

export function getAll(state: AppState, userId: number) {
  log.debug(`getting all data for ${userId}`);

  // TODO stub
}
