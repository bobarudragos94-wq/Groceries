/** Fetch cu antete de browser, timeout și reîncercări cu backoff exponențial. */

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8'
};

export interface FetchOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  /** pauză de bază între reîncercări (crește exponențial) */
  backoffMs?: number;
}

export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { retries = 4, timeoutMs = 30000, backoffMs = 1500 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs * 2 ** (attempt - 1) + Math.random() * 500);
    }
    try {
      const res = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...opts.headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow'
      });
      // API-ul Lidl răspunde uneori 500/406 la cereri valide — reîncercăm.
      if (res.status >= 500 || res.status === 406 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status} la ${url}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} la ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} la ${url}`);
  return await res.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
