import type { RequestHandler, Request } from "express";
import * as client from "openid-client";

export interface AuthUser {
  claims: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    exp?: number;
    [key: string]: unknown;
  };
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export function getAuthUser(req: Request): string {
  return (req.user as AuthUser).claims.sub;
}

let _oidcConfig: Awaited<ReturnType<typeof client.discovery>> | null = null;
let _oidcConfigTime = 0;

async function getOidcConfig() {
  if (_oidcConfig && Date.now() - _oidcConfigTime < 3600_000) return _oidcConfig;
  _oidcConfig = await client.discovery(
    new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
    process.env.REPL_ID!
  );
  _oidcConfigTime = Date.now();
  return _oidcConfig;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = req.user as AuthUser;
  const now = Math.floor(Date.now() / 1000);

  if (user.expires_at && now > user.expires_at) {
    if (!user.refresh_token) {
      res.status(401).json({ error: "Session expired. Please log in again." });
      return;
    }
    try {
      const config = await getOidcConfig();
      const tokens = await client.refreshTokenGrant(config, user.refresh_token);
      const claims = tokens.claims();
      user.claims = claims;
      user.access_token = tokens.access_token;
      if (tokens.refresh_token) user.refresh_token = tokens.refresh_token;
      user.expires_at = claims.exp;
    } catch {
      res.status(401).json({ error: "Session expired. Please log in again." });
      return;
    }
  }

  next();
};
