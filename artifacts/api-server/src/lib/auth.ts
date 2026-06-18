import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import type { Express } from "express";
import connectPgSimple from "connect-pg-simple";
import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

async function upsertUser(profile: {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
}) {
  await db
    .insert(usersTable)
    .values({
      id: profile.id,
      email: profile.email ?? null,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      profileImageUrl: profile.profileImageUrl ?? null,
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

  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.warn("[auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google login disabled");
  } else {
    const callbackURL =
      process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/callback`
        : "http://localhost:8080/api/callback";

    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL,
          scope: ["openid", "email", "profile"],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            const photo = profile.photos?.[0]?.value;
            const firstName = profile.name?.givenName;
            const lastName = profile.name?.familyName;

            await upsertUser({
              id: `google:${profile.id}`,
              email,
              firstName,
              lastName,
              profileImageUrl: photo,
            });

            done(null, {
              id: `google:${profile.id}`,
              email,
              firstName,
              lastName,
              profileImageUrl: photo,
            });
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }

  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user as Express.User));

  app.get("/api/login", passport.authenticate("google", {
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  }));

  app.get("/api/callback",
    passport.authenticate("google", {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })
  );

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}
