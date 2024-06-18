import * as log from "@/logger.ts";
import { ClientMessage, GameMessage, Player } from "@/model.ts";
// deno-lint-ignore no-unused-vars
import GameInternal = GameMessage.Internal;
// deno-lint-ignore no-unused-vars
import ClientInternal = ClientMessage.Internal;

export class GameState {
  players: Player[] = [];
  playerMapping: Map<number, WeakRef<Player>> = new Map();

  constructor() {

  }

  tick() {
    for (const player of this.players) {
      log.debug(player);

      const {
        user,
        actionMetadata,
        ownedResources
      } = player;

      switch (user.lastAction) {
        case "BATTLE": {
          actionMetadata.battleCount += 1;
          break;
        }
        case "METAL_SCRAP": {
          actionMetadata.metalCount += 1;
          break;
        }
        case "ELEC_SCRAP": {
          actionMetadata.elecCount += 1;
          break;
        }
        case "BIO_SCRAP": {
          actionMetadata.bioCount += 1;
          break;
        }
        case "NONE": {
          // Intentionally do nothing
          break;
        }
        default: {
          log.error(`unhandled player action ${player}`);
          user.lastAction = "NONE";
          break;
        }
      }
    }
  }

  receiveMessageEvent(evt: MessageEvent) {
    const data: ClientMessage.Base = evt.data;
    switch (data.type) {
      case "INTERNAL": {
        this.#handleClientMessageInternal(data as ClientInternal.Base);
        break;
      }
      case "NONE":
      default: {
        log.error(`unhandled client message ${data}`);
        break;
      }
    }
  }

  sendMessage(message: GameMessage.Base) {
    // @ts-ignore - property not properly defined by linter
    self.postMessage(message);
  }

  #handleClientMessageInternal(m: ClientInternal.Base) {
    switch (m.command) {
      case "ADD_USER": {
        this.#addUser(m as ClientInternal.AddUser);
        break;
      }
      case "REMOVE_USER": {
        const player = this.#removeUser(m as ClientInternal.RemoveUser);
        if (!player) {
          const systemMessage: GameMessage.System = {
            type: "SYSTEM",
            message: "remove player failed, major bug encountered"
          };

          this.sendMessage(systemMessage);
          return;
        }

        const systemMessage: GameInternal.SaveSingle = {
          type: "INTERNAL",
          command: "SAVE_SINGLE",
          player: player,
        };

        this.sendMessage(systemMessage);
        break;
      }
      case "NONE":
      default: {
        log.error(`unhandled internal client message ${m}`);
        break;
      }
    }
  }

  #addUser(m: ClientInternal.AddUser) {
    const { user, ownedResources, actionMetadata } = m;
    const player = {
      user,
      ownedResources,
      actionMetadata
    };

    this.players.push(player);
    this.playerMapping.set(m.user.id, new WeakRef(player));
  }

  #removeUser(m: ClientInternal.RemoveUser) {
    const playerRef = this.playerMapping.get(m.userId);
    if (!playerRef) {
      log.error(`tried to remove non-existent player ${m}`);
      return null;
    }

    const player = playerRef.deref();
    if (!player) {
      log.error(`player ref was already deleted ${m}`);
      return null;
    }

    const idx = this.players.indexOf(player);
    if (idx < 0) {
      log.error(`player not found in cache ${m}`);
      return null;
    }

    const removed = this.players.splice(idx, 1);
    if (removed.length !== 1) {
      log.error(`removed unexpected amount of players ${removed} for ${m}`);
      return null;
    }
    this.playerMapping.delete(m.userId);

    return player;
  }
}