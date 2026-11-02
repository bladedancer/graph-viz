import { HttpError, UpstreamError, isAbort } from './errors.js';
import { sleep } from './sleep.js';

const RETRYABLE = new Set([429, 502, 503, 504]);

const hostAllowed = (host, patterns) =>
    patterns.length === 0 || patterns.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) : host === p));

/**
 * Validates the tenant URL typed by the user and works out where to sign in.
 * Fusion keeps the sign-in service on a sibling host: the first label of the tenant host is replaced
 * with "services" (acme.fusion.example.com -> services.fusion.example.com) and the original first label
 * is sent as the login "domain". `servicesOverride` (SERVICES_URL) replaces that derivation.
 */
export function parseTenantUrl(input, allowedHosts = [], servicesOverride) {
    let url;
    try {
        url = new URL(String(input ?? '').trim());
    } catch {
        throw new HttpError(400, 'invalid_request', 'Enter the tenant URL, for example https://acme.fusion.example.com.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new HttpError(400, 'invalid_request', 'The tenant URL must start with https:// or http://.');
    }
    if (url.username || url.password) {
        throw new HttpError(400, 'invalid_request', 'The tenant URL must not contain a username or password.');
    }
    const host = url.hostname.toLowerCase();
    if (!hostAllowed(host, allowedHosts)) {
        throw new HttpError(403, 'tenant_not_allowed', 'This server is not configured to sign in to that tenant.');
    }
    const labels = host.split('.');
    const domain = labels[0];
    const servicesUrl = new URL(servicesOverride || url.origin);
    if (!servicesOverride) servicesUrl.hostname = ['services', ...labels.slice(1)].join('.');
    return { tenantUrl: url.origin, servicesUrl: servicesUrl.origin, domain };
}

const errorDetail = async (response) => {
    const text = await response.text().catch(() => '');
    try {
        const body = JSON.parse(text);
        const first = body?.errors?.[0];
        return first?.detail || first?.title || body?.message || body?.error_description || `HTTP ${response.status}`;
    } catch {
        return text.replace(/\s+/g, ' ').slice(0, 160) || `HTTP ${response.status}`;
    }
};

const withTimeout = (signal, ms) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(ms)]);

/** Signs in and returns the access token and who the user is. Throws HttpError with a user-facing message. */
export async function login({ servicesUrl, domain, email, password }, { timeoutMs, signal } = {}) {
    let response;
    try {
        response = await fetch(`${servicesUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email, password, domain, remember: false, duplicateSession: true }),
            signal: withTimeout(signal, timeoutMs ?? 30_000),
        });
    } catch (err) {
        const host = new URL(servicesUrl).host;
        throw new HttpError(502, 'unreachable', `Couldn't reach ${host}. Check the tenant URL and your network.`, { cause: err });
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new HttpError(401, 'invalid_credentials', 'Check your email, password and tenant URL, then try again.');
    }
    if (!response.ok) {
        throw new HttpError(502, 'upstream_error', `The tenant refused the sign-in: ${await errorDetail(response)}`);
    }
    const body = await response.json().catch(() => null);
    if (!body?.access_token) {
        throw new HttpError(502, 'upstream_error', 'The tenant did not return an access token.');
    }
    const name = [body.firstName, body.lastName].filter(Boolean).join(' ') || body.email || email;
    return {
        token: body.access_token,
        user: { name, email: body.email || email },
        mode: body.userPreference?.defaultMode?.modeName || undefined,
    };
}

/** Best-effort sign-out upstream; the local session is dropped regardless. */
export async function logout(session, { timeoutMs } = {}) {
    try {
        await fetch(`${session.tenantUrl}/api/auth/logout`, {
            headers: { Authorization: `Bearer ${session.token}`, 'Env-Mode': session.mode },
            signal: AbortSignal.timeout(timeoutMs ?? 10_000),
        });
    } catch {
        // The token expires on its own.
    }
}

/**
 * Returns a function that GETs `/api/config/v1<path>` as this session, with a timeout and a couple of retries
 * for throttling and gateway errors. Resolves the parsed JSON:API document; throws UpstreamError otherwise.
 */
export function configClient(session, { timeoutMs = 30_000, retries = 2, signal } = {}) {
    // The mode is fixed when the client is made, so a crawl that is already running can't switch environments if the
    // user changes the session's mode part way through.
    const envMode = session.mode;
    return async function fetchConfig(path) {
        for (let attempt = 0; ; attempt++) {
            let response;
            try {
                response = await fetch(`${session.tenantUrl}/api/config/v1${path}`, {
                    headers: {
                        Authorization: `Bearer ${session.token}`,
                        'Env-Mode': envMode,
                        Accept: 'application/vnd.api+json',
                    },
                    signal: withTimeout(signal, timeoutMs),
                });
            } catch (err) {
                if (signal?.aborted) throw err;
                if (isAbort(err) && attempt >= retries) throw new UpstreamError('The tenant took too long to answer.', { cause: err });
                if (attempt >= retries)
                    throw new UpstreamError(`Couldn't reach the tenant: ${err.cause?.code || err.message}`, { cause: err });
                await sleep(300 * 2 ** attempt, signal);
                continue;
            }
            if (response.ok) {
                try {
                    return await response.json();
                } catch (err) {
                    if (signal?.aborted) throw err;
                    throw new UpstreamError('The tenant sent a response that is not valid JSON.', { status: response.status, cause: err });
                }
            }
            if (RETRYABLE.has(response.status) && attempt < retries) {
                await response.body?.cancel();
                await sleep(300 * 2 ** attempt, signal);
                continue;
            }
            throw new UpstreamError(await errorDetail(response), { status: response.status });
        }
    };
}
