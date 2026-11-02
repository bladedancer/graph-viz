import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { crawl } from './crawler.js';
import { HttpError, UpstreamError, isAbort } from './errors.js';
import { log } from './log.js';
import { ROOTS, ROOT_NAMES, countRoots } from './roots.js';
import { MODES, normalizeMode } from './modes.js';
import { SessionStore } from './sessions.js';
import { configClient, login, logout, parseTenantUrl } from './upstream.js';
import { parseExpand } from './validate.js';

const COOKIE = 'gv_sid';
const COUNTS_TTL_MS = 10 * 60 * 1000;

const parseCookies = (header = '') =>
    Object.fromEntries(
        header
            .split(';')
            .map((p) => p.trim().split('='))
            .filter(([k, v]) => k && v !== undefined)
            .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
    );

const text = (value, name, max) => {
    if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'invalid_request', `${name} is required.`);
    if (value.length > max) throw new HttpError(400, 'invalid_request', `${name} is too long.`);
    return value;
};

const integer = (value, name, { min, max, fallback }) => {
    if (value === undefined || value === null) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new HttpError(400, 'invalid_request', `${name} must be a whole number between ${min} and ${max}.`);
    }
    return value;
};

// Allows `limit` sign-in attempts per client per minute.
const loginLimiter = (limit) => {
    const attempts = new Map();
    return (req, res, next) => {
        const now = Date.now();
        // Forget clients that have been quiet for a minute, so the map doesn't grow with every address ever seen.
        for (const [ip, times] of attempts) if (now - times.at(-1) >= 60_000) attempts.delete(ip);
        const recent = (attempts.get(req.ip) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= limit) {
            res.set('Retry-After', '60');
            throw new HttpError(429, 'rate_limited', 'Too many sign-in attempts. Wait a minute and try again.');
        }
        attempts.set(req.ip, [...recent, now]);
        next();
    };
};

export function createApp({ config, sessions = new SessionStore({ ttlMs: config.sessionTtlMs }) }) {
    const app = express();
    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', true);

    app.use((req, res, next) => {
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
                "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
        });
        if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
        next();
    });

    // /api/expand carries the ids already in the graph, so it may be large; everything else is tiny.
    app.use('/api/expand', express.json({ limit: '64mb' }));
    app.use('/api', express.json({ limit: '16kb' }));

    // The session cookie is SameSite=Strict; this also refuses cross-origin writes outright.
    app.use('/api', (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
            let host;
            try {
                host = new URL(origin).host;
            } catch {
                /* falls through to the refusal */
            }
            if (host !== req.headers.host && !config.allowedOrigins.includes(origin)) {
                throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.');
            }
        }
        req.session = sessions.get(parseCookies(req.headers.cookie)[COOKIE]);
        next();
    });

    const requireSession = (req, res, next) => {
        if (!req.session) throw new HttpError(401, 'session_expired', 'Your session has ended. Sign in again.');
        next();
    };
    // Drops the session. Mid-stream the cookie can't be cleared any more; with the session gone it is inert.
    const expire = (req, res) => {
        sessions.delete(req.session.id);
        if (!res.headersSent) res.clearCookie(COOKIE);
    };
    const publicSession = (s) => ({ authenticated: true, user: s.user, tenantUrl: s.tenantUrl, mode: s.mode });

    app.get('/api/session', (req, res) => {
        res.json(req.session ? publicSession(req.session) : { authenticated: false });
    });

    app.post('/api/login', loginLimiter(config.loginAttemptsPerMinute), async (req, res) => {
        const body = req.body ?? {};
        const email = text(body.email, 'Email', 320).trim();
        const password = text(body.password, 'Password', 1024);
        const target = parseTenantUrl(text(body.tenantUrl, 'Tenant URL', 2048), config.allowedTenantHosts, config.servicesUrl);
        const result = await login({ ...target, email, password }, { timeoutMs: config.requestTimeoutMs });
        if (req.session) sessions.delete(req.session.id);
        const session = sessions.create({
            token: result.token,
            user: result.user,
            tenantUrl: target.tenantUrl,
            mode: normalizeMode(result.mode) ?? normalizeMode(config.envMode) ?? MODES[0],
        });
        res.cookie(COOKIE, session.id, {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            maxAge: config.sessionTtlMs,
            path: '/',
        });
        log.info(`sign-in ${target.tenantUrl}`);
        res.json(publicSession(session));
    });

    app.post('/api/logout', async (req, res) => {
        if (req.session) {
            const session = req.session;
            expire(req, res);
            await logout(session);
        }
        res.json({ authenticated: false });
    });

    app.get('/api/roots', requireSession, (req, res) => {
        res.json({ roots: ROOTS });
    });

    app.get('/api/roots/counts', requireSession, async (req, res) => {
        const session = req.session;
        const fresh = session.counts && Date.now() - session.counts.at < COUNTS_TTL_MS && req.query.refresh === undefined;
        if (!fresh) {
            try {
                const mode = session.mode;
                const counts = await countRoots(configClient(session, { timeoutMs: config.requestTimeoutMs }));
                if (session.mode === mode) session.counts = { at: Date.now(), counts };
                else return res.json({ counts }); // the mode changed while counting: answer, but don't cache
            } catch (err) {
                if (err instanceof UpstreamError && err.status === 401) {
                    expire(req, res);
                    throw new HttpError(401, 'session_expired', 'Your session has ended. Sign in again.');
                }
                throw err;
            }
        }
        res.json({ counts: session.counts.counts });
    });

    // Which environment (DESIGN, CHECK, LIVE) the tenant is read in. Sent as the Env-Mode header on every request.
    app.put('/api/mode', requireSession, (req, res) => {
        const mode = normalizeMode(req.body?.mode);
        if (!mode) throw new HttpError(400, 'invalid_request', `Mode must be one of ${MODES.join(', ')}.`);
        req.session.mode = mode;
        delete req.session.counts; // the counts belong to the mode they were read in
        res.json(publicSession(req.session));
    });

    // Runs a crawl and streams newline-delimited JSON: {type:'progress'} counters, {type:'graph', nodes} batches
    // as resources are resolved, then one {type:'result'} summary (or {type:'error'}).
    const streamCrawl = async (req, res, label, params) => {
        const session = req.session;
        const controller = new AbortController();
        res.on('close', () => {
            if (!res.writableFinished) controller.abort();
        });
        res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const send = (message) => res.write(`${JSON.stringify(message)}\n`);

        let last = 0;
        try {
            const result = await crawl({
                // The crawler retries and adapts its own concurrency, so the client makes a single attempt.
                fetchConfig: configClient(session, { timeoutMs: config.requestTimeoutMs, retries: 0, signal: controller.signal }),
                rootTypes: ROOT_NAMES,
                concurrency: config.crawlConcurrency,
                signal: controller.signal,
                onProgress: (p) => {
                    const now = Date.now();
                    if (now - last >= 150) {
                        last = now;
                        send({ type: 'progress', ...p });
                    }
                },
                // Links aren't sent: each node lists the ids it relates to, and the client derives the links.
                onBatch: (nodes) => send({ type: 'graph', nodes }),
                ...params,
            });
            // The graph itself has already been streamed; this is the summary.
            send({
                type: 'result',
                truncated: result.truncated,
                warnings: result.warnings,
                stats: { ...result.stats, nodes: result.nodes.length, links: result.links.length },
            });
            log.info(
                `${label}: ${result.nodes.length} resources, ${result.stats.requests} requests, ${result.stats.ms}ms (${session.mode})`
            );
        } catch (err) {
            if (controller.signal.aborted || isAbort(err)) return;
            if (err instanceof UpstreamError && err.status === 401) {
                expire(req, res);
                send({ type: 'error', code: 'session_expired', message: 'Your session has ended. Sign in again.' });
            } else {
                log.error('crawl failed:', err.message);
                send({ type: 'error', code: 'upstream_error', message: err.message || 'The crawl failed.' });
            }
        } finally {
            res.end();
        }
    };

    // Reads the selected root resource types. Relationships are not followed: see /api/expand.
    app.post('/api/graph', requireSession, async (req, res) => {
        const body = req.body ?? {};
        const roots = Array.isArray(body.roots) ? [...new Set(body.roots)] : [];
        if (roots.length === 0 || roots.length > ROOTS.length || !roots.every((r) => ROOT_NAMES.has(r))) {
            throw new HttpError(400, 'invalid_request', 'Choose at least one root resource type.');
        }
        const perRoot = integer(body.perRoot, 'Resources per type', { min: 1, max: 10_000, fallback: 25 });
        const maxResources = integer(body.maxResources, 'Max resources', { min: 1, max: config.maxResourcesCap, fallback: 500 });
        await streamCrawl(req, res, `graph ${roots.join(',')}`, { roots, perRoot, maxResources, follow: 'none' });
    });

    // Loads relationships of resources the client already has. The client sends the relationship groups still to load
    // and the ids it already holds; `follow: 'one'` loads just those, `'all'` keeps following from whatever is found.
    app.post('/api/expand', requireSession, async (req, res) => {
        const { tasks, known, follow } = parseExpand(req.body);
        // The user's Max resources doesn't apply to expansion, however large the graph already is. The only bound is a
        // backstop on how many *new* resources one request may add (known ids count against the crawler's budget).
        const maxResources = known.length + config.maxResourcesCap;
        await streamCrawl(req, res, `expand(${follow}) ${tasks.length} groups`, { tasks, known, follow, maxResources });
    });

    app.use('/api', (req, res) => {
        res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
    });

    // The built client. Absent in development, where Vite serves it and proxies /api here.
    const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
    if (existsSync(dist)) {
        app.use(express.static(dist));
        app.use((req, res) => res.sendFile('index.html', { root: dist }));
    }

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (res.headersSent) {
            log.error(`${req.method} ${req.path} failed after the response started:`, err.message);
            return res.end();
        }
        if (err instanceof HttpError) {
            return res.status(err.status).json({ error: { code: err.code, message: err.message } });
        }
        if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
            return res.status(400).json({ error: { code: 'invalid_request', message: 'The request body was not valid JSON.' } });
        }
        log.error(`${req.method} ${req.path}:`, err);
        res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } });
    });

    app.locals.sessions = sessions;
    return app;
}
