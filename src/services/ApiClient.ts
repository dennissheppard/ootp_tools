const DEFAULT_RATE_LIMIT_WAIT_MS = 4000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MIN_RATE_LIMIT_WAIT_MS = 2000;
const MAX_RATE_LIMIT_WAIT_MS = 12000;

type RateLimitDetail = {
  waitMs: number;
  attempt: number;
  maxAttempts: number;
  url: string;
};

function clampWaitMs(waitMs: number): number {
  if (!Number.isFinite(waitMs)) return DEFAULT_RATE_LIMIT_WAIT_MS;
  return Math.min(Math.max(waitMs, MIN_RATE_LIMIT_WAIT_MS), MAX_RATE_LIMIT_WAIT_MS);
}

function getRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return dateMs - Date.now();
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notifyRateLimited(detail: RateLimitDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RateLimitDetail>('wbl:rate-limited', { detail }));
}

function notifyRateLimitClear(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('wbl:rate-limit-clear'));
}

type ApiCallTracker = (endpoint: string, bytes: number | undefined, status: number, duration_ms: number) => void;
let _apiCallTracker: ApiCallTracker | null = null;

export function setApiCallTracker(tracker: ApiCallTracker): void {
  _apiCallTracker = tracker;
}

function normalizeEndpoint(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let attempt = 0;
  let hadRateLimit = false;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const endpoint = normalizeEndpoint(url);

  while (true) {
    const start = performance.now();
    const response = await fetch(input, init);
    const duration_ms = Math.round(performance.now() - start);

    const contentLength = response.headers.get('content-length');
    const bytes = contentLength !== null ? parseInt(contentLength, 10) : undefined;
    _apiCallTracker?.(endpoint, bytes, response.status, duration_ms);

    if (response.status !== 429) {
      if (hadRateLimit) {
        notifyRateLimitClear();
      }
      return response;
    }

    attempt += 1;
    const retryAfterMs = getRetryAfterMs(response);
    const waitMs = clampWaitMs(retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS);

    notifyRateLimited({
      waitMs,
      attempt,
      maxAttempts: MAX_RATE_LIMIT_RETRIES,
      url,
    });

    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      if (hadRateLimit) {
        notifyRateLimitClear();
      }
      return response;
    }

    hadRateLimit = true;
    await delay(waitMs);
  }
}
