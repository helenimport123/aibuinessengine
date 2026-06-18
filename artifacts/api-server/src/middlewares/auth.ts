import type { RequestHandler, Request } from "express";

export interface AuthUser {
  id: string;
}

export function getAuthUser(_req: Request): string | null {
  return null;
}

export const requireAuth: RequestHandler = (_req, _res, next) => {
  next();
};
