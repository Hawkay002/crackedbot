import { GitHubError, gql } from './graphql.js';
import { VIEWER_QUERY } from './queries.js';

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  // No scopes: public data plus the viewer's own contribution counts is all we read.
  return u.toString();
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'crackedbot' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GitHubError(`token exchange failed: ${res.status}`, res.status, 'http');
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new GitHubError(
      `token exchange failed: ${json.error_description ?? json.error ?? 'no token'}`,
      400,
      'http',
    );
  }
  return json.access_token;
}

export interface Viewer {
  id: string;
  databaseId: number;
  login: string;
}

export async function fetchViewer(token: string): Promise<Viewer> {
  const data = await gql<{ viewer: Viewer }>(token, VIEWER_QUERY);
  return data.viewer;
}
