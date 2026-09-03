export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: 'http' | 'graphql' | 'rate-limit' | 'network' | 'auth',
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

const ENDPOINT = 'https://api.github.com/graphql';
const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 500;

const retryable = (err: unknown) =>
  err instanceof GitHubError &&
  (err.kind === 'network' || err.status === 502 || err.status === 503 || err.status === 504);

async function once<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'crackedbot',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GitHubError(`network error: ${(err as Error).message}`, 0, 'network');
  }
  if (res.status === 401) {
    throw new GitHubError(
      'GitHub rejected the token (401). Check it is a valid token with no extra prefix.',
      401,
      'auth',
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new GitHubError('GitHub rate limit hit', res.status, 'rate-limit');
  }
  if (!res.ok) {
    throw new GitHubError(`GitHub responded ${res.status}`, res.status, 'http');
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] };
  if (json.errors?.length) {
    const rateLimited = json.errors.some((e) => e.type === 'RATE_LIMITED');
    throw new GitHubError(
      json.errors.map((e) => e.message).join('; '),
      res.status,
      rateLimited ? 'rate-limit' : 'graphql',
    );
  }
  if (!json.data) throw new GitHubError('empty GraphQL response', res.status, 'graphql');
  return json.data;
}

/** POST a GraphQL query. One retry on network errors and 502/503/504, which GitHub returns for slow queries. */
export async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await once<T>(token, query, variables);
  } catch (err) {
    if (!retryable(err)) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return once<T>(token, query, variables);
  }
}
