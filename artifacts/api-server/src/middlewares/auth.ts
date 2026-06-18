import type { RequestHandler, Request } from "express";

export interface AuthUser {
  id: string;
}

export function getAuthUser(_req: Request): string {
  return "anonymous";
}

export const requireAuth: RequestHandler = (_req, _res, next) => {
  next();
};
