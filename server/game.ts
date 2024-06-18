import { delay } from "@std/async/delay";

import * as log from "@/logger.ts";
import { GameMessage, ClientMessage } from "@/model.ts";
import { GameState } from "@/game/game_state.ts";

/**
 * Default to a 5 second timer.
 */
const DEFAULT_SLEEP_TIME = 5000.0;

let running = true;
let sleepTime = DEFAULT_SLEEP_TIME;

function gameMain() {
  //
}

async function runLoop(state: GameState, f: () => void) {
  while (running) {
    const start = Date.now();

    f();

    const elapsed = Date.now() - start;
    const sleepDiff = sleepTime - elapsed;
    if (sleepDiff > 0) {
      await delay(sleepDiff);
    } else {
      // Start time dilation
    }
  }
}

async function main() {
  const gameState = new GameState();

  // @ts-ignore - property not properly defined by linter
  self.onmessage = gameState.receiveMessageEvent;

  await runLoop(gameState, gameMain)
}

if (import.meta.main) {
  log.info("worker starting");

  await main();
}