import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crawl } from './crawler.js';
import { UpstreamError } from './errors.js';
import { buildTenant, resolvePath } from './fixtures.js';

const fakeClient =
    (tenant, calls = []) =>
    async (path) => {
        calls.push(path);
        const { status, body } = resolvePath(tenant, path);
        if (status !== 200) throw new UpstreamError(body.errors[0].detail, { status });
        return body;
    };
const rootTypes = new Set(['project', 'apiproxy']);
const run = (overrides = {}) => {
    const calls = [];
    const promise = crawl({
        retryDelayMs: 1,
        fetchConfig: fakeClient(buildTenant(), calls),
        roots: ['project'],
        rootTypes,
        perRoot: 25,
        maxResources: 100,
        ...overrides,
    });
    return promise.then((result) => ({ ...result, calls }));
};

describe('crawl', () => {
    it('lists each root type and follows relationships, de-duplicating shared resources', async () => {
        const { nodes, links, truncated } = await run();
        assert.deepEqual(nodes.map((n) => n.id).sort(), [
            'apiproxy:a1',
            'apiproxy:a2',
            'endpoint:e1',
            'project:p1',
            'project:p2',
            'project:p3',
        ]);
        assert.equal(truncated, false);
        assert.equal(nodes.filter((n) => n.root).length, 3);
        assert.equal(links.filter((l) => l.target === 'endpoint:e1').length, 4);
        assert.ok(links.every((l) => nodes.some((n) => n.id === l.source) && nodes.some((n) => n.id === l.target)));
    });

    it('labels resources from their attributes', async () => {
        const { nodes } = await run();
        assert.equal(nodes.find((n) => n.id === 'apiproxy:a1').label, 'Payments v2');
    });

    it('caps each root type at perRoot and pages through the collection', async () => {
        const { nodes, calls } = await run({ perRoot: 2 });
        assert.equal(nodes.filter((n) => n.root).length, 2);
        assert.ok(calls.some((c) => c.startsWith('/project?page[size]=2&page[number]=1')));
        assert.ok(!calls.some((c) => c.includes('page[number]=3')));
    });

    it('fetches a type that has no collection through its parent', async () => {
        const { calls } = await run();
        assert.ok(
            calls.some((c) => /^\/(project|apiproxy)\/[^/]+\/(endpoints)\/e1$/.test(c)),
            calls.join('\n')
        );
    });

    it('fetches resources of a root type by id, falling back to the nested path when that fails', async () => {
        const tenant = buildTenant();
        const calls = [];
        const client = async (path) => {
            calls.push(path);
            if (path === '/apiproxy/a1') throw new UpstreamError('Unexpected Error', { status: 400 });
            return fakeClient(tenant)(path);
        };
        const { nodes } = await crawl({
            retryDelayMs: 1,
            fetchConfig: client,
            roots: ['project'],
            rootTypes,
            perRoot: 1,
            maxResources: 100,
        });
        assert.ok(nodes.some((n) => n.id === 'apiproxy:a1' && !n.unresolved));
        assert.ok(calls.includes('/apiproxy/a1') && calls.includes('/project/p1/apiproxies/a1'));
    });

    it('stops at maxResources, reports truncation and keeps no dangling links', async () => {
        const { nodes, links, truncated } = await run({ maxResources: 4 });
        assert.equal(nodes.length, 4);
        assert.equal(truncated, true);
        const ids = new Set(nodes.map((n) => n.id));
        assert.ok(links.every((l) => ids.has(l.source) && ids.has(l.target)));
    });

    it('keeps resources it cannot fetch as unresolved placeholders and summarises the failures', async () => {
        const tenant = buildTenant();
        tenant.endpoint = []; // e1 is referenced but gone
        const { nodes, links, warnings } = await crawl({
            retryDelayMs: 1,
            fetchConfig: fakeClient(tenant),
            roots: ['project'],
            rootTypes,
            perRoot: 25,
            maxResources: 100,
        });
        const e1 = nodes.find((n) => n.id === 'endpoint:e1');
        assert.equal(e1.unresolved, true);
        assert.ok(links.some((l) => l.target === 'endpoint:e1'));
        assert.deepEqual(
            warnings.map((w) => [w.type, w.status]),
            [['endpoint', 404]]
        );
        assert.equal(warnings[0].count, 1);
    });

    it('records a root type the tenant cannot list as a warning and carries on', async () => {
        const client = async (path) => {
            if (path.startsWith('/apiproxy?')) throw new UpstreamError('Unexpected Error', { status: 400 });
            return fakeClient(buildTenant())(path);
        };
        const { nodes, warnings } = await crawl({
            retryDelayMs: 1,
            fetchConfig: client,
            roots: ['apiproxy', 'project'],
            rootTypes,
            perRoot: 25,
            maxResources: 100,
        });
        assert.ok(nodes.some((n) => n.type === 'project'));
        assert.deepEqual(
            warnings.map((w) => [w.type, w.status]),
            [['apiproxy', 400]]
        );
    });

    it('fails the whole crawl when the token is rejected', async () => {
        const client = async () => {
            throw new UpstreamError('Unauthorized', { status: 401 });
        };
        await assert.rejects(crawl({ retryDelayMs: 1, fetchConfig: client, roots: ['project'], rootTypes, perRoot: 5, maxResources: 10 }), {
            status: 401,
        });
    });

    it('stops when aborted', async () => {
        const controller = new AbortController();
        const client = async (path) => {
            controller.abort();
            return fakeClient(buildTenant())(path);
        };
        await assert.rejects(
            crawl({
                retryDelayMs: 1,
                fetchConfig: client,
                roots: ['project'],
                rootTypes,
                perRoot: 5,
                maxResources: 100,
                signal: controller.signal,
            }),
            { name: 'AbortError' }
        );
    });

    describe('large root types', () => {
        const projects = (n) => ({
            project: Array.from({ length: n }, (_, i) => ({
                type: 'project',
                id: `p${i}`,
                attributes: { name: `P${i}` },
                relationships: {},
            })),
        });
        const crawlProjects = (n, extra = {}, client) => {
            const calls = [];
            return crawl({
                retryDelayMs: 1,
                fetchConfig: client?.(calls) ?? fakeClient(projects(n), calls),
                roots: ['project'],
                rootTypes: new Set(['project']),
                perRoot: n,
                maxResources: n,
                ...extra,
            }).then((result) => ({ ...result, calls }));
        };

        it('reads a type that spans several pages, each exactly once', async () => {
            const { nodes, calls } = await crawlProjects(250);
            assert.equal(nodes.length, 250);
            assert.deepEqual(calls.map((c) => c.match(/page\[number\]=(\d+)/)[1]).sort(), ['1', '2', '3']);
        });

        it('never has more requests in flight than the concurrency limit', async () => {
            let inFlight = 0;
            let peak = 0;
            const client = (calls) => async (path) => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                await new Promise((r) => setTimeout(r, 5));
                try {
                    return await fakeClient(projects(1000), calls)(path);
                } finally {
                    inFlight--;
                }
            };
            const { nodes } = await crawlProjects(1000, { concurrency: 3 }, client);
            assert.equal(nodes.length, 1000);
            assert.ok(peak > 1, 'pages are fetched in parallel');
            assert.ok(peak <= 3, `peak was ${peak}`);
        });

        it('does not request pages it has no budget for', async () => {
            const { nodes, calls, truncated } = await crawlProjects(1000, { perRoot: 1000, maxResources: 150 });
            assert.equal(nodes.length, 150);
            assert.equal(truncated, true);
            assert.equal(calls.length, 2);
        });
    });

    describe('growing an existing graph', () => {
        const rootTypesAll = new Set(['project', 'apiproxy']);
        const group = (path, rel, ids, type, total = ids.length) => ({ path, rel, total, targets: ids.map((id) => ({ type, id })) });

        it('loads only what it is asked for, without following relationships (follow: one)', async () => {
            const calls = [];
            const streamedLinks = [];
            const { nodes } = await crawl({
                fetchConfig: fakeClient(buildTenant(), calls),
                rootTypes: rootTypesAll,
                maxResources: 100,
                follow: 'one',
                known: ['project:p1'],
                tasks: [group('/project/p1', 'apiproxies', ['a1'], 'apiproxy')],
                onBatch: (_n, l) => streamedLinks.push(...l),
            });
            assert.deepEqual(
                nodes.map((n) => n.id),
                ['apiproxy:a1']
            );
            assert.equal(nodes[0].path.endsWith('a1'), true, 'a node reports the path it was fetched at');
            assert.ok(
                streamedLinks.some((l) => l.source === 'apiproxy:a1' && l.target === 'project:p1'),
                'its links to resources the caller already has are streamed'
            );
            assert.ok(!calls.some((c) => c.includes('endpoints')), "did not go on to the proxy's endpoints");
        });

        it('follows everything reachable from the tasks (follow: all)', async () => {
            const { nodes } = await crawl({
                fetchConfig: fakeClient(buildTenant()),
                rootTypes: rootTypesAll,
                maxResources: 100,
                follow: 'all',
                known: ['project:p1'],
                tasks: [group('/project/p1', 'apiproxies', ['a1'], 'apiproxy')],
            });
            assert.deepEqual(nodes.map((n) => n.id).sort(), ['apiproxy:a1', 'endpoint:e1']);
        });

        it('never fetches a resource the caller already has', async () => {
            const calls = [];
            const { nodes } = await crawl({
                fetchConfig: fakeClient(buildTenant(), calls),
                rootTypes: rootTypesAll,
                maxResources: 100,
                follow: 'all',
                known: ['project:p1', 'endpoint:e1'],
                tasks: [group('/project/p1', 'apiproxies', ['a1'], 'apiproxy')],
            });
            assert.deepEqual(
                nodes.map((n) => n.id),
                ['apiproxy:a1']
            );
            assert.ok(!calls.some((c) => c.includes('e1')));
        });

        it('counts the known resources against the budget', async () => {
            const { nodes, truncated } = await crawl({
                fetchConfig: fakeClient(buildTenant()),
                rootTypes: rootTypesAll,
                maxResources: 2,
                follow: 'all',
                known: ['project:p1'],
                tasks: [group('/project/p1', 'apiproxies', ['a1'], 'apiproxy'), group('/project/p1', 'endpoints', ['e1'], 'endpoint')],
            });
            assert.equal(nodes.length, 1);
            assert.equal(truncated, true);
        });

        it('lists roots and loads no relationships when asked for none (follow: none)', async () => {
            const calls = [];
            const { nodes, links } = await crawl({
                fetchConfig: fakeClient(buildTenant(), calls),
                roots: ['project'],
                rootTypes: rootTypesAll,
                perRoot: 25,
                maxResources: 100,
                follow: 'none',
            });
            assert.deepEqual(nodes.map((n) => n.id).sort(), ['project:p1', 'project:p2', 'project:p3']);
            assert.equal(calls.length, 1, 'just the listing');
            assert.ok(links.length === 0, 'links to resources that were not loaded are dropped');
            assert.deepEqual(
                nodes.find((n) => n.id === 'project:p1').relationships.apiproxies,
                ['apiproxy:a1'],
                'but the node remembers what it relates to'
            );
        });
    });

    describe('a flaky listing', () => {
        it('skips a page that keeps failing and carries on with the rest', async () => {
            const projects = Array.from({ length: 400 }, (_, i) => ({
                type: 'project',
                id: `p${i}`,
                attributes: { name: `P${i}` },
                relationships: {},
            }));
            const base = fakeClient({ project: projects });
            const client = async (path) => {
                if (path.includes('page[number]=2')) throw new UpstreamError('Unexpected exception caught', { status: 500 });
                return base(path);
            };
            const { nodes, warnings } = await crawl({
                fetchConfig: client,
                roots: ['project'],
                rootTypes: new Set(['project']),
                perRoot: 400,
                maxResources: 1000,
                follow: 'none',
            });
            assert.equal(nodes.length, 300, 'pages 1, 3 and 4');
            assert.deepEqual(
                warnings.map((w) => [w.type, w.status, w.count]),
                [['project', 500, 1]]
            );
        });

        it('gives up on a type once three pages in a row fail', async () => {
            const calls = [];
            const client = async (path) => {
                calls.push(path);
                throw new UpstreamError('Bad request', { status: 400 });
            };
            const { nodes, warnings } = await crawl({
                fetchConfig: client,
                roots: ['project'],
                rootTypes: new Set(['project']),
                perRoot: 1000,
                maxResources: 1000,
                concurrency: 2,
                follow: 'none',
            });
            assert.equal(nodes.length, 0);
            assert.equal(warnings[0].status, 400);
            assert.ok(calls.length < 10, `stopped early (${calls.length} calls)`);
        });
    });

    describe('budget', () => {
        const tenantOf = (projects, proxies) => ({
            project: Array.from({ length: projects }, (_, i) => ({
                type: 'project',
                id: `p${i}`,
                attributes: { name: `P${i}` },
                relationships: {},
            })),
            apiproxy: Array.from({ length: proxies }, (_, i) => ({
                type: 'apiproxy',
                id: `a${i}`,
                attributes: { name: `A${i}` },
                // every proxy points at its own pile of endpoints, which would swallow the whole budget
                relationships: { endpoints: { data: Array.from({ length: 20 }, (_, j) => ({ type: 'endpoint', id: `e${i}-${j}` })) } },
            })),
            endpoint: Array.from({ length: proxies * 20 }, (_, k) => ({
                type: 'endpoint',
                id: `e${Math.floor(k / 20)}-${k % 20}`,
                attributes: { name: `E${k}` },
                relationships: {},
            })),
        });

        it('gives every selected root type its quota before relationships spend the rest', async () => {
            // The proxies are listed first and would, with their endpoints, use up the 100-resource budget.
            let slowProjects = true;
            const base = fakeClient(tenantOf(30, 30));
            const client = async (path) => {
                if (path.startsWith('/project?') && slowProjects) await new Promise((r) => setTimeout(r, 30));
                return base(path);
            };
            const { nodes } = await crawl({
                retryDelayMs: 1,
                fetchConfig: client,
                roots: ['apiproxy', 'project'],
                rootTypes: new Set(['apiproxy', 'project']),
                perRoot: 30,
                maxResources: 100,
            });
            assert.equal(nodes.filter((n) => n.type === 'project' && n.root).length, 30, 'all projects were read');
            assert.equal(nodes.filter((n) => n.type === 'apiproxy' && n.root).length, 30, 'all proxies were read');
            assert.equal(nodes.length, 100, 'and the rest of the budget went to endpoints');
        });

        it('keeps the roots even when they alone exceed the budget, and says so', async () => {
            const { nodes, truncated } = await crawl({
                retryDelayMs: 1,
                fetchConfig: fakeClient(tenantOf(50, 0)),
                roots: ['project'],
                rootTypes: new Set(['project']),
                perRoot: 50,
                maxResources: 20,
            });
            assert.equal(nodes.length, 20);
            assert.equal(truncated, true);
        });
    });

    describe('an overloaded tenant', () => {
        const projects = (n) => ({
            project: Array.from({ length: n }, (_, i) => ({
                type: 'project',
                id: `p${i}`,
                attributes: { name: `P${i}` },
                relationships: {},
            })),
        });
        const crawlWith = (n, client, extra = {}) =>
            crawl({
                retryDelayMs: 1,
                fetchConfig: client,
                roots: ['project'],
                rootTypes: new Set(['project']),
                perRoot: n,
                maxResources: n,
                ...extra,
            });
        const bad = (status) => new UpstreamError(status === 502 ? 'Bad Gateway' : 'Unavailable', { status });

        it('retries a gateway error and carries on as if nothing happened', async () => {
            let failures = 2;
            const calls = [];
            const base = fakeClient(projects(5), calls);
            const { nodes, warnings } = await crawlWith(5, async (path) => {
                if (failures-- > 0) throw bad(502);
                return base(path);
            });
            assert.equal(nodes.length, 5);
            assert.deepEqual(warnings, []);
            assert.equal(calls.length, 1, 'the two failed attempts never reached the tenant');
        });

        it('gives up on a request after five retries and reports it', async () => {
            let attempts = 0;
            const { nodes, warnings } = await crawlWith(5, async (path) => {
                if (path.includes('page[number]=1')) attempts++;
                throw bad(502);
            });
            assert.equal(nodes.length, 0);
            assert.equal(attempts, 6, 'one try plus five retries');
            assert.deepEqual(
                warnings.map((w) => [w.type, w.status]),
                [['project', 502]]
            );
        });

        it('retries a 500 twice, since some are transient and some are permanent', async () => {
            let attempts = 0;
            await crawlWith(5, async (path) => {
                if (path.includes('page[number]=1')) attempts++;
                throw new UpstreamError('Unexpected exception caught', { status: 500 });
            });
            assert.equal(attempts, 3, 'one try plus two retries');
        });

        it('does not retry errors that retrying cannot fix', async () => {
            let attempts = 0;
            await crawlWith(5, async (path) => {
                if (path.includes('page[number]=1')) attempts++;
                throw new UpstreamError('Unknown collection', { status: 404 });
            });
            assert.equal(attempts, 1);
        });

        it('backs its concurrency off until the tenant copes, instead of failing', async () => {
            // A gateway that sheds load once more than three requests are in flight.
            let inFlight = 0;
            const calls = [];
            const base = fakeClient(projects(1000), calls);
            const client = async (path) => {
                inFlight++;
                try {
                    await new Promise((r) => setTimeout(r, 2));
                    if (inFlight > 3) throw bad(502);
                    return await base(path);
                } finally {
                    inFlight--;
                }
            };
            const { nodes, warnings } = await crawlWith(1000, client, { concurrency: 12 });
            assert.equal(nodes.length, 1000);
            assert.deepEqual(warnings, []);
        });
    });

    describe('bulk loading of relationships', () => {
        // One project with n API proxies, each with one (nested-only) endpoint.
        const bigTenant = (n) => {
            const ids = Array.from({ length: n }, (_, i) => `a${i + 1}`);
            return {
                project: [
                    {
                        type: 'project',
                        id: 'p1',
                        attributes: { name: 'P' },
                        relationships: { apiproxies: { data: ids.map((id) => ({ type: 'apiproxy', id })) } },
                    },
                ],
                apiproxy: ids.map((id) => ({
                    type: 'apiproxy',
                    id,
                    attributes: { name: id },
                    relationships: { endpoints: { data: [{ type: 'endpoint', id: `e-${id}` }] } },
                })),
                endpoint: ids.map((id) => ({ type: 'endpoint', id: `e-${id}`, attributes: { name: `e-${id}` }, relationships: {} })),
            };
        };
        const crawlBig = (n, extra = {}, client) => {
            const calls = [];
            return crawl({
                retryDelayMs: 1,
                fetchConfig: client?.(calls) ?? fakeClient(bigTenant(n), calls),
                roots: ['project'],
                rootTypes: new Set(['project', 'apiproxy']),
                perRoot: 25,
                maxResources: 1000,
                ...extra,
            }).then((result) => ({ ...result, calls }));
        };

        it("lists a parent's children in one request instead of one request per child", async () => {
            const { nodes, links, calls, stats } = await crawlBig(5);
            assert.equal(nodes.length, 11);
            assert.equal(links.length, 10);
            assert.equal(calls.filter((c) => c === '/project/p1/apiproxies?page[size]=100&page[number]=1').length, 1);
            assert.ok(
                !calls.some((c) => /^\/(project\/p1\/)?apiproxy(ies)?\/a\d/.test(c)),
                `no per-child requests for the proxies:\n${calls.join('\n')}`
            );
            assert.equal(stats.requests, 7, 'roots (1) + proxies in bulk (1) + five endpoints one at a time (5)');
        });

        it('keeps paging through a relationship larger than a page', async () => {
            const { nodes, calls } = await crawlBig(120);
            assert.equal(nodes.length, 241);
            const listings = calls.filter((c) => c.startsWith('/project/p1/apiproxies?'));
            assert.deepEqual(listings, [
                '/project/p1/apiproxies?page[size]=100&page[number]=1',
                '/project/p1/apiproxies?page[size]=100&page[number]=2',
            ]);
        });

        it('stays within maxResources and keeps only the children it claimed', async () => {
            const { nodes, links, truncated } = await crawlBig(50, { maxResources: 11 });
            assert.equal(nodes.length, 11);
            assert.equal(truncated, true);
            const ids = new Set(nodes.map((n) => n.id));
            assert.ok(links.every((l) => ids.has(l.source) && ids.has(l.target)));
        });

        it('fetches one child by id when listing the whole relationship would cost more', async () => {
            const { nodes, calls } = await crawlBig(250, { maxResources: 2 });
            assert.equal(nodes.length, 2);
            assert.ok(!calls.some((c) => c.startsWith('/project/p1/apiproxies?')), 'no listing');
            assert.ok(calls.includes('/apiproxy/a1'));
        });

        it('falls back to one request per child when the listing fails', async () => {
            const client = (calls) => async (path) => {
                if (path.includes('/apiproxies?')) throw new UpstreamError('boom', { status: 500 });
                return fakeClient(bigTenant(5), calls)(path);
            };
            const { nodes, warnings } = await crawlBig(5, {}, client);
            assert.equal(nodes.length, 11);
            assert.ok(nodes.every((n) => !n.unresolved));
            assert.deepEqual(warnings, []);
        });

        it('fetches any child the listing leaves out individually', async () => {
            const client = (calls) => async (path) => {
                const doc = await fakeClient(bigTenant(5), calls)(path);
                if (path.includes('/apiproxies?')) return { ...doc, data: doc.data.filter((r) => r.id !== 'a3') };
                return doc;
            };
            const { nodes, calls } = await crawlBig(5, {}, client);
            assert.equal(nodes.length, 11);
            assert.ok(calls.includes('/apiproxy/a3'));
        });

        it('stops on an expired token during a bulk load', async () => {
            const client = (calls) => async (path) => {
                if (path.includes('/apiproxies?')) throw new UpstreamError('Unauthorized', { status: 401 });
                return fakeClient(bigTenant(5), calls)(path);
            };
            await assert.rejects(crawlBig(5, {}, client), { status: 401 });
        });
    });

    it('hands resources to onBatch as they are resolved, and every one arrives exactly once', async () => {
        const batches = [];
        const { nodes, links } = await run({ onBatch: (n, l) => batches.push({ n, l }) });
        const streamed = batches.flatMap((b) => b.n.map((x) => x.id));
        assert.deepEqual(streamed.sort(), nodes.map((n) => n.id).sort());
        assert.equal(new Set(streamed).size, streamed.length);
        const streamedLinks = batches.flatMap((b) => b.l);
        assert.ok(links.every((l) => streamedLinks.includes(l)));
    });

    it('reports progress', async () => {
        const seen = [];
        await run({ onProgress: (p) => seen.push(p) });
        assert.ok(seen.length > 0);
        assert.ok(seen.at(-1).resources >= 6);
    });
});
