import { NextFunction, Request, Response } from "express";

/**
 * Plain HTTP Basic Auth for browser-facing admin pages (e.g. the BullMQ
 * dashboard) that can't use the app's JWT bearer-token scheme - there's no
 * login page to redirect through for a bare browser navigation, but every
 * browser already knows how to prompt for basic-auth credentials on a 401
 * with a WWW-Authenticate challenge.
 */
export default function basicAuth(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const provided = header?.startsWith("Basic ") ? header.slice("Basic ".length) : undefined;

    if (provided && Buffer.from(provided, "base64").toString("utf8") === `${username}:${password}`) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", "Basic realm=\"Admin\"");
    res.status(401).json({ message: "Authentication required" });
  };
}
