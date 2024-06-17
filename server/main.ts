import { Application, isErrorStatus, isHttpError } from "@oak/oak";
import { Router } from "@oak/oak/router";
import { Database, Statement } from "@db/sqlite";
import { existsSync } from "jsr:@std/fs@^0.221.0/exists";

import { AppConfig, LoginRequest, RegisterRequest, apiErrorString, parseArgs, tryParseJson, validateLoginRequest, validateRegisterRequest } from "/model.ts";
import * as rows from "/rows.ts";
import { User, applyMigrations } from "/rows.ts";
import { AppState } from "/app_state.ts";
import * as log from "/logger.ts";
import * as auth from "/auth.ts";
import { createUser } from "/user_util.ts";

const APP_NAME = "Simple PBBG";
const VERSION = "0.1.0";

/**
 * Global application state. This pattern kind of sucks, but is easier to reason
 * about than dealing with context type hell.
 */
let appState: AppState;

/**
 * Initialize the application router.
 * 
 * # Note
 * Whenever a context error is thrown, the route will also return afterwards.
 * This is completely redundant. However, the TS compiler is not able to infer
 * the throw, so we force it to understand by explicitly returning.
 * 
 * @param router The router to configure.
 * @param config The config to read.
 */
function initRouter(router: Router, config: AppConfig) {
  log.info("initializing router");

  if (config.testing) {
    // TODO add testing endpoints
  }

  router.get("/", async (ctx) => {
    await ctx.send({
      root: `${Deno.cwd()}/static`,
      path: "index.html"
    });
  });

  router.get("/game", async (ctx) => {
    const cookies = ctx.cookies;
    const existingSession = await cookies.get(auth.SESSION_COOKIE_KEY);
    if (!existingSession) {
      ctx.response.redirect("/");
      await cookies.set(auth.SESSION_COOKIE_KEY, "missing");
      return;
    }

    if (!rows.verifySessionId(appState, existingSession)) {
      ctx.response.redirect("/");
      await cookies.set(auth.SESSION_COOKIE_KEY, "invalid");
      return;
    }

    await ctx.send({
      root: `${Deno.cwd()}/static`,
      path: "game.html"
    });
  });

  router.post("/register", async (ctx) => {
    const req = ctx.request;
    const body = await tryParseJson<RegisterRequest>(req.body);
    if (!body) {
      ctx.throw(400, apiErrorString({
        type: "REGISTER",
        path: req.url.pathname,
        message: "invalid body"
      }));
      return;
    }

    const invalidField = validateRegisterRequest(body);
    if (invalidField) {
      ctx.throw(400, apiErrorString({
        type: "REGISTER",
        path: req.url.pathname,
        message: `field missing - ${invalidField}`
      }));
      return;
    }

    const { username, password, email } = body;

    const userExists = rows.userExists(appState, username, email);
    if (userExists) {
      ctx.throw(400, apiErrorString({
        type: "REGISTER",
        path: req.url.pathname
      }));
      return;
    }

    const user = rows.createUser(appState, username, await auth.hashPassword(password), email);
    if (!user) {
      ctx.throw(500, apiErrorString({
        type: "REGISTER",
        path: req.url.pathname,
        message: "registration db failure"
      }));
      return;
    }

    const userSession = rows.createSessionForUser(appState, req.ip, user.id);
    if (!userSession) {
      ctx.throw(500, apiErrorString({
        type: "REGISTER",
        path: req.url.pathname,
        message: "unable generate session"
      }));
      return;
    }

    ctx.cookies.set(auth.SESSION_COOKIE_KEY, userSession.sessionId);

    // TODO testing
    if (appState.config.testing) {
      ctx.response.type = "application/json";
      ctx.response.body = JSON.stringify({
        session: userSession.sessionId,

        userId: user.id,
        username: user.username,
        password: user.hashedPassword
      });
      return;
    }

    ctx.response.redirect("/game");
  });

  router.post("/login", async (ctx) => {
    const req = ctx.request;
    const body = await tryParseJson<LoginRequest>(req.body);
    if (!body) {
      ctx.throw(400, apiErrorString({
        type: "LOGIN",
        path: req.url.pathname,
        message: "invalid body"
      }))
      return;
    }

    const missingField = validateLoginRequest(body);
    if (missingField) {
      ctx.throw(400, apiErrorString({
        type: "LOGIN",
        path: req.url.pathname,
        message: `field missing - ${missingField}`
      }));
      return;
    }

    const { username, password } = body;
    if (!username || !password) {
      ctx.throw(400, apiErrorString({
        type: "LOGIN",
        path: req.url.pathname,
        message: "malformed body"
      }));
      return;
    }

    const user = rows.getUserByUsername(appState, username);
    if (!user || !await auth.comparePasswords(password, user.hashedPassword)) {
      // Do not specify if the user or password was incorrect
      ctx.throw(401, apiErrorString({
        type: "LOGIN",
        path: req.url.pathname
      }));
      return;
    }

    const userSession = rows.createSessionForUser(appState, req.ip, user.id);
    if (!userSession) {
      ctx.throw(500, apiErrorString({
        type: "LOGIN",
        path: req.url.pathname,
        message: "failed to generate session"
      }));
      return;
    }

    ctx.cookies.set(auth.SESSION_COOKIE_KEY, userSession.sessionId);

    ctx.response.redirect("/game");
  });

  router.get("/ws", async (ctx) => {
    const req = ctx.request;
    const cookies = ctx.cookies;
    const sessionToken = await cookies.get(auth.SESSION_COOKIE_KEY);
    if (!sessionToken) {
      ctx.throw(401, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "no session found"
      }));
      return;
    }

    if (!rows.verifySessionId(appState, sessionToken)) {
      ctx.throw(401, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "invalid session"
      }));
      return;
    }

    const user = rows.getUserBySession(appState, sessionToken);
    if (!user) {
      ctx.throw(500, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "error while getting user"
      }));
      return;
    }

    if (!ctx.isUpgradable) {
      ctx.throw(400, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "connection not upgradable"
      }));
      return;
    }

    let socket: WebSocket | null = null;
    try {
      socket = ctx.upgrade();
    } catch (err) {
      log.error(err);
      ctx.throw(500, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "unable to upgrade connection"
      }));
      return;
    }
    if (!socket) {
      ctx.throw(500, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: "ws upgraded but no socket object present"
      }));
      return;
    }
    const address = req.ip;

    appState.addUser(user, address, socket);

    const channelSubs = rows.getChannelSubscriptionByUserId(appState, user.id);
    if (!channelSubs) {
      ctx.throw(500, apiErrorString({
        type: "WEBSOCKET",
        path: req.url.pathname,
        message: ""
      }));
    }
  });

  log.info("finished initializing router");
}

function initMiddleware(app: Application, config: AppConfig) {
  log.info("initializing middleware");

  const HEADERS = {
    responseTime: "X-Response-Time"
  };

  if (config.testing) {
    // TODO testing middleware
  }

  // Logging
  app.use(async (ctx, next) => {
    log.debug("entered middleware stack");

    await next();

    const responseTime = ctx.response.headers.get(HEADERS.responseTime);
    log.info(`${ctx.request.method} ${ctx.request.url} - ${responseTime}`);
  });

  // Timing
  app.use(async (ctx, next) => {
    // NOTE fine to use non-UTC here since we are only comparing the difference
    // between 2 local times
    const start = Date.now();

    await next();

    const ms = Date.now() - start;
    ctx.response.headers.set(HEADERS.responseTime, `${ms}ms`);
  });

  // Error handling
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      log.error(`error occurred during route handling ${err}`);

      if (isHttpError(err)) {
        const resp = ctx.response;
        resp.status = err.status;
        resp.body = err.message;
      } else {
        log.error(`unhandled error ${err}`);
        // Completely unhandled error
        throw err;
      }
    }
  });

  log.info("finished initializing middleware");
}

async function main(config: AppConfig) {
  log.info(`${APP_NAME} version ${VERSION} starting`);

  const dbExists = existsSync(config.dbPath);
  const db = new Database(config.dbPath);
  applyMigrations(db, dbExists);

  const gameWorker = new Worker(import.meta.resolve("./game.ts"), {
    type: "module"
  });

  gameWorker.postMessage("hello");
  gameWorker.postMessage("world");

  appState = new AppState(config, db, gameWorker);

  const router = new Router();
  initRouter(router, config);

  const app = new Application();
  initMiddleware(app, config);

  app.use(router.routes());
  app.use(router.allowedMethods());

  log.info(`server starting on port ${config.port}`);

  // TODO testing
  if (config.testing) {
    const output = createUser(appState, "test", "test", "test");
    log.debug(output);
  }

  Deno.addSignalListener("SIGINT", () => {
    log.info("SIGINT received");
    appState.shutdown();
  });

  await app.listen({
    port: config.port
  });

  // In theory, it is not possible to reach this point since the server should
  // never go down without SIGINT. Just in case, call shutdown to cleanup here.
  appState.shutdown();
}

if (import.meta.main) {
  const config = parseArgs();

  log.setup(config);
  log.info("logging initialized");

  await main(config);
}
