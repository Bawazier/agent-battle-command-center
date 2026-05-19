import rateLimit from 'express-rate-limit';

/**
 * Rate Limiter Configuration
 *
 * Prevents API abuse by limiting requests per IP address.
 * Uses sliding window algorithm for accurate rate limiting.
 */

// Get rate limit config from environment variables
const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || '60000', // 1 minute default
  10
);

const RATE_LIMIT_MAX = parseInt(
  process.env.RATE_LIMIT_MAX || '100', // 100 requests per window default
  10
);

const RATE_LIMIT_SKIP_SUCCESSFUL = process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true';

/**
 * Standard rate limiter for all API endpoints
 */
export const standardRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skipSuccessfulRequests: RATE_LIMIT_SKIP_SUCCESSFUL,
  message: {
    error: 'Too many requests',
    message: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000} seconds.`,
    retryAfter: RATE_LIMIT_WINDOW_MS / 1000,
  },
});

/**
 * Strict rate limiter for sensitive endpoints (auth, task creation)
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 20, // 20 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded for this endpoint. Please try again later.',
    retryAfter: 60,
  },
});

/**
 * Permissive rate limiter for read-only endpoints
 */
export const permissiveRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 300, // 300 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please slow down.',
    retryAfter: 60,
  },
});
