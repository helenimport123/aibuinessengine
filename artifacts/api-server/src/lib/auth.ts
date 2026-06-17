import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express } from "express";
import connectPgSimple from "connect-pg-simple";
import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

let _oidcConfig: Awaited<ReturnType<typeof client.discovery>> | null = null;
let _oidcConfigTime = 0;

async function getOidcConfig() {
  if (_oidcConfig && Date.now() - _oidcConfigTime < 3_600_000) return _oidcConfig;
  _oidcConfig = await client.discovery(
    new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
    process.env.REPL_ID!
  );
  _oidcConfigTime = Date.now();
  return _oidcConfig;
}

async function upsertUser(claims: client.IDToken) {
  await db
    .insert(usersTable)
    .values({
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      firstName: typeof claims.first_name === "string" ? claims.first_name : null,
      lastName: typeof claims.last_name === "string" ? claims.last_name : null,
      profileImageUrl:
        typeof claims.profile_image_url === "string" ? claims.profile_image_url : null,
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email: sql`excluded.email`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        profileImageUrl: sql`excluded.profile_image_url`,
        updatedAt: sql`now()`,
      },
    });
}

export async function setupAuth(app: Express): Promise<void> {
  app.set("trust proxy", 1);

  const rawSecret = process.env.SESSION_SECRET;
  if (!rawSecret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }
  if (!rawSecret) {
    console.warn("[auth] SESSION_SECRET not set — sessions will reset on restart");
  }
  const sessionSecret = rawSecret ?? "dev-insecure-secret-please-set-SESSION_SECRET";

  const PgSession = connectPgSimple(session);
  const sessionStore = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: 7 * 24 * 60 * 60,
    tableName: "sessions",
  });

  app.use(
    session({
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];

  const verify: VerifyFunction = async (tokens, verified) => {
    try {
      const claims = tokens.claims();
      await upsertUser(claims);
      verified(null, {
        claims,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: claims.exp,
      });
    } catch (err) {
      verified(err as Error);
    }
  };

  const registeredStrategies = new Set<string>();

  function ensureStrategy(hostname: string): string {
    const domain = replitDomain ?? hostname;
    const name = `replitauth:${domain}`;
    if (!registeredStrategies.has(name)) {
      passport.use(
        new Strategy(
          {
            name,
            config,
            scope: "openid email profile offline_access",
            callbackURL: `https://${domain}/api/callback`,
          },
          verify
        )
      );
      registeredStrategies.add(name);
    }
    return name;
  }

  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user as Express.User));

  app.get("/api/login", (req, res, next) => {
    const strategyName = ensureStrategy(req.hostname);
    passport.authenticate(strategyName, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    const strategyName = ensureStrategy(req.hostname);
    passport.authenticate(strategyName, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(async () => {
      try {
        const cfg = await getOidcConfig();
        const domain = replitDomain ?? req.hostname;
        res.redirect(
          client.buildEndSessionUrl(cfg, {
            client_id: process.env.REPL_ID!,
            post_logout_redirect_uri: `${req.protocol}://${domain}`,
          }).href
        );
      } catch {
        res.redirect("/");
      }
    });
  });
}
