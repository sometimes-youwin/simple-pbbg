import { GameState } from "@/game/game_state.ts";
import { ClientMessage } from "@/model.ts";
import ClientInternal = ClientMessage.Internal;
import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";

Deno.test({
  name: "add remove user",
  fn() {
    const userId = 22;
    const addUser: ClientMessage.Internal.AddUser = {
      type: "INTERNAL",
      command: "ADD_USER",
      user: {
        id: userId,

        username: "test",
        hashedPassword: "test",
        email: "test",

        userRole: "PLAYER",

        verified: false,
        banned: false,

        lastAction: "NONE"
      },
      ownedResources: {
        forId: userId,

        credits: 1,
        dust: 2,
        shards: 3,

        metal: 4,
        elec: 5,
        bio: 6
      },
      actionMetadata: {
        forId: userId,

        battleCount: 1,
        metalCount: 2,
        elecCount: 3,
        bioCount: 4
      }
    };

    const state = new GameState();
    // deno-lint-ignore no-explicit-any
    let receivedMessage: any = null;
    // deno-lint-ignore no-explicit-any
    state.sendMessage = (message: any) => {
      receivedMessage = message;
    };

    // @ts-ignore - fuck you
    state.receiveMessageEvent({
      data: addUser,
    });

    assertEquals(state.players.length, 1);
    assertEquals(state.playerMapping.size, 1);

    assertEquals(state.players[0].user.id, addUser.user.id);
    assertEquals(state.playerMapping.get(userId)?.deref()?.user.id, addUser.user.id);

    const removeUser: ClientInternal.RemoveUser = {
      type: "INTERNAL",
      command: "REMOVE_USER",
      userId,
    };

    // @ts-ignore - fuck you again
    state.receiveMessageEvent({
      data: removeUser
    });

    assertEquals(state.players.length, 0);
    assertEquals(state.playerMapping.size, 0);

    assertEquals(receivedMessage.type, "INTERNAL");
    assertEquals(receivedMessage.command, "SAVE_SINGLE");
    assertEquals(receivedMessage.player.user.id, addUser.user.id);
  }
});