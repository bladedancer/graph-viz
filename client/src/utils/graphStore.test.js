import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GraphStore, PALETTE_SLOTS, applyFilter } from './graphStore.js';

// A node as the server streams it. `rels` maps a relationship name to the ids it points at.
const node = (type, id, label, extra = {}) => {
    const { rels = {}, ...rest } = extra;
    return { id: `${type}:${id}`, type, rawId: id, label, path: `/${type}/${id}`, attributes: {}, relationships: rels, ...rest };
};

const sample = () => {
    const store = new GraphStore();
    store.add({
        nodes: [
            node('project', 'p1:V1', 'Payments', { attributes: { projectId: 'p1' }, root: true, rels: { apiproxies: ['apiproxy:a1'] } }),
            node('apiproxy', 'a1', 'Payments v2', { attributes: { projectId: 'p1' }, rels: { endpoints: ['endpoint:e1'] } }),
            node('endpoint', 'e1', 'prod', { attributes: { projectId: 'p1' } }),
            node('application', 'app1', 'Billing App', { root: true }),
            node('activation', 'act1', 'Nightly', { rels: { application: ['application:app1'], apiproxy: ['apiproxy:a1'] } }),
            node('team', 't1', 'Core Team'),
        ],
    });
    return store;
};

describe('GraphStore', () => {
    it('derives links from the relationships nodes declare, tracking adjacency and degree', () => {
        const store = sample();
        assert.equal(store.nodes.length, 6);
        assert.equal(store.links.length, 4);
        assert.deepEqual([...store.out.get('apiproxy:a1')], ['endpoint:e1']);
        assert.deepEqual([...store.inn.get('apiproxy:a1')].sort(), ['activation:act1', 'project:p1:V1']);
        assert.equal(store.byId.get('apiproxy:a1').degree, 3);
        assert.deepEqual([...store.neighbours('endpoint:e1')].sort(), ['apiproxy:a1', 'endpoint:e1']);
    });

    it('links a node to a target that arrives later, in either order', () => {
        const store = new GraphStore();
        store.add({ nodes: [node('a', '1', 'A', { rels: { kids: ['b:2'] } })] });
        assert.equal(store.links.length, 0, 'the target is not loaded yet');
        store.add({ nodes: [node('b', '2', 'B')] });
        assert.deepEqual(store.links, [{ source: 'a:1', target: 'b:2', label: 'kids' }]);

        const reverse = new GraphStore();
        reverse.add({ nodes: [node('b', '2', 'B')] });
        reverse.add({ nodes: [node('a', '1', 'A', { rels: { kids: ['b:2'] } })] });
        assert.equal(reverse.links.length, 1);
    });

    it('never adds the same node or link twice, and keeps node objects stable across batches', () => {
        const store = sample();
        const before = store.byId.get('apiproxy:a1');
        store.add({ nodes: [node('apiproxy', 'a1', 'again', { rels: { endpoints: ['endpoint:e1'] } })] });
        assert.equal(store.nodes.length, 6);
        assert.equal(store.links.length, 4);
        assert.equal(store.byId.get('apiproxy:a1'), before);
        assert.equal(before.label, 'Payments v2');
    });

    it('places a new node next to a neighbour that already has a position', () => {
        const store = new GraphStore();
        store.add({ nodes: [node('a', '1', 'A', { rels: { kids: ['b:2'] } })] });
        store.byId.get('a:1').x = 100;
        store.byId.get('a:1').y = 200;
        store.add({ nodes: [node('b', '2', 'B')] });
        const b = store.byId.get('b:2');
        assert.ok(Math.abs(b.x - 100) <= 15 && Math.abs(b.y - 200) <= 15);
    });

    it('clears everything', () => {
        const store = sample();
        store.clear();
        assert.equal(store.nodes.length + store.links.length + store.byId.size + store.unloaded.size, 0);
        assert.equal(store.version, 0);
    });
});

describe('what is left to load', () => {
    const roots = () => {
        const store = new GraphStore();
        store.add({
            nodes: [
                node('project', 'p1', 'Payments', {
                    root: true,
                    rels: { apiproxies: ['apiproxy:a1', 'apiproxy:a2', 'apiproxy:a3'], endpoints: ['endpoint:e1'] },
                }),
                node('project', 'p2', 'Portal', { root: true, rels: { endpoints: ['endpoint:e1'] } }),
                node('project', 'p3', 'Empty', { root: true }),
            ],
        });
        return store;
    };

    it('counts the distinct resources that are named but not loaded', () => {
        const store = roots();
        assert.equal(store.unloadedTotal, 4, 'a1, a2, a3 and e1 (shared by two projects)');
        assert.equal(store.unloadedCount('project:p1'), 4);
        assert.equal(store.unloadedCount('project:p2'), 1);
        assert.equal(store.unloadedCount('project:p3'), 0);
    });

    it('describes the groups to load in the shape the server takes', () => {
        const tasks = roots().expansionTasks(['project:p1']);
        assert.deepEqual(tasks, [
            {
                path: '/project/p1',
                rel: 'apiproxies',
                total: 3,
                targets: [
                    { type: 'apiproxy', id: 'a1' },
                    { type: 'apiproxy', id: 'a2' },
                    { type: 'apiproxy', id: 'a3' },
                ],
            },
            { path: '/project/p1', rel: 'endpoints', total: 1, targets: [{ type: 'endpoint', id: 'e1' }] },
        ]);
    });

    it('covers the whole graph when no nodes are named, and skips nodes with nothing missing', () => {
        const store = roots();
        const tasks = store.expansionTasks();
        assert.equal(tasks.length, 3, 'p1 twice, p2 once; p3 has nothing');
        assert.ok(tasks.every((t) => t.path.startsWith('/project/')));
    });

    it("asks only for what is still missing, but reports the relationship's full size", () => {
        const store = roots();
        store.add({ nodes: [node('apiproxy', 'a2', 'Two')] });
        const [group] = store.expansionTasks(['project:p1']);
        assert.equal(group.total, 3);
        assert.deepEqual(
            group.targets.map((t) => t.id),
            ['a1', 'a3']
        );
        assert.equal(store.unloadedCount('project:p1'), 3);
    });

    it('finds the loaded resources reachable by following relationships, so their missing ones can be loaded too', () => {
        const store = new GraphStore();
        store.add({
            nodes: [
                node('project', 'p1', 'P', { rels: { apiproxies: ['apiproxy:a1'] } }),
                node('apiproxy', 'a1', 'A', { rels: { endpoints: ['endpoint:e1'], policies: ['policy:x1'] } }),
                node('endpoint', 'e1', 'E', { rels: { project: ['project:p1'] } }),
                node('team', 't1', 'T', { rels: { projects: ['project:p1'] } }),
            ],
        });
        assert.deepEqual(store.reachable(['project:p1']).sort(), ['apiproxy:a1', 'endpoint:e1', 'project:p1']);
        assert.deepEqual(store.expansionTasks(['project:p1']), [], "p1's own relationships are all loaded");
        assert.deepEqual(
            store.expansionTasks(store.reachable(['project:p1'])).map((t) => t.rel),
            ['policies']
        );
    });

    it('keeps ids that contain colons intact', () => {
        const store = new GraphStore();
        store.add({ nodes: [node('project', 'p1', 'P', { rels: { versions: ['version:941cd08e:V1'] } })] });
        assert.deepEqual(store.expansionTasks()[0].targets, [{ type: 'version', id: '941cd08e:V1' }]);
    });

    it('forgets a resource once it has been loaded, and links it to everything that pointed at it', () => {
        const store = roots();
        store.add({ nodes: [node('endpoint', 'e1', 'prod')] });
        assert.equal(store.unloadedTotal, 3);
        assert.deepEqual([...store.inn.get('endpoint:e1')].sort(), ['project:p1', 'project:p2']);
        assert.equal(store.links.filter((l) => l.target === 'endpoint:e1').length, 2);
    });

    it('does not ask about nodes the server gave no path for (placeholders)', () => {
        const store = new GraphStore();
        store.add({ nodes: [node('x', '1', 'X', { path: undefined, rels: { kids: ['y:2'] } })] });
        assert.deepEqual(store.expansionTasks(), []);
    });
});

describe('grouping and legend', () => {
    it('groups by project, then application, then own type', () => {
        const store = sample();
        store.legend('group');
        const key = (id) => store.byId.get(id).group;
        assert.equal(key('project:p1:V1'), 'project:p1');
        assert.equal(key('endpoint:e1'), 'project:p1');
        assert.equal(key('application:app1'), 'application:app1');
        assert.equal(key('activation:act1'), 'application:app1');
        assert.equal(key('team:t1'), 'type:team');
    });

    it('labels groups with the project or application name', () => {
        const legend = sample().legend('group');
        const labels = Object.fromEntries(legend.items.map((i) => [i.key, i.label]));
        assert.equal(labels['project:p1'], 'Payments');
        assert.equal(labels['application:app1'], 'Billing App');
        assert.equal(labels['type:team'], 'team');
        assert.deepEqual(
            legend.items.map((i) => i.count),
            [3, 2, 1]
        );
    });

    it('puts resources that do not name a project in the group of the resources around them', () => {
        const store = new GraphStore();
        store.add({
            nodes: [
                node('apiproxy', 'a1', 'Payments v2', { attributes: { projectId: 'p1' }, rels: { operations: ['operation:o1'] } }),
                node('operation', 'o1', 'createPayment', { rels: { parameters: ['parameter:x1'] } }),
                node('parameter', 'x1', 'amount'),
                node('operation', 'o2', 'orphan op'),
            ],
        });
        store.legend('group');
        assert.equal(store.byId.get('operation:o1').group, 'project:p1');
        assert.equal(store.byId.get('parameter:x1').group, 'project:p1');
        assert.equal(store.byId.get('operation:o2').group, 'type:operation');
    });

    it('can color by type instead', () => {
        const legend = sample().legend('type');
        assert.deepEqual(legend.items.map((i) => i.label).sort(), ['activation', 'apiproxy', 'application', 'endpoint', 'project', 'team']);
    });

    it('gives the biggest groups their own color and shares one for the rest', () => {
        const store = new GraphStore();
        const nodes = [];
        for (let g = 0; g < PALETTE_SLOTS + 3; g++) {
            for (let i = 0; i < PALETTE_SLOTS + 3 - g; i++)
                nodes.push(node('thing', `${g}-${i}`, `n${g}-${i}`, { attributes: { projectId: `g${g}` } }));
        }
        store.add({ nodes });
        const legend = store.legend('group');
        assert.equal(legend.items.length, PALETTE_SLOTS + 1);
        const other = legend.items.at(-1);
        assert.equal(other.key, '__other');
        assert.match(other.label, /3 other groups/);
        assert.equal(legend.slotOf(store.byId.get('thing:0-0')), 0);
        assert.equal(legend.slotOf(store.byId.get(`thing:${PALETTE_SLOTS + 2}-0`)), PALETTE_SLOTS);
    });
});

describe('applyFilter', () => {
    it('does nothing for an empty filter', () => {
        assert.equal(applyFilter(sample(), { text: '  ' }), null);
    });

    it('matches labels and types, case-insensitively', () => {
        const store = sample();
        assert.deepEqual([...applyFilter(store, { text: 'PAYMENTS' }).matches].sort(), ['apiproxy:a1', 'project:p1:V1']);
        assert.deepEqual([...applyFilter(store, { text: 'endpoint' }).matches], ['endpoint:e1']);
    });

    it('includes connected resources in the chosen direction', () => {
        const store = sample();
        const text = 'v2';
        const included = (direction) => [...applyFilter(store, { text, connected: true, direction }).included].sort();
        assert.deepEqual(included('outbound'), ['apiproxy:a1', 'endpoint:e1']);
        assert.deepEqual(included('inbound'), ['activation:act1', 'apiproxy:a1', 'project:p1:V1']);
        assert.deepEqual(included('both'), ['activation:act1', 'apiproxy:a1', 'endpoint:e1', 'project:p1:V1']);
        assert.deepEqual([...applyFilter(store, { text, connected: false }).included], ['apiproxy:a1']);
    });

    it('includes connected resources however many hops away, without crossing over between directions', () => {
        const store = sample();
        const included = (text, direction) => [...applyFilter(store, { text, connected: true, direction }).included].sort();
        // Nightly -> apiproxy a1 -> endpoint e1
        assert.deepEqual(included('nightly', 'outbound'), ['activation:act1', 'apiproxy:a1', 'application:app1', 'endpoint:e1']);
        // prod <- a1 <- project and activation
        assert.deepEqual(included('prod', 'inbound'), ['activation:act1', 'apiproxy:a1', 'endpoint:e1', 'project:p1:V1']);
        // The project's descendants (and its ancestors, none): not the activation that also points at one of them.
        assert.deepEqual(included('project', 'both'), ['apiproxy:a1', 'endpoint:e1', 'project:p1:V1']);
        assert.deepEqual(included('Core', 'both'), ['team:t1']);
    });

    it('passes on whether to hide what it leaves out', () => {
        assert.equal(applyFilter(sample(), { text: 'v2' }).hide, false);
        assert.equal(applyFilter(sample(), { text: 'v2', hide: true }).hide, true);
    });
});
