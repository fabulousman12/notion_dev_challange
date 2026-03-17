import { getAppConfig } from "../config/appConfig.js";
import { createSessionToken, sanitizeUser } from "../services/authService.js";
import {
  buildLoginLockMessage,
  buildRateLimitResponse,
  clearFailedLoginAttempts,
  getLoginThrottleState,
  recordFailedLoginAttempt
} from "../services/securityService.js";
import {
  authenticateUser,
  createUser,
  rotateUserWebhookKey,
  updateUserNotionConfig
} from "../services/userService.js";

function validateAuthPayload(body, isRegistration = false) {
  if (!body?.email || !body?.password) {
    throw new Error("Email and password are required");
  }

  if (isRegistration && String(body.password).length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
}

function getLoginAttemptKey(req) {
  const email = String(req.body?.email || "").trim().toLowerCase() || "unknown-email";
  return `${req.ip || "unknown-ip"}:${email}`;
}

function getLoginLimitConfig() {
  const config = getAppConfig();
  return {
    windowMs: config.security.loginAttemptWindowMs,
    maxAttempts: config.security.loginAttemptMax,
    cooldownMs: config.security.loginCooldownMs
  };
}

export async function registerUser(req, res, next) {
  try {
    validateAuthPayload(req.body, true);

    const user = await createUser({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      notion: req.body.notion || {}
    });

    const token = createSessionToken(user);

    return res.status(201).json({
      token,
      user: sanitizeUser(user),
      connectNotionUrl: "/api/notion/connect"
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

export async function loginUser(req, res, next) {
  try {
    validateAuthPayload(req.body, false);

    const attemptKey = getLoginAttemptKey(req);
    const limitConfig = getLoginLimitConfig();
    const throttleState = getLoginThrottleState({
      key: attemptKey,
      ...limitConfig
    });

    if (throttleState.blocked) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(throttleState.retryAfterMs / 1000))));
      return res.status(429).json(
        buildRateLimitResponse(buildLoginLockMessage(throttleState.retryAfterMs), throttleState.retryAfterMs, {
          remainingAttempts: 0,
          cooldownEndsAt: throttleState.cooldownEndsAt
        })
      );
    }

    const user = await authenticateUser({
      email: req.body.email,
      password: req.body.password
    });

    if (!user) {
      const failureState = recordFailedLoginAttempt({
        key: attemptKey,
        ...limitConfig
      });

      if (failureState.blocked) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(failureState.retryAfterMs / 1000))));
        return res.status(429).json(
          buildRateLimitResponse(buildLoginLockMessage(failureState.retryAfterMs), failureState.retryAfterMs, {
            remainingAttempts: 0,
            cooldownEndsAt: failureState.cooldownEndsAt
          })
        );
      }

      return res.status(401).json({
        message: "Invalid email or password",
        remainingAttempts: failureState.remainingAttempts
      });
    }

    clearFailedLoginAttempts(attemptKey);

    const token = createSessionToken(user);

    return res.json({
      token,
      user: sanitizeUser(user),
      connectNotionUrl: "/api/notion/connect"
    });
  } catch (error) {
    return next(error);
  }
}

export async function getCurrentUser(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ user: req.safeUser });
}

export async function updateMyNotionConfig(req, res, next) {
  try {
    const user = await updateUserNotionConfig(req.userId, req.body || {});
    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

export async function rotateWebhookKey(req, res, next) {
  try {
    const user = await rotateUserWebhookKey(req.userId);
    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    return next(error);
  }
}
