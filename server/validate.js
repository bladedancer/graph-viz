import { HttpError } from './errors.js';

// What the browser may ask the server to fetch from the tenant. Paths and names end up in requests to the tenant, so
// they are held to the characters Elide paths actually use.
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._~:%@!$&'()*+,;=-]+$/;
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const PATH_MAX = 1900;

const bad = (message) => new HttpError(400, 'invalid_request', message);

/** A path like /project/<id>/apiproxies/<id>: absolute, no query, no dot segments, no encoded slashes or dots. */
export function isValidPath(path) {
    if (typeof path !== 'string' || path.length > PATH_MAX || !path.startsWith('/')) return false;
    const segments = path.slice(1).split('/');
    return (
        segments.length >= 2 &&
        segments.every(
            (seg) =>
                SEGMENT.test(seg) &&
                seg !== '.' &&
                seg !== '..' &&
                !/%(?![0-9a-f]{2})/i.test(seg) && // a % that doesn't start an escape
                !/%(2e|2f|5c|00)/i.test(seg) // encoded . / \ NUL
        )
    );
}

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !hasControl(value);

/**
 * Validates the body of POST /api/expand:
 *   { tasks: [{ path, rel, total, targets: [{ type, id }] }], known: ['type:id', ...], follow: 'one' | 'all' }
 * Returns it normalised, or throws a 400 HttpError. There is deliberately no resource limit here: the user's Max resources
 * applies to loading the graph, not to expanding it, so `known` (however large the graph has grown) is only bounded for
 * sanity.
 */
export function parseExpand(body) {
    if (!body || typeof body !== 'object') throw bad('The request body must be a JSON object.');
    if (body.follow !== 'one' && body.follow !== 'all') throw bad("follow must be 'one' or 'all'.");

    if (!Array.isArray(body.known) || body.known.length > 1_000_000) throw bad('known must be a list of the resources already loaded.');
    if (!body.known.every(isId)) throw bad('known contains an invalid id.');

    if (!Array.isArray(body.tasks) || body.tasks.length === 0 || body.tasks.length > 100_000) {
        throw bad('tasks must list between 1 and 100,000 relationships to load.');
    }
    let targets = 0;
    const tasks = body.tasks.map((task) => {
        if (!task || !isValidPath(task.path)) throw bad('A task has an invalid path.');
        if (typeof task.rel !== 'string' || !NAME.test(task.rel)) throw bad('A task has an invalid relationship name.');
        if (!Number.isInteger(task.total) || task.total < 1 || task.total > 1_000_000) throw bad('A task has an invalid total.');
        if (!Array.isArray(task.targets) || task.targets.length === 0 || task.targets.length > task.total)
            throw bad('A task has invalid targets.');
        for (const t of task.targets) {
            if (!t || typeof t.type !== 'string' || !NAME.test(t.type) || !isId(t.id)) throw bad('A task has an invalid target.');
        }
        targets += task.targets.length;
        if (targets > 1_000_000) throw bad('Too many resources to load in one request.');
        return { path: task.path, rel: task.rel, total: task.total, targets: task.targets.map((t) => ({ type: t.type, id: t.id })) };
    });

    return { tasks, known: body.known, follow: body.follow };
}
