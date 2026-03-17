const rateLimitBuckets = new Map();
const loginAttemptBuckets = new Map();

function now() {
  return Date.now();
}

function cleanupRateLimitBucket(bucket, currentTime, windowMs) {
  if (currentTime >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = currentTime + windowMs;
  }
}

function cleanupLoginBucket(bucket, currentTime, windowMs) {
  if (bucket.cooldownUntil && currentTime >= bucket.cooldownUntil) {
    bucket.attempts = [];
    bucket.cooldownUntil = 0;
  }

  bucket.attempts = bucket.attempts.filter((timestamp) => currentTime - timestamp < windowMs);
}

function minutesLabel(milliseconds) {
  const minutes = Math.ceil(milliseconds / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function checkRateLimit({ key, windowMs, max }) {
  const currentTime = now();
  const bucketKey = String(key || "anonymous");
  const bucket =
    rateLimitBuckets.get(bucketKey) || {
      count: 0,
      resetAt: currentTime + windowMs
    };

  cleanupRateLimitBucket(bucket, currentTime, windowMs);
  bucket.count += 1;
  rateLimitBuckets.set(bucketKey, bucket);

  const remaining = Math.max(0, max - bucket.count);
  const retryAfterMs = Math.max(0, bucket.resetAt - currentTime);

  return {
    allowed: bucket.count <= max,
    limit: max,
    remaining,
    retryAfterMs,
    resetAt: bucket.resetAt
  };
}

export function getLoginThrottleState({ key, windowMs, maxAttempts, cooldownMs }) {
  const currentTime = now();
  const bucketKey = String(key || "anonymous");
  const bucket =
    loginAttemptBuckets.get(bucketKey) || {
      attempts: [],
      cooldownUntil: 0
    };

  cleanupLoginBucket(bucket, currentTime, windowMs);
  loginAttemptBuckets.set(bucketKey, bucket);

  const retryAfterMs = bucket.cooldownUntil > currentTime ? bucket.cooldownUntil - currentTime : 0;

  return {
    blocked: retryAfterMs > 0,
    retryAfterMs,
    cooldownEndsAt: bucket.cooldownUntil || null,
    remainingAttempts: Math.max(0, maxAttempts - bucket.attempts.length)
  };
}

export function recordFailedLoginAttempt({ key, windowMs, maxAttempts, cooldownMs }) {
  const currentTime = now();
  const bucketKey = String(key || "anonymous");
  const bucket =
    loginAttemptBuckets.get(bucketKey) || {
      attempts: [],
      cooldownUntil: 0
    };

  cleanupLoginBucket(bucket, currentTime, windowMs);
  bucket.attempts.push(currentTime);

  if (bucket.attempts.length >= maxAttempts) {
    bucket.cooldownUntil = currentTime + cooldownMs;
  }

  loginAttemptBuckets.set(bucketKey, bucket);

  const retryAfterMs = bucket.cooldownUntil > currentTime ? bucket.cooldownUntil - currentTime : 0;

  return {
    blocked: retryAfterMs > 0,
    retryAfterMs,
    cooldownEndsAt: bucket.cooldownUntil || null,
    remainingAttempts: retryAfterMs > 0 ? 0 : Math.max(0, maxAttempts - bucket.attempts.length)
  };
}

export function clearFailedLoginAttempts(key) {
  if (!key) {
    return;
  }

  loginAttemptBuckets.delete(String(key));
}

export function buildRateLimitResponse(message, retryAfterMs, extra = {}) {
  return {
    message,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    ...extra
  };
}

export function buildLoginLockMessage(retryAfterMs) {
  return `Too many login attempts. Try again in ${minutesLabel(retryAfterMs)}.`;
}
