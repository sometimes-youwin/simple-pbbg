import { delay } from "@std/async/delay";

import * as log from "/logger.ts";
import { GameMessage, ClientMessage } from "/model.ts";

/**
 * Default to a 5 second timer.
 */
const DEFAULT_SLEEP_TIME = 5000.0;

let running = true;
let sleepTime = DEFAULT_SLEEP_TIME;

function gameMain() {
  sendMessageEvent({
    type: "SYSTEM",
    payload: "hello"
  });
}

async function runLoop(f: () => void) {
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

function receiveMessageEvent(evt: MessageEvent) {
  const data: ClientMessage.Base = evt.data;
  switch (data.type) {
    case "INTERNAL": {
      handleClientMessageInternal(data as ClientMessage.Internal);
      break;
    }
    case "NONE":
    default: {
      log.error(`unhandled message ${data}`);
      break;
    }
  }
}

function handleClientMessageInternal(m: ClientMessage.Internal) {
  switch (m.command) {
    case "ADD_USER": {
      const data = m as ClientMessage.InternalAddUser;
      const user = data.user;

      break;
    }
    case "REMOVE_USER": {
      break;
    }
    case "NONE":
    default: {
      log.error(`unhandled internal message ${m}`);
      break;
    }
  }
}

function sendMessageEvent(message: GameMessage.Base) {
  // @ts-ignore - property not properly defined by linter
  self.postMessage(message);
}

async function main() {
  // @ts-ignore - property not properly defined by linter
  self.onmessage = receiveMessageEvent

  await runLoop(gameMain)
}

if (import.meta.main) {
  log.info("worker starting");

  await main();
}