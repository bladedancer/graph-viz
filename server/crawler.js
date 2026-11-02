import { UpstreamError } from './errors.js';
import { sleep } from './sleep.js';

const PAGE_MAX = 100; // The tenant rejects larger page sizes.
const PATH_MAX = 1800; // Nested relationship paths grow with depth; stop before URLs get unreasonable.
const MAX_RETRIES = 5;
const MAX_RETRIES_500 = 2; // a 500 is sometimes transient ("Unexpected exception caught") and sometimes permanent
const MIN_CONCURRENCY = 2;
// Statuses that mean "the tenant (or its gateway) is struggling, try again": 0 is a network error or timeout.
const RETRYABLE = new Set([0, 429, 500, 502, 503, 504]);

const asArray = (data) => (Array.isArray(data) ? data : data ? [data] : []);
const key = (type, id) => `${type}:${id}`;
// Ids can contain ":" (project:V1 style); keep it readable and valid in a path.
const enc = (s) => encodeURIComponent(s).replace(/%3A/gi, ':');

const trimAttributes = (attributes = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(attributes)) {
        out[k] = typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
    }
    return JSON.stringify(out).length > 8000 ? { _truncated: true } : out;
};

const labelOf = (type, id, a = {}) => a.name || a.operationId || a.displayName || a.title || `${type} ${String(id).slice(0, 8)}`;

async function runPool(items, concurrency, worker) {
    const queue = [...items];
    await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length) await worker(queue.shift());
        })
    );
}

/**
 * Builds (or grows) a graph from the tenant's JSON:API config model.
 *
 * 1. Each selected root type is listed (first `perRoot` resources).
 * 2. `tasks` are loaded: relationship groups of resources the caller already has but whose related resources it
 *    doesn't, `{ path, rel, total, targets: [{ type, id }] }`. `path` is the parent's path as reported on its node.
 * 3. With `follow: 'all'` (the default) relationships of everything fetched are followed breadth-first, until
 *    `maxResources` resources are known. `follow: 'one'` loads just the tasks' resources and stops there, and
 *    `follow: 'none'` doesn't load any relationships.
 *
 * `known` lists ids the caller already has; they count towards `maxResources` and are never fetched again (so a caller
 * that doesn't want its existing graph to use up the budget passes `known.length + <new resources allowed>`).
 *
 * Resources reachable only through a relationship are fetched through their parent's path
 * (`/project/<id>/apiproxies/<id>`), because not every type has a collection of its own. Where a parent has several
 * children in one relationship they are loaded in bulk, by paging the relationship's collection
 * (`/project/<id>/apiproxies?page[size]=100`), which takes far fewer requests than one per child. Anything that can't
 * be fetched stays in the graph as an `unresolved` placeholder so its links aren't lost.
 *
 * Calling `fetchConfig(path)` must resolve a parsed JSON:API document or throw an UpstreamError.
 *
 * Resources are also handed to `onBatch(nodes, links)` as they are resolved, so callers can stream them. A batch's
 * links may point at resources that arrive in a later batch (or never, once the budget is spent).
 */
export async function crawl({
    fetchConfig,
    roots = [],
    tasks = [],
    known = [],
    follow = 'all',
    rootTypes = new Set(roots),
    perRoot,
    maxResources,
    concurrency = 8,
    retryDelayMs = 500,
    signal,
    onProgress = () => {},
    onBatch = () => {},
}) {
    const started = Date.now();
    const nodes = new Map();
    const links = [];
    const claimed = new Set(known); // resources discovered (known, fetched, queued or placeholder): this is the budget
    const queue = [];
    const warnings = new Map();
    let requests = 0;
    let truncated = false;

    const progress = () => onProgress({ resources: claimed.size, loaded: nodes.size, requests, queued: queue.length });

    let batch = { nodes: [], links: [] };
    let lastFlush = Date.now();
    const flush = () => {
        if (batch.nodes.length) onBatch(batch.nodes, batch.links);
        batch = { nodes: [], links: [] };
        lastFlush = Date.now();
    };
    const emit = (node, nodeLinks) => {
        nodes.set(node.id, node);
        batch.nodes.push(node);
        batch.links.push(...nodeLinks);
        if (batch.nodes.length >= 25 || Date.now() - lastFlush >= 200) flush();
    };
    const warn = (type, err) => {
        const k = `${type}|${err.status}`;
        const w = warnings.get(k) ?? { type, status: err.status, message: err.message, count: 0 };
        w.count++;
        warnings.set(k, w);
    };
    // Every upstream request goes through here. `concurrency` is a hard cap on requests in flight, and it adapts: when
    // the tenant throttles or its gateway errors, the cap is halved (down to MIN_CONCURRENCY) and then creeps back up
    // one at a time as requests succeed. Hammering a struggling tenant only produces more failures.
    let limit = concurrency;
    let successes = 0;
    let active = 0;
    const waiting = [];
    const pump = () => {
        while (waiting.length && active < limit) {
            active++;
            waiting.shift()();
        }
    };
    const acquire = () =>
        new Promise((resolve) => {
            waiting.push(resolve);
            pump();
        });
    const release = () => {
        active--;
        pump();
    };
    const throttled = () => {
        limit = Math.max(Math.min(MIN_CONCURRENCY, concurrency), Math.floor(limit / 2));
        successes = 0;
    };
    const succeeded = () => {
        if (limit < concurrency && ++successes >= limit) {
            limit++;
            successes = 0;
        }
    };
    const call = async (path) => {
        for (let attempt = 0; ; attempt++) {
            signal?.throwIfAborted();
            await acquire();
            try {
                signal?.throwIfAborted();
                requests++;
                const doc = await fetchConfig(path);
                succeeded();
                return doc;
            } catch (err) {
                if (
                    !(err instanceof UpstreamError) ||
                    !RETRYABLE.has(err.status) ||
                    attempt >= (err.status === 500 ? MAX_RETRIES_500 : MAX_RETRIES)
                )
                    throw err;
                throttled();
            } finally {
                release();
                progress();
            }
            // Back off (exponential, with jitter) outside the slot so others can proceed.
            await sleep(Math.min(retryDelayMs * 16, retryDelayMs * 2 ** attempt) * (0.5 + Math.random()), signal);
        }
    };

    const nestedPath = (base, id) => `${base}/${enc(id)}`;
    // A child's own path is its nested path; very deep ones are shortened to the type's collection when it has one.
    const childPath = (base, type, id) => {
        const nested = nestedPath(base, id);
        return nested.length > 800 && rootTypes.has(type) ? `/${enc(type)}/${enc(id)}` : nested;
    };
    const oneTask = (target, base) => ({
        kind: 'one',
        type: target.type,
        id: target.id,
        // A type with its own collection is fetched by id first (short, stable path); the parent's nested path is the
        // fallback, and the only way for types that have no collection of their own.
        paths: rootTypes.has(target.type)
            ? [`/${enc(target.type)}/${enc(target.id)}`, nestedPath(base, target.id)]
            : [nestedPath(base, target.id)],
    });

    // Queues one relationship's not-yet-known resources, claiming budget for each. `total` is how many resources the
    // relationship has in all (known or not) and `isList` whether it is a to-many relationship.
    const claimGroup = (path, rel, targets, total, isList) => {
        const wanted = [];
        for (const target of targets) {
            if (claimed.has(key(target.type, target.id))) continue;
            if (claimed.size >= maxResources) {
                truncated = true;
                continue;
            }
            claimed.add(key(target.type, target.id));
            wanted.push(target);
        }
        if (wanted.length === 0) return;
        const base = `${path}/${enc(rel)}`;
        // Listing the whole relationship costs ceil(N / page) requests; fetching the unclaimed children one by one
        // costs one each. Only a to-many relationship can be listed.
        const pages = Math.ceil(total / PAGE_MAX);
        if (isList && base.length <= PATH_MAX && pages < wanted.length) {
            queue.push({ kind: 'bulk', base, wanted });
        } else {
            for (const target of wanted) queue.push(oneTask(target, base));
        }
    };

    // Queues the resources a fetched node points to.
    const expand = (rels, path) => {
        for (const [rel, value] of Object.entries(rels)) {
            const targets = asArray(value?.data);
            claimGroup(path, rel, targets, targets.length, Array.isArray(value?.data));
        }
    };

    // While the selected root types are being read, expanding their relationships is put off. Otherwise whichever type
    // answers first would spend the whole budget on its neighbours and starve the others of the roots they asked for.
    let deferring = false;
    const deferred = [];

    // Records a fetched resource and (now or once the roots are in) queues the resources it points to. `asKey` keeps
    // the id the parent's relationship used for it, so links always line up.
    const addNode = (item, path, isRoot, asKey) => {
        const k = asKey ?? key(item.type, item.id);
        const relationships = {};
        const nodeLinks = [];
        for (const [rel, value] of Object.entries(item.relationships ?? {})) {
            for (const target of asArray(value?.data)) {
                (relationships[rel] ??= []).push(key(target.type, target.id));
                const link = { source: k, target: key(target.type, target.id), label: rel };
                links.push(link);
                nodeLinks.push(link);
            }
        }
        emit(
            {
                id: k,
                type: item.type,
                rawId: item.id,
                label: labelOf(item.type, item.id, item.attributes),
                root: isRoot,
                path,
                attributes: trimAttributes(item.attributes),
                relationships,
            },
            nodeLinks
        );
        if (follow !== 'all') return;
        const expansion = () => expand(item.relationships ?? {}, path);
        if (deferring) deferred.push(expansion);
        else expansion();
    };

    // Phase 1: the selected root types. A type's pages are requested a window at a time (the limiter above keeps the
    // total in check) and read in page order, so a large `perRoot` doesn't mean one slow request after another.
    const size = Math.min(PAGE_MAX, perRoot || PAGE_MAX);
    deferring = true;
    await runPool(roots, concurrency, async (type) => {
        let got = 0;
        let failedInARow = 0;
        for (let next = 1; got < perRoot;) {
            const wanted = Math.min(perRoot - got, maxResources - claimed.size);
            if (wanted <= 0) {
                truncated = true;
                return;
            }
            const pages = Array.from({ length: Math.min(concurrency, Math.ceil(wanted / size)) }, (_, i) => next + i);
            next += pages.length;
            const results = await Promise.all(
                pages.map((page) =>
                    call(`/${enc(type)}?page[size]=${size}&page[number]=${page}`).then(
                        (doc) => ({ doc }),
                        (err) => ({ err })
                    )
                )
            );
            for (const { doc, err } of results) {
                if (err) {
                    if (!(err instanceof UpstreamError) || err.status === 401) throw err;
                    // Some pages fail for good on this tenant while their neighbours are fine: skip the page, carry on,
                    // and give up on the type only when pages keep failing.
                    warn(type, err);
                    if (++failedInARow >= 3) return;
                    continue;
                }
                failedInARow = 0;
                const items = asArray(doc.data);
                for (const item of items) {
                    if (got >= perRoot) return;
                    const k = key(item.type, item.id);
                    if (claimed.has(k)) continue;
                    if (claimed.size >= maxResources) {
                        truncated = true;
                        return;
                    }
                    claimed.add(k);
                    got++;
                    addNode(item, `/${enc(item.type)}/${enc(item.id)}`, true);
                }
                if (items.length < size) return;
            }
        }
    });

    // Every selected root is in: now they may spend what is left of the budget on their relationships.
    deferring = false;
    for (const expansion of deferred.splice(0)) expansion();

    // Relationship groups the caller asked to have loaded.
    for (const task of tasks) claimGroup(task.path, task.rel, task.targets, task.total, task.total > 1);

    // Phase 2: follow relationships. Workers keep draining until the queue is empty and nothing is in flight.
    let inFlight = 0;
    let failed = false;
    // Workers with nothing to do wait here until a running task finishes, since it may have queued more work.
    const idle = [];
    const wakeIdle = () => {
        for (const wake of idle.splice(0)) wake();
    };

    // One child, by id and/or through its parent. Throws the last error if no path works.
    const fetchOne = async (next) => {
        let lastError;
        for (const path of next.paths) {
            if (path.length > PATH_MAX) {
                lastError = new UpstreamError('Relationship path too deep to fetch.');
                continue;
            }
            try {
                const doc = await call(path);
                const item = asArray(doc.data)[0];
                if (!item) throw new UpstreamError('Empty response.');
                return addNode(item, path, false);
            } catch (err) {
                if (!(err instanceof UpstreamError) || err.status === 401) throw err;
                lastError = err;
            }
        }
        throw lastError;
    };

    // Many children of one relationship: page through its collection and keep the ones we want. Anything the listing
    // doesn't deliver (it failed, or didn't include a child) is requeued to be fetched individually.
    const fetchBulk = async ({ base, wanted }) => {
        const remaining = new Map(wanted.map((t) => [String(t.id), t]));
        try {
            for (let page = 1; remaining.size > 0; page++) {
                const items = asArray((await call(`${base}?page[size]=${PAGE_MAX}&page[number]=${page}`)).data);
                for (const item of items) {
                    const target = remaining.get(String(item.id));
                    if (!target) continue;
                    remaining.delete(String(item.id));
                    addNode(item, childPath(base, target.type, target.id), false, key(target.type, target.id));
                }
                if (items.length < PAGE_MAX) break;
            }
        } catch (err) {
            if (!(err instanceof UpstreamError) || err.status === 401) throw err;
        }
        for (const target of remaining.values()) queue.push(oneTask(target, base));
    };

    const worker = async () => {
        while (!failed) {
            signal?.throwIfAborted();
            const next = queue.shift();
            if (!next) {
                if (inFlight === 0) return;
                await new Promise((resolve) => idle.push(resolve));
                continue;
            }
            inFlight++;
            try {
                await (next.kind === 'bulk' ? fetchBulk(next) : fetchOne(next));
            } catch (err) {
                if (!(err instanceof UpstreamError) || err.status === 401) {
                    failed = true;
                    throw err;
                }
                warn(next.type, err);
                emit(
                    {
                        id: key(next.type, next.id),
                        type: next.type,
                        rawId: next.id,
                        label: labelOf(next.type, next.id),
                        root: false,
                        unresolved: true,
                        attributes: {},
                        relationships: {},
                    },
                    []
                );
            } finally {
                inFlight--;
                wakeIdle();
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    flush();

    // Links to resources that never made it into the graph (budget reached) would dangle.
    const kept = links.filter((l) => nodes.has(l.source) && nodes.has(l.target));
    return {
        nodes: [...nodes.values()],
        links: kept,
        truncated,
        warnings: [...warnings.values()],
        stats: { requests, ms: Date.now() - started },
    };
}
