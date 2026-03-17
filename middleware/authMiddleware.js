import { verifySessionToken } from "../services/authService.js";
import { findUserById, sanitizeUser } from "../services/userService.js";

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const [scheme, bearerToken] = authorization.split(" ");
    const queryToken =
      req.method === "GET" && typeof req.query?.token === "string" ? req.query.token : "";
    const token = scheme === "Bearer" && bearerToken ? bearerToken : queryToken;

    if (!token) {
      return res.status(401).json({ message: "Missing bearer token" });
    }

    const payload = verifySessionToken(token);

    if (!payload?.sub) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await findUserById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    req.userId = String(user.id || user._id);
    req.safeUser = sanitizeUser(user);
    return next();
  } catch (error) {
    return next(error);
  }
}
