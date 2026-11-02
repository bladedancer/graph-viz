// Holds the graph as it streams in. Node and link objects are created once and kept (force-graph mutates them with
// positions), so a growing graph keeps its layout instead of restarting.
//
// Links are derived, not received: every node lists the ids it relates to (`relationships`), and a link appears as
// soon as both of its ends are in the graph. A relationship whose target hasn't been loaded yet is remembered in
// `unloaded`, which is also what tells us what is still left to load.

export const PALETTE_SLOTS = 8; // distinct colors before everything else shares "other"

const OWN_GROUP_TYPES = new Set(['application', 'idp', 'onpremdataplane']);

/** The project/application a resource says it belongs to, or null when it doesn't say. */
const explicitGroup = (node) => {
    const projectId = node.attributes?.projectId;
    if (projectId) return `project:${projectId}`;
    if (OWN_GROUP_TYPES.has(node.type)) return node.id;
    return node.relationships?.application?.[0] ?? null;
};

const splitKey = (key) => {
    const i = key.indexOf(':'); // types never contain ':', ids can
    return { type: key.slice(0, i), id: key.slice(i + 1) };
};

export class GraphStore {
    constructor() {
        this.clear();
    }

    clear() {
        this.nodes = [];
        this.links = [];
        this.byId = new Map();
        this.out = new Map(); // id -> Set of ids it links to
        this.inn = new Map(); // id -> Set of ids linking to it
        this.unloaded = new Map(); // id of a resource not in the graph -> [[source id, relationship], ...] pointing at it
        this.linkKeys = new Set();
        this.version = 0;
        this._legend = null;
    }

    #link(source, target, label) {
        const key = `${source}>${target}>${label}`;
        if (this.linkKeys.has(key)) return;
        this.linkKeys.add(key);
        this.links.push({ source, target, label });
        this.out.get(source).add(target);
        this.inn.get(target).add(source);
        this.byId.get(source).degree++;
        this.byId.get(target).degree++;
    }

    /** Adds a batch of `{ nodes }` as streamed by the server. */
    add({ nodes = [] }) {
        const added = [];
        for (const raw of nodes) {
            if (this.byId.has(raw.id)) continue;
            const node = { ...raw, degree: 0 };
            this.nodes.push(node);
            this.byId.set(node.id, node);
            this.out.set(node.id, new Set());
            this.inn.set(node.id, new Set());
            added.push(node);
        }
        for (const node of added) {
            // What this node points at: link to whatever is already here, and remember the rest until it arrives.
            for (const [rel, targets] of Object.entries(node.relationships ?? {})) {
                for (const target of targets) {
                    if (this.byId.has(target)) this.#link(node.id, target, rel);
                    else {
                        const waiting = this.unloaded.get(target);
                        if (waiting) waiting.push([node.id, rel]);
                        else this.unloaded.set(target, [[node.id, rel]]);
                    }
                }
            }
            // What earlier nodes pointed at this one.
            const waiting = this.unloaded.get(node.id);
            if (waiting) {
                for (const [source, rel] of waiting) this.#link(source, node.id, rel);
                this.unloaded.delete(node.id);
            }
        }
        // Start newcomers next to a neighbour that already has a position, so they don't fly in from the origin.
        for (const node of added) {
            const neighbour = [...this.out.get(node.id), ...this.inn.get(node.id)]
                .map((id) => this.byId.get(id))
                .find((n) => n.x !== undefined);
            if (neighbour) {
                node.x = neighbour.x + (Math.random() - 0.5) * 30;
                node.y = neighbour.y + (Math.random() - 0.5) * 30;
            }
        }
        this.version++;
        this._legend = null;
    }

    /** How many related resources are known about (named by a relationship) but not loaded. */
    get unloadedTotal() {
        return this.unloaded.size;
    }

    /**
     * How many resources this node relates to that aren't loaded yet. With `transitive`, the count covers everything
     * reachable from it (what "Load all" would load from), not just the node's own relationships.
     */
    unloadedCount(id, { transitive = false } = {}) {
        let count = 0;
        for (const from of transitive ? this.reachable([id]) : [id]) {
            for (const targets of Object.values(this.byId.get(from)?.relationships ?? {})) {
                for (const target of targets) if (!this.byId.has(target)) count++;
            }
        }
        return count;
    }

    /**
     * The relationship groups still to load, in the form POST /api/expand takes. For the given node ids, or for the
     * whole graph when none are given. `path` is where the server fetched the node, `total` how many resources the
     * relationship has altogether (loaded or not) and `targets` the ones that are missing.
     */
    expansionTasks(ids = null) {
        const tasks = [];
        const nodes = ids ? ids.map((id) => this.byId.get(id)).filter(Boolean) : this.nodes;
        for (const node of nodes) {
            if (!node.path) continue;
            for (const [rel, targets] of Object.entries(node.relationships ?? {})) {
                const missing = targets.filter((t) => !this.byId.has(t));
                if (missing.length) tasks.push({ path: node.path, rel, total: targets.length, targets: missing.map(splitKey) });
            }
        }
        return tasks;
    }

    /**
     * The given nodes plus every loaded node reachable from them by following relationships: forwards ('out', what
     * they point at) or backwards ('in', what points at them).
     */
    reachable(ids, direction = 'out') {
        const edges = direction === 'in' ? this.inn : this.out;
        const seen = new Set([...ids].filter((id) => this.byId.has(id)));
        const queue = [...seen];
        while (queue.length) {
            for (const next of edges.get(queue.pop())) {
                if (!seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        return [...seen];
    }

    /** The node itself plus everything it links to or from. */
    neighbours(id) {
        return new Set([id, ...(this.out.get(id) ?? []), ...(this.inn.get(id) ?? [])]);
    }

    /**
     * Color groups for the legend. `by` is 'group' (project / application) or 'type'. The biggest groups get their
     * own color slot; the rest share the last slot, "other".
     */
    legend(by = 'group') {
        if (this._legend?.by === by) return this._legend;
        const projectNames = new Map();
        for (const n of this.nodes) if (n.type === 'project' && n.attributes?.projectId) projectNames.set(n.attributes.projectId, n.label);

        this.#assignGroups();
        const groups = new Map();
        for (const n of this.nodes) {
            const key = by === 'type' ? n.type : n.group;
            let g = groups.get(key);
            if (!g) {
                g = { key, count: 0, label: by === 'type' ? n.type : this.#groupLabel(key, projectNames) };
                groups.set(key, g);
            }
            g.count++;
        }
        const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        const slotOf = new Map(sorted.slice(0, PALETTE_SLOTS).map((g, i) => [g.key, i]));
        const items = sorted.slice(0, PALETTE_SLOTS).map((g, i) => ({ ...g, slot: i }));
        const rest = sorted.slice(PALETTE_SLOTS);
        if (rest.length) {
            items.push({
                key: '__other',
                label: `${rest.length} other ${by === 'type' ? 'types' : 'groups'}`,
                count: rest.reduce((s, g) => s + g.count, 0),
                slot: PALETTE_SLOTS,
            });
        }
        this._legend = { by, items, slotOf: (node) => slotOf.get(by === 'type' ? node.type : node.group) ?? PALETTE_SLOTS };
        return this._legend;
    }

    // Resources reached through relationships often don't say which project they belong to (an operation has no
    // projectId). They join the group most of their neighbours are in, a few hops out, so a project's whole tree
    // shares one color. Whatever is still unplaced falls back to its type.
    #assignGroups() {
        for (const n of this.nodes) n.group = explicitGroup(n);
        for (let pass = 0; pass < 4; pass++) {
            const assignments = [];
            for (const n of this.nodes) {
                if (n.group) continue;
                const votes = new Map();
                for (const id of [...this.inn.get(n.id), ...this.out.get(n.id)]) {
                    const g = this.byId.get(id).group;
                    if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
                }
                if (votes.size) assignments.push([n, [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]);
            }
            if (assignments.length === 0) break;
            for (const [n, group] of assignments) n.group = group;
        }
        for (const n of this.nodes) n.group ??= `type:${n.type}`;
    }

    #groupLabel(key, projectNames) {
        if (key.startsWith('project:')) {
            const id = key.slice('project:'.length);
            return projectNames.get(id) ?? `Project ${id.slice(0, 8)}`;
        }
        if (key.startsWith('type:')) return key.slice('type:'.length);
        return this.byId.get(key)?.label ?? key;
    }
}

/**
 * Which resources match the filter box. Returns null when nothing is being filtered, otherwise
 * { matches, included, hide }: `included` adds everything connected to a match when `connected` is on, however many
 * hops away (outbound = what a match leads to, inbound = what leads to it; both = the two together, not everything
 * those in turn connect to); `hide` asks for everything else to be left out of the drawing rather than dimmed.
 */
export function applyFilter(store, { text = '', connected = false, direction = 'both', hide = false } = {}) {
    const q = text.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set();
    for (const n of store.nodes) {
        if (n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) matches.add(n.id);
    }
    const included = new Set(matches);
    if (connected) {
        if (direction !== 'inbound') store.reachable(matches, 'out').forEach((id) => included.add(id));
        if (direction !== 'outbound') store.reachable(matches, 'in').forEach((id) => included.add(id));
    }
    return { matches, included, hide };
}
