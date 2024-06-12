import { Application, isErrorStatus, isHttpError } from "@oak/oak";
import { Router } from "@oak/oak/router";
import { Database, Statement } from "@db/sqlite";
// TODO https://medium.com/nybles/a-complete-guide-to-deno-and-oak-with-authentication-using-bcrypt-and-djwt-with-mongodb-as-cbe4b604de9f
import { validate, create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { existsSync } from "jsr:@std/fs@^0.221.0/exists";

import { AppConfig, LoginRequest, RegisterRequest, apiErrorString, parseArgs } from "./model.ts";
import * as rows from "./rows.ts";
import { User, applyMigrations } from "./rows.ts";
import { AppState } from "./app_state.ts";
import * as log from "./logger.ts";
import * as auth from "./auth.ts";

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

  router.get("/", async (ctx) => {
    await ctx.send({
      root: `${Deno.cwd()}/static`,
      path: "index.html"
    });
  });

  router.get("/game", async (ctx) => {
    const urlPath = ctx.request.url.pathname;

    const cookies = ctx.cookies;
    let existingSession = await cookies.get(auth.SESSION_COOKIE_KEY);
    if (!existingSession) {
      const jwtToken = await cookies.get(auth.JWT_COOKIE_KEY);
      if (!jwtToken) {
        ctx.throw(401, apiErrorString({
          // Login-related error, jwt not set
          type: "LOGIN",
          path: urlPath,
          message: "no jwt token found"
        }));
        return;
      }

      const jwtPayload = await auth.verifyJwt(jwtToken);
      if (!jwtPayload) {
        ctx.throw(401, apiErrorString({
          // Login-related error, jwt is expired
          type: "LOGIN",
          path: urlPath,
          message: "jwt token is expired"
        }));
        return;
      }

      const userId = jwtPayload.userId;
      if (typeof (userId) !== "number") {
        ctx.throw(400, apiErrorString({
          type: "LOGIN",
          path: urlPath,
          message: "jwt payload is malformed"
        }));
        return;
      }

      const sessionId = await rows.createSessionForUser(
        appState, ctx.request.ip, userId);
      if (!sessionId) {
        ctx.throw(500, apiErrorString({
          type: "LOGIN",
          path: urlPath,
          message: "unable to generate session"
        }));
        return;
      }

      existingSession = sessionId;
      await cookies.set(auth.SESSION_COOKIE_KEY, existingSession);
    }

    if (!rows.verifySessionId(appState, existingSession)) {
      ctx.throw(401, apiErrorString({
        type: "LOGIN",
        path: urlPath,
        message: "session is invalid, please login again"
      }));
      return;
    }

    await ctx.send({
      root: `${Deno.cwd()}/static`,
      path: "game.html"
    });
  });

  // TODO
  router.post("/register", async (ctx) => {
    const req = ctx.request;
    const body: RegisterRequest = await req.body.json();
    if (!body) {
      ctx.throw(400, apiErrorString({
        type: "REGISTER",
        path: ctx.request.url.pathname
      }));
      return;
    }

    const { username, password, email } = body;

    const registerCheck = appState.prepare("select * from user where username = ? or email = ?");
    if (!registerCheck) {
      ctx.throw(500, "unable to prepare register check statement");
      return;
    }
    const registerCheckOutput = registerCheck.all<User>(username, email);
    // TODO stub
  });

  router.post("/login", async (ctx) => {
    const req = ctx.request;
    const body: LoginRequest = await req.body.json();
    if (!body) {
      ctx.throw(400, apiErrorString({
        type: "LOGIN",
        path: ctx.request.url.pathname,
        message: "no body found"
      }))
      return;
    }

    const username = body.username;
    const password = body.password;

    const user = rows.getUserByUsername(appState, username);
    if (!user || !await auth.comparePasswords(password, user.hashedPassword)) {
      // Do not specify if the user or password was incorrect
      ctx.throw(401, apiErrorString({
        type: "LOGIN",
        path: ctx.request.url.pathname
      }));
      return;
    }

    const jwtToken = await auth.createJwt(APP_NAME, user.id);
    ctx.cookies.set(auth.JWT_COOKIE_KEY, jwtToken);

    ctx.response.redirect("/game");
  });

  router.get("/ws", async (ctx) => {
    if (!ctx.isUpgradable) {
      ctx.throw(501, apiErrorString({
        type: "WEBSOCKET",
        path: ctx.request.url.pathname,
        message: "could not upgrade websocket connection"
      }));
      return;
    }
    const socket = ctx.upgrade();
    const address = ctx.request.ip;
  });

  log.info("finished initializing router");
}

function initMiddleware(app: Application, config: AppConfig) {
  log.info("initializing middleware");

  const HEADERS = {
    responseTime: "X-Response-Time"
  };

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
        // Error objects from routes will always be stringified
        resp.type = "application/json";
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

  appState = new AppState(db);

  const router = new Router();
  initRouter(router, config);

  const app = new Application();
  initMiddleware(app, config);

  app.use(router.routes());
  app.use(router.allowedMethods());

  log.info(`server starting on port ${config.port}`);

  await app.listen({
    port: config.port
  });
}

if (import.meta.main) {
  const config = parseArgs();

  log.setup(config);
  log.info("logging initialized");

  main(config);
}
