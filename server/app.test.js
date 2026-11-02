import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.js';
import { startFakeTenant } from './fixtures.js';
import { SessionStore } from './sessions.js';
import { configClient } from './upstream.js';

let tenant;
let main;
let base;

const baseConfig = (extra = {}) => ({
    sessionTtlMs: 60_000,
    allowedTenantHosts: [],
    allowedOrigins: [],
    trustProxy: false,
    requestTimeoutMs: 5000,
    crawlConcurrency: 4,
    maxResourcesCap: 5000,
    envMode: 'DESIGN',
    loginAttemptsPerMinute: 1000,
    ...extra,
});

// Starts the app on an ephemeral port. close() drops keep-alive connections so the test process can exit.
const listen = async (config) => {
    const sessions = new SessionStore({ ttlMs: config.sessionTtlMs });
    const app = createApp({ config, sessions });
    const srv = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const close = () => {
        sessions.close();
        return new Promise((resolve) => (srv.closeAllConnections(), srv.close(resolve)));
    };
    return { url: `http://127.0.0.1:${srv.address().port}`, close };
};

const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const signIn = async (credentials = {}) => {
    const res = await post('/api/login', { tenantUrl: tenant.url, email: 'ada@example.com', password: 'secret', ...credentials });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    return { res, cookie, body: await res.json() };
};

const readStream = async (res) => {
    const text = await res.text();
    return text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
};

describe('API', () => {
    before(async () => {
        tenant = await startFakeTenant();
        main = await listen(baseConfig({ servicesUrl: tenant.url }));
        base = main.url;
    });
    after(async () => {
        await main.close();
        await tenant.close();
    });

    describe('sign-in', () => {
        it('signs in, sets an HttpOnly SameSite=Strict cookie and never returns the token', async () => {
            const { res, body } = await signIn();
            assert.equal(res.status, 200);
            assert.deepEqual(body, {
                authenticated: true,
                user: { name: 'Ada Lovelace', email: 'ada@example.com' },
                tenantUrl: tenant.url,
                mode: 'DESIGN',
            });
            const setCookie = res.headers.get('set-cookie');
            assert.match(setCookie, /HttpOnly/i);
            assert.match(setCookie, /SameSite=Strict/i);
            assert.ok(!JSON.stringify(body).includes('tok-123'));
            assert.equal(tenant.calls.lastLogin.domain, '127');
        });

        it('rejects wrong credentials without setting a cookie', async () => {
            const { res, body, cookie } = await signIn({ password: 'nope' });
            assert.equal(res.status, 401);
            assert.equal(body.error.code, 'invalid_credentials');
            assert.equal(cookie, undefined);
        });

        it('validates the request', async () => {
            assert.equal((await post('/api/login', { tenantUrl: 'not a url', email: 'a', password: 'b' })).status, 400);
            assert.equal((await post('/api/login', { tenantUrl: 'ftp://x.example.com', email: 'a', password: 'b' })).status, 400);
            assert.equal((await post('/api/login', { tenantUrl: tenant.url, email: '', password: 'b' })).status, 400);
            assert.equal((await post('/api/login', {})).status, 400);
        });

        it('reports an unreachable tenant', async () => {
            const other = await listen(baseConfig({ servicesUrl: 'http://127.0.0.1:1' }));
            const res = await fetch(`${other.url}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantUrl: tenant.url, email: 'a', password: 'b' }),
            });
            assert.equal(res.status, 502);
            assert.equal((await res.json()).error.code, 'unreachable');
            await other.close();
        });

        it('only signs in to allowed tenant hosts', async () => {
            const other = await listen(baseConfig({ servicesUrl: tenant.url, allowedTenantHosts: ['*.fusion.example.com'] }));
            const res = await fetch(`${other.url}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantUrl: tenant.url, email: 'ada@example.com', password: 'secret' }),
            });
            assert.equal(res.status, 403);
            assert.equal((await res.json()).error.code, 'tenant_not_allowed');
            await other.close();
        });

        it('rate-limits sign-in attempts', async () => {
            const other = await listen(baseConfig({ servicesUrl: tenant.url, loginAttemptsPerMinute: 2 }));
            const attempt = () =>
                fetch(`${other.url}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tenantUrl: tenant.url, email: 'ada@example.com', password: 'wrong' }),
                });
            assert.equal((await attempt()).status, 401);
            assert.equal((await attempt()).status, 401);
            const limited = await attempt();
            assert.equal(limited.status, 429);
            assert.equal(limited.headers.get('retry-after'), '60');
            await other.close();
        });

        it('refuses cross-origin writes', async () => {
            const res = await post(
                '/api/login',
                { tenantUrl: tenant.url, email: 'ada@example.com', password: 'secret' },
                { Origin: 'http://evil.example' }
            );
            assert.equal(res.status, 403);
        });

        it('accepts same-origin writes', async () => {
            const { res } = await signIn();
            assert.equal(res.status, 200);
            const same = await post(
                '/api/login',
                { tenantUrl: tenant.url, email: 'ada@example.com', password: 'secret' },
                { Origin: base }
            );
            assert.equal(same.status, 200);
        });
    });

    describe('session', () => {
        it('reports who is signed in, and logs out', async () => {
            const { cookie } = await signIn();
            const state = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
            assert.equal(state.authenticated, true);
            const logoutsBefore = tenant.calls.logout;
            const out = await post('/api/logout', {}, { cookie });
            assert.equal(out.status, 200);
            assert.equal(tenant.calls.logout, logoutsBefore + 1);
            assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).authenticated, false);
        });

        it('is unauthenticated without a cookie', async () => {
            assert.deepEqual(await (await fetch(`${base}/api/session`)).json(), { authenticated: false });
            assert.equal((await fetch(`${base}/api/roots`)).status, 401);
            assert.equal((await post('/api/graph', { roots: ['project'] })).status, 401);
        });
    });

    describe('roots', () => {
        it('lists the root-level resource types only', async () => {
            const { cookie } = await signIn();
            const { roots } = await (await fetch(`${base}/api/roots`, { headers: { cookie } })).json();
            const names = roots.map((r) => r.name);
            assert.ok(names.includes('apiproxy') && names.includes('project') && names.includes('application'));
            assert.ok(!names.includes('ratelimit') && !names.includes('virtualhost'), 'rootLevel = false types must be excluded');
            assert.ok(!names.includes('envmode'), 'envmode is left out on purpose');
            assert.ok(roots.find((r) => r.name === 'apiproxy').label === 'API');
        });

        it('counts resources per type and reports types the tenant cannot list', async () => {
            const { cookie } = await signIn();
            const { counts } = await (await fetch(`${base}/api/roots/counts`, { headers: { cookie } })).json();
            assert.deepEqual(counts.project, { total: 3 });
            assert.equal(counts.apiproxy.total, 2);
            assert.equal(counts.team.status, 404);
        });
    });

    describe('roots with types that reject page[totals]', () => {
        it('keeps them usable with an unknown count, and only reports types that cannot be listed at all', async () => {
            const picky = await startFakeTenant({ noTotals: ['apiproxy'] });
            const other = await listen(baseConfig({ servicesUrl: picky.url }));
            const login = await fetch(`${other.url}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantUrl: picky.url, email: 'ada@example.com', password: 'secret' }),
            });
            const cookie = login.headers.get('set-cookie').split(';')[0];
            const { counts } = await (await fetch(`${other.url}/api/roots/counts`, { headers: { cookie } })).json();
            assert.deepEqual(counts.apiproxy, { total: null }, 'listable without totals');
            assert.deepEqual(counts.project, { total: 3 });
            assert.equal(counts.team.status, 404, 'unlistable types are still reported');
            assert.ok(picky.calls.config.includes('/apiproxy?page[size]=1'), 'retried without page[totals]');
            await other.close();
            await picky.close();
        });
    });

    describe('graph', () => {
        it('streams progress and then the selected root resources, without their relationships', async () => {
            const { cookie } = await signIn();
            const res = await post('/api/graph', { roots: ['project'], perRoot: 10, maxResources: 50 }, { cookie });
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /ndjson/);
            const messages = await readStream(res);
            const result = messages.at(-1);
            assert.equal(result.type, 'result');
            assert.equal(result.truncated, false);
            assert.equal(result.stats.nodes, 3);
            assert.deepEqual(result.warnings, []);
            assert.ok(messages.slice(0, -1).every((m) => m.type === 'progress' || m.type === 'graph'));
            const nodes = messages.filter((m) => m.type === 'graph').flatMap((m) => m.nodes);
            assert.deepEqual(nodes.map((n) => n.id).sort(), ['project:p1', 'project:p2', 'project:p3']);
            assert.ok(nodes.every((n) => n.root && n.path.startsWith('/project/')));
            assert.equal(nodes.length, 3, 'nothing beyond the roots was loaded');
            assert.ok(
                messages.every((m) => m.links === undefined),
                'links are derived by the client, not sent'
            );
            assert.deepEqual(
                nodes.find((n) => n.id === 'project:p1').relationships.apiproxies,
                ['apiproxy:a1'],
                'but each knows what it relates to'
            );
        });

        it('validates roots and limits', async () => {
            const { cookie } = await signIn();
            for (const body of [
                {},
                { roots: [] },
                { roots: ['nonsense'] },
                { roots: ['project'], perRoot: 0 },
                { roots: ['project'], perRoot: 10_001 },
                { roots: ['project'], maxResources: 'many' },
                { roots: ['project'], maxResources: 999999 },
            ]) {
                const res = await post('/api/graph', body, { cookie });
                assert.equal(res.status, 400, JSON.stringify(body));
                assert.equal((await res.json()).error.code, 'invalid_request');
            }
        });

        it('accepts the largest limits: 10,000 per type and 100,000 resources', async () => {
            const big = await listen(baseConfig({ servicesUrl: tenant.url, maxResourcesCap: 100_000 }));
            const login = await fetch(`${big.url}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantUrl: tenant.url, email: 'ada@example.com', password: 'secret' }),
            });
            const cookie = login.headers.get('set-cookie').split(';')[0];
            const post = (body) =>
                fetch(`${big.url}/api/graph`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', cookie },
                    body: JSON.stringify(body),
                });
            const ok = await post({ roots: ['project'], perRoot: 10_000, maxResources: 100_000 });
            assert.equal(ok.status, 200);
            assert.equal((await readStream(ok)).at(-1).type, 'result');
            assert.equal((await post({ roots: ['project'], maxResources: 100_001 })).status, 400);
            await big.close();
        });

        it('ends the session when the tenant rejects the token mid-crawl', async () => {
            const expiring = await startFakeTenant({ expireAfter: 0 });
            const other = await listen(baseConfig({ servicesUrl: expiring.url }));
            const url = other.url;
            const login = await fetch(`${url}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantUrl: expiring.url, email: 'ada@example.com', password: 'secret' }),
            });
            const cookie = login.headers.get('set-cookie').split(';')[0];
            const res = await fetch(`${url}/api/graph`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', cookie },
                body: JSON.stringify({ roots: ['project'] }),
            });
            const last = (await readStream(res)).at(-1);
            assert.equal(last.type, 'error');
            assert.equal(last.code, 'session_expired');
            assert.equal((await (await fetch(`${url}/api/session`, { headers: { cookie } })).json()).authenticated, false);
            await other.close();
            await expiring.close();
        });
    });

    describe('expand', () => {
        const expand = (cookie, body) =>
            fetch(`${base}/api/expand`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', cookie },
                body: JSON.stringify(body),
            });
        const proxies = { path: '/project/p1', rel: 'apiproxies', total: 1, targets: [{ type: 'apiproxy', id: 'a1' }] };
        const request = (over = {}) => ({ follow: 'one', maxResources: 50, known: ['project:p1'], tasks: [proxies], ...over });
        const nodesOf = (messages) => messages.filter((m) => m.type === 'graph').flatMap((m) => m.nodes.map((n) => n.id));

        it('loads just the relationships it is asked for (follow: one)', async () => {
            const { cookie } = await signIn();
            const messages = await readStream(await expand(cookie, request()));
            assert.deepEqual(nodesOf(messages), ['apiproxy:a1']);
            assert.equal(messages.at(-1).type, 'result');
        });

        it('keeps following what it finds (follow: all)', async () => {
            const { cookie } = await signIn();
            const messages = await readStream(await expand(cookie, request({ follow: 'all' })));
            assert.deepEqual(nodesOf(messages).sort(), ['apiproxy:a1', 'endpoint:e1']);
        });

        it('does not fetch what the client says it already has', async () => {
            const { cookie } = await signIn();
            const messages = await readStream(await expand(cookie, request({ follow: 'all', known: ['project:p1', 'endpoint:e1'] })));
            assert.deepEqual(nodesOf(messages), ['apiproxy:a1']);
        });

        it('refuses malformed requests without touching the tenant', async () => {
            const { cookie } = await signIn();
            const before = tenant.calls.config.length;
            for (const body of [
                {},
                request({ follow: 'none' }),
                request({ tasks: [] }),
                request({ tasks: [{ ...proxies, path: '/project/../admin' }] }),
                request({ tasks: [{ ...proxies, path: 'https://evil.example/x/y' }] }),
                request({ maxResources: 999_999 }),
            ]) {
                const res = await expand(cookie, body);
                assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
            }
            assert.equal(tenant.calls.config.length, before);
        });

        it('needs a session', async () => {
            assert.equal((await expand('', request())).status, 401);
        });
    });

    describe('environment mode', () => {
        const putMode = (cookie, mode) =>
            fetch(`${base}/api/mode`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', cookie },
                body: JSON.stringify({ mode }),
            });

        it('sends the mode as Env-Mode on every request and changes it on request', async () => {
            const { cookie } = await signIn();
            await readStream(await post('/api/graph', { roots: ['project'], perRoot: 5, maxResources: 10 }, { cookie }));
            assert.equal(tenant.calls.modes.at(-1), 'DESIGN');

            const res = await putMode(cookie, 'CHECK');
            assert.equal(res.status, 200);
            assert.equal((await res.json()).mode, 'CHECK');
            assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).mode, 'CHECK');

            await readStream(await post('/api/graph', { roots: ['project'], perRoot: 5, maxResources: 10 }, { cookie }));
            assert.equal(tenant.calls.modes.at(-1), 'CHECK');

            await putMode(cookie, 'LIVE');
            await fetch(`${base}/api/roots/counts`, { headers: { cookie } });
            assert.equal(tenant.calls.modes.at(-1), 'LIVE');
        });

        it("counts again after the mode changes, rather than serving the old mode's numbers", async () => {
            const { cookie } = await signIn();
            await fetch(`${base}/api/roots/counts`, { headers: { cookie } });
            const before = tenant.calls.config.length;
            await fetch(`${base}/api/roots/counts`, { headers: { cookie } });
            assert.equal(tenant.calls.config.length, before, 'cached while the mode is unchanged');
            await putMode(cookie, 'LIVE');
            await fetch(`${base}/api/roots/counts`, { headers: { cookie } });
            assert.ok(tenant.calls.config.length > before, 'recounted after the change');
        });

        it('accepts any capitalisation and rejects anything that is not a mode', async () => {
            const { cookie } = await signIn();
            assert.equal((await (await putMode(cookie, 'check')).json()).mode, 'CHECK');
            for (const mode of ['', 'TEST', 'PRODUCTION', 'DESIGN; DROP', undefined, 7]) {
                assert.equal((await putMode(cookie, mode)).status, 400, String(mode));
            }
            assert.equal(
                (await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).mode,
                'CHECK',
                'unchanged by the bad requests'
            );
        });

        it('needs a session and refuses cross-origin changes', async () => {
            assert.equal((await putMode('', 'LIVE')).status, 401);
            const { cookie } = await signIn();
            const res = await fetch(`${base}/api/mode`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', cookie, Origin: 'http://evil.example' },
                body: JSON.stringify({ mode: 'LIVE' }),
            });
            assert.equal(res.status, 403);
        });

        it('keeps the mode a request started in, even if the session changes meanwhile', async () => {
            const session = { tenantUrl: tenant.url, token: 'tok-123', mode: 'DESIGN' };
            const client = configClient(session, { retries: 0 });
            session.mode = 'LIVE';
            await client('/project?page[size]=1');
            assert.equal(tenant.calls.modes.at(-1), 'DESIGN');
        });
    });

    it('answers unknown API paths with JSON 404', async () => {
        const res = await fetch(`${base}/api/nope`);
        assert.equal(res.status, 404);
        assert.equal((await res.json()).error.code, 'not_found');
    });

    it('sends security headers', async () => {
        const res = await fetch(`${base}/api/session`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });
});
