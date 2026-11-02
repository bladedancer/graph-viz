// Optional .env in the working directory (Node 22+); real environment variables win.
try {
    process.loadEnvFile('.env');
} catch {
    // No .env file - defaults and the real environment are enough.
}

const int = (value, fallback) => {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const list = (value) =>
    (value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export const config = {
    port: int(process.env.PORT, 8080),
    // Loopback by default so a locally run server isn't exposed to the network; the Docker image sets HOST=0.0.0.0.
    host: process.env.HOST || '127.0.0.1',
    // Sign-in service URL for tenants that don't follow the "services." host convention.
    servicesUrl: process.env.SERVICES_URL || undefined,
    // Env-Mode header sent upstream when the tenant doesn't tell us the user's default mode.
    envMode: process.env.ENV_MODE || 'DESIGN',
    sessionTtlMs: int(process.env.SESSION_TTL_MINUTES, 8 * 60) * 60 * 1000,
    // Comma-separated hosts the server may sign in to. "*.example.com" matches subdomains. Empty = any host.
    allowedTenantHosts: list(process.env.ALLOWED_TENANT_HOSTS),
    // Extra browser origins allowed to call the API (same-origin is always allowed).
    allowedOrigins: list(process.env.ALLOWED_ORIGINS),
    // Set when running behind a reverse proxy that terminates TLS, so cookies are marked Secure.
    trustProxy: process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1',
    loginAttemptsPerMinute: int(process.env.LOGIN_ATTEMPTS_PER_MINUTE, 10),
    requestTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_SECONDS, 30) * 1000,
    crawlConcurrency: int(process.env.CRAWL_CONCURRENCY, 12),
    maxResourcesCap: int(process.env.MAX_RESOURCES_CAP, 100_000),
};
