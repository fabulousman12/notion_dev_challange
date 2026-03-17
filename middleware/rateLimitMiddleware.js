import { checkRateLimit, buildRateLimitResponse } from "../services/securityService.js";

function getClientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
}

export function createRateLimitMiddleware({
  windowMs,
  max,
  message,
  keyPrefix,
  keySelector
}) {
  return function rateLimitMiddleware(req, res, next) {
    const keyPart = keySelector ? keySelector(req) : getClientIp(req);
    const key = `${keyPrefix || "rate"}:${keyPart || "unknown"}`;
    const result = checkRateLimit({ key, windowMs, max });

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(result.resetAt));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      return res.status(429).json(
        buildRateLimitResponse(message || "Too many requests. Please try again later.", result.retryAfterMs)
      );
    }

    return next();
  };
}

export function getRequestFingerprint(req) {
  return `${getClientIp(req)}:${req.headers["user-agent"] || "unknown-agent"}`;
}
