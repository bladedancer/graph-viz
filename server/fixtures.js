// A tiny in-memory Fusion tenant for tests: a JSON:API config model plus the HTTP routes the server talks to.
import { createServer } from 'node:http';

const rel = (...targets) => ({ data: targets.map(([type, id]) => ({ type, id })) });
const one = (type, id) => ({ data: { type, id } });

export const buildTenant = () => ({
    project: [
        {
            type: 'project',
            id: 'p1',
            attributes: { name: 'Payments', projectId: 'p1' },
            relationships: { apiproxies: rel(['apiproxy', 'a1']), endpoints: rel(['endpoint', 'e1']) },
        },
        {
            type: 'project',
            id: 'p2',
            attributes: { name: 'Portal', projectId: 'p2' },
            relationships: { apiproxies: rel(['apiproxy', 'a2']), endpoints: rel(['endpoint', 'e1']) },
        },
        { type: 'project', id: 'p3', attributes: { name: 'Orders', projectId: 'p3' }, relationships: {} },
    ],
    apiproxy: [
        {
            type: 'apiproxy',
            id: 'a1',
            attributes: { name: 'Payments v2' },
            relationships: { project: one('project', 'p1'), endpoints: rel(['endpoint', 'e1']) },
        },
        { type: 'apiproxy', id: 'a2', attributes: { name: 'Profiles' }, relationships: { endpoints: rel(['endpoint', 'e1']) } },
    ],
    // No collection of its own: reachable only through a parent.
    endpoint: [{ type: 'endpoint', id: 'e1', attributes: { name: 'shared-prod' }, relationships: {} }],
});

const NESTED_ONLY = new Set(['endpoint']);

/** Resolves a config path (list, by id, or nested relationship) against `tenant`, or returns an error status. */
export function resolvePath(tenant, rawPath, { listable = true, noTotals = [] } = {}) {
    const url = new URL(rawPath, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [type, id, ...rest] = parts;
    if (!tenant[type]) return { status: 404, body: { errors: [{ detail: `Unknown collection ${type}` }] } };
    if (parts.length === 1) {
        if (noTotals.includes(type) && url.searchParams.has('page[totals]')) {
            return {
                status: 400,
                body: { errors: [{ status: 'BAD_REQUEST', title: 'Unexpected Error', detail: 'Unable to process request' }] },
            };
        }
        if (!listable || NESTED_ONLY.has(type)) return { status: 404, body: { errors: [{ detail: `Unknown collection ${type}` }] } };
        const size = Number(url.searchParams.get('page[size]') ?? 10);
        const number = Number(url.searchParams.get('page[number]') ?? 1);
        const all = tenant[type];
        return {
            status: 200,
            body: {
                data: all.slice((number - 1) * size, number * size),
                meta: { page: { number, limit: size, totalPages: Math.ceil(all.length / size), totalRecords: all.length } },
            },
        };
    }
    // A trailing relationship name with no id lists that relationship's collection.
    const collection = rest.length % 2 === 1 ? rest.at(-1) : null;
    const pairs = collection ? rest.slice(0, -1) : rest;
    let current = tenant[type].find((r) => r.id === id);
    if (NESTED_ONLY.has(type) && rest.length === 0) current = undefined; // by-id fetch of a nested-only type fails
    for (let i = 0; current && i < pairs.length; i += 2) {
        const target = current.relationships[pairs[i]]?.data;
        const wanted = [].concat(target ?? []).find((t) => t.id === pairs[i + 1]);
        current = wanted && tenant[wanted.type]?.find((r) => r.id === wanted.id);
    }
    if (current && collection) {
        const all = []
            .concat(current.relationships[collection]?.data ?? [])
            .map((t) => tenant[t.type]?.find((r) => r.id === t.id))
            .filter(Boolean);
        const size = Number(url.searchParams.get('page[size]') ?? 10);
        const number = Number(url.searchParams.get('page[number]') ?? 1);
        return { status: 200, body: { data: all.slice((number - 1) * size, number * size), meta: { page: { number, limit: size } } } };
    }
    return current ? { status: 200, body: { data: current } } : { status: 404, body: { errors: [{ detail: 'Not found' }] } };
}

/** Starts a fake tenant that serves login, logout and the config API. Resolves { url, calls, close }. */
export async function startFakeTenant({
    tenant = buildTenant(),
    email = 'ada@example.com',
    password = 'secret',
    token = 'tok-123',
    expireAfter = Infinity,
    noTotals = [],
} = {}) {
    const calls = { login: 0, logout: 0, config: [], modes: [] };
    const server = createServer((req, res) => {
        const reply = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            if (req.method === 'POST' && req.url === '/api/auth/login') {
                calls.login++;
                const body = JSON.parse(raw || '{}');
                calls.lastLogin = body;
                if (body.email !== email || body.password !== password) return reply(401, { message: 'bad credentials' });
                return reply(200, {
                    access_token: token,
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    email,
                    userPreference: { defaultMode: { modeName: 'DESIGN' } },
                });
            }
            if (req.url === '/api/auth/logout') {
                calls.logout++;
                return reply(200, {});
            }
            if (req.url.startsWith('/api/config/v1')) {
                if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { errors: [{ detail: 'Unauthorized' }] });
                if (!['DESIGN', 'CHECK', 'LIVE'].includes(String(req.headers['env-mode']).toUpperCase())) return reply(403, {});
                calls.modes.push(req.headers['env-mode']);
                calls.config.push(req.url.replace('/api/config/v1', ''));
                if (calls.config.length > expireAfter) return reply(401, { errors: [{ detail: 'Token expired' }] });
                const { status, body } = resolvePath(tenant, req.url.replace('/api/config/v1', ''), { noTotals });
                return reply(status, body);
            }
            reply(404, {});
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, calls, tenant, close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))) };
}
