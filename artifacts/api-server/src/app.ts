import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import session from "express-session";
import passport from "passport";
import connectPgSimple from "connect-pg-simple";
import router from "./routes";
import { logger } from "./lib/logger";

export async function createApp(): Promise<Express> {
  const app: Express = express();

  const allowedOrigins = process.env.REPLIT_DOMAINS
    ? process.env.REPLIT_DOMAINS.split(",").map((d) => `https://${d.trim()}`)
    : [];

  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    })
  );

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const PgSession = connectPgSimple(session);
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dev-secret",
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: false,
        ttl: 7 * 24 * 60 * 60,
        tableName: "sessions",
      }),
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
  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user as Express.User));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_RPM ?? "120", 10),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "anon",
    message: { error: "Quá nhiều yêu cầu. Vui lòng chờ 1 phút rồi thử lại." },
  });
  app.use("/api", apiLimiter);

  app.use("/api", router);

  return app;
}
