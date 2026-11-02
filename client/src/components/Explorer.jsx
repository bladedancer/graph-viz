import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api } from '../api.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { GraphStore, applyFilter } from '../utils/graphStore.js';
import { EmptyState, StatusChip, Toast, Toolbar, ZoomControls } from './CanvasControls.jsx';
import ControlsPanel from './ControlsPanel.jsx';
import DetailsPanel from './DetailsPanel.jsx';
import GraphCanvas from './GraphCanvas.jsx';
import Header from './Header.jsx';

// Categorical colors for the biggest groups, then one for everything else. All design-system tokens.
const PALETTE_TOKENS = [
    '--ads-primary-500',
    '--ads-warning-400',
    '--ads-tertiary-500',
    '--ads-primary-100',
    '--ads-warning-700',
    '--ads-tertiary-200',
    '--ads-success-500',
    '--ads-util-focus',
    '--ads-secondary-400',
];
const readPalette = () => PALETTE_TOKENS.map((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim());

const IDLE = { status: 'idle', progress: null, error: null, summary: null };

export default function Explorer({ session, onSession, onSignOut, onExpired }) {
    const store = useMemo(() => new GraphStore(), []);
    const [version, setVersion] = useState(0);
    // Pins live on the node objects (fx/fy), so pinning or releasing one has to ask for a render itself.
    const [, pinsChanged] = useReducer((n) => n + 1, 0);
    const palette = useMemo(() => readPalette(), []);

    const [roots, setRoots] = useState([]);
    const [countsFor, setCountsFor] = useState({ mode: null, counts: null });
    const [selectedRoots, setSelectedRoots] = usePersistentState('gv.roots', ['project']);
    const [perRoot, setPerRoot] = usePersistentState('gv.perRoot', 25);
    const [maxResources, setMaxResources] = usePersistentState('gv.maxResources', 500);
    const [load, setLoad] = useState(IDLE);
    const [expansion, setExpansion] = useState(null); // { label, loaded, requests } while relationships are loading
    const [notice, setNotice] = useState(null); // { tone, title, text }
    const [modeBusy, setModeBusy] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [filter, setFilter] = useState({ text: '', connected: false, direction: 'both', hide: false });
    const [physics, setPhysics] = useState({ linkDistance: 60, repulsion: 300, gravity: 30, paused: false });
    const [colorBy, setColorBy] = useState('group');
    const [engine, setEngine] = useState('running');
    const [exporting, setExporting] = useState(false);
    const [controlsOpen, setControlsOpen] = useState(false);
    const canvas = useRef(null);
    const abort = useRef(null);
    const expandAbort = useRef(null);
    const expandQueue = useRef([]);
    const expanding = useRef(false);
    const publishTimer = useRef(null);
    const lastPublish = useRef(0);

    // A 401 from any call means the session is gone.
    const guard = useCallback(
        (err) => {
            if (err.code === 'session_expired') onExpired();
            else if (err.name !== 'AbortError') console.error(err);
        },
        [onExpired]
    );

    // The root types, once.
    useEffect(() => {
        const ctrl = new AbortController();
        api.roots(ctrl.signal).then(setRoots).catch(guard);
        return () => ctrl.abort();
    }, [guard]);

    // How many resources each type has. These are per environment, so they are read again when the mode changes.
    const mode = session.mode;
    useEffect(() => {
        const ctrl = new AbortController();
        api.rootCounts(ctrl.signal)
            .then((counts) => setCountsFor({ mode, counts }))
            .catch((err) => {
                guard(err);
                if (err.name !== 'AbortError') setCountsFor({ mode, counts: {} });
            });
        return () => ctrl.abort();
    }, [guard, mode]);
    const counts = countsFor.mode === mode ? countsFor.counts : null;

    // Forget saved selections that this server no longer offers.
    const rootNames = useMemo(() => new Set(roots.map((r) => r.name)), [roots]);
    const chosen = useMemo(
        () => (roots.length ? selectedRoots.filter((n) => rootNames.has(n)) : selectedRoots),
        [roots, rootNames, selectedRoots]
    );
    const rootLabels = chosen.map((n) => roots.find((r) => r.name === n)?.label ?? n);

    // Tell React the store changed. Every publish regroups the legend and re-feeds the physics engine, which costs more
    // the bigger the graph is, so while a large load streams in we publish less often (at most every 3 seconds).
    const publish = useCallback(() => {
        clearTimeout(publishTimer.current);
        publishTimer.current = null;
        lastPublish.current = Date.now();
        setVersion(store.version);
    }, [store]);
    const schedulePublish = useCallback(() => {
        if (publishTimer.current) return;
        const interval = Math.min(3000, store.nodes.length / 20);
        publishTimer.current = setTimeout(publish, Math.max(0, interval - (Date.now() - lastPublish.current)));
    }, [store, publish]);

    const cancelExpansions = useCallback(() => {
        expandQueue.current = [];
        expandAbort.current?.abort();
    }, []);

    // Reads the selected root types (no relationships).
    const startLoad = useCallback(async () => {
        cancelExpansions();
        abort.current?.abort();
        const ctrl = (abort.current = new AbortController());
        clearTimeout(publishTimer.current);
        publishTimer.current = null;
        lastPublish.current = 0;
        store.clear();
        setVersion(0);
        setSelectedId(null);
        setNotice(null);
        setFilter((f) => ({ ...f, text: '' }));
        setLoad({ status: 'loading', progress: { resources: 0, loaded: 0, requests: 0 }, error: null, summary: null });
        try {
            // The server flags resources of the chosen types as roots; they are drawn with a ring.
            const summary = await api.loadGraph(
                { roots: chosen, perRoot, maxResources },
                {
                    signal: ctrl.signal,
                    onProgress: (progress) => setLoad((l) => (l.status === 'loading' ? { ...l, progress } : l)),
                    onGraph: (batch) => {
                        store.add(batch);
                        schedulePublish();
                    },
                }
            );
            publish();
            setLoad({ status: 'done', progress: null, error: null, summary });
        } catch (err) {
            publish();
            if (err.name === 'AbortError') {
                setLoad({ ...IDLE, status: 'cancelled' });
                return;
            }
            guard(err);
            setLoad({ status: 'error', progress: null, error: err.message, summary: null });
        }
    }, [chosen, perRoot, maxResources, store, guard, publish, schedulePublish, cancelExpansions]);

    const cancelLoad = () => abort.current?.abort();

    // Loads relationships, one request at a time (later requests wait their turn). `ids` are the nodes to expand, or
    // null for every node; `follow` is 'one' (just those relationships) or 'all' (and onward from whatever is found).
    // The server never re-fetches resources the graph already has, so it can't follow relationships onward through
    // them: for 'all', start from everything already reachable, and go again while new resources lead to more.
    const runExpansions = useCallback(async () => {
        if (expanding.current) return;
        expanding.current = true;
        try {
            for (let job; (job = expandQueue.current.shift());) {
                const tasks = store.expansionTasks(job.follow === 'all' && job.ids ? store.reachable(job.ids) : job.ids);
                if (tasks.length === 0) {
                    if (!job.again) setNotice({ tone: 'info', text: `${job.label} has no related resources left to load.` });
                    continue;
                }
                if (store.nodes.length >= maxResources) {
                    expandQueue.current = [];
                    setNotice({
                        tone: 'warning',
                        title: `Already at ${maxResources.toLocaleString()} resources`,
                        text: 'Raise Max resources under Source to load more.',
                    });
                    break;
                }
                const ctrl = (expandAbort.current = new AbortController());
                const before = store.nodes.length;
                setNotice(null);
                setExpansion({ label: job.label, loaded: 0, requests: 0 });
                try {
                    const summary = await api.expand(
                        { tasks, known: store.nodes.map((n) => n.id), follow: job.follow, maxResources },
                        {
                            signal: ctrl.signal,
                            onProgress: (p) => setExpansion((e) => e && { ...e, requests: p.requests }),
                            onGraph: (batch) => {
                                store.add(batch);
                                setExpansion((e) => e && { ...e, loaded: store.nodes.length - before });
                                schedulePublish();
                            },
                        }
                    );
                    publish();
                    if (summary.truncated) {
                        setNotice({
                            tone: 'warning',
                            title: `Stopped at ${maxResources.toLocaleString()} resources`,
                            text: 'There is more to load. Raise Max resources under Source.',
                        });
                    } else if (summary.warnings.length) {
                        const first = summary.warnings[0];
                        setNotice({
                            tone: 'warning',
                            title: "Some resources couldn't be loaded",
                            text: `${first.type}${first.status ? ` (${first.status})` : ''}: ${first.message}${
                                summary.warnings.length > 1 ? ` and ${summary.warnings.length - 1} more` : ''
                            }`,
                        });
                    } else if (store.nodes.length === before) {
                        if (!job.again) setNotice({ tone: 'info', text: `Nothing new to load for ${job.label}.` });
                    } else if (job.follow === 'all') {
                        expandQueue.current.unshift({ ...job, again: true });
                    }
                } catch (err) {
                    publish();
                    if (err.name === 'AbortError') break;
                    guard(err);
                    setNotice({ tone: 'error', title: "Couldn't load relationships", text: err.message });
                    expandQueue.current = [];
                    break;
                }
            }
        } finally {
            expanding.current = false;
            setExpansion(null);
        }
    }, [store, maxResources, guard, publish, schedulePublish]);

    const loadRelationships = useCallback(
        (ids, { all, label }) => {
            expandQueue.current.push({ ids, follow: all ? 'all' : 'one', label });
            runExpansions();
        },
        [runExpansions]
    );

    // Double-click on a node: its relationships one level deep; with shift, everything reachable from it.
    const expandNode = useCallback(
        (id, { all }) => {
            const node = store.byId.get(id);
            if (!node) return;
            setSelectedId(id);
            loadRelationships([id], { all, label: node.label });
        },
        [store, loadRelationships]
    );

    // Switching environment reads a different dataset: stop whatever is loading, switch, and (if there was a graph)
    // load it again from the new mode.
    const changeMode = useCallback(
        async (next) => {
            if (next === mode) return;
            const hadGraph = store.nodes.length > 0 || load.status !== 'idle';
            cancelExpansions();
            abort.current?.abort();
            setModeBusy(true);
            try {
                onSession(await api.setMode(next));
                if (hadGraph && chosen.length > 0) await startLoad();
            } catch (err) {
                guard(err);
                setNotice({ tone: 'error', title: "Couldn't switch environment", text: err.message });
            } finally {
                setModeBusy(false);
            }
        },
        [mode, store, load.status, chosen.length, cancelExpansions, onSession, startLoad, guard]
    );

    useEffect(
        () => () => {
            abort.current?.abort();
            expandAbort.current?.abort();
            clearTimeout(publishTimer.current);
        },
        []
    );

    // Informational notices go away on their own.
    useEffect(() => {
        if (notice?.tone !== 'info') return undefined;
        const t = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(t);
    }, [notice]);

    const legend = useMemo(() => store.legend(colorBy), [store, version, colorBy]); // eslint-disable-line react-hooks/exhaustive-deps
    const filterResult = useMemo(() => applyFilter(store, filter), [store, version, filter]); // eslint-disable-line react-hooks/exhaustive-deps
    const selected = selectedId ? store.byId.get(selectedId) : null;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && setSelectedId(null);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const exportPng = async () => {
        setExporting(true);
        try {
            const blob = await canvas.current.exportPng();
            if (!blob) throw new Error('The browser could not encode the image.');
            const url = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), {
                href: url,
                download: `graph-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
            });
            a.click();
            // Revoking straight after click() can cancel the download in some browsers.
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (err) {
            setNotice({ tone: 'error', title: "Couldn't export the image", text: err.message });
        } finally {
            setExporting(false);
        }
    };

    const nodeCount = store.nodes.length;
    const hasGraph = nodeCount > 0;
    const loading = load.status === 'loading';
    const unloaded = store.unloadedTotal;
    const canLoadRelationships = hasGraph && !loading && !expansion && unloaded > 0;
    const layoutState = physics.paused ? 'layout paused' : engine === 'running' ? 'layout settling' : 'layout settled';
    const counted = `${nodeCount.toLocaleString()} resources · ${store.links.length.toLocaleString()} relationships`;
    let status;
    if (loading) status = `${nodeCount.toLocaleString()} resources loaded so far`;
    else if (expansion) status = `Loading relationships for ${expansion.label} · ${expansion.loaded.toLocaleString()} new`;
    else if (!hasGraph) status = 'No graph loaded';
    else if (filterResult) status = `${counted} · ${filterResult.included.size.toLocaleString()} shown`;
    else status = `${counted} · ${unloaded > 0 ? `${unloaded.toLocaleString()} related not loaded` : layoutState}`;

    return (
        <div className={`app${selected ? ' has-details' : ''}`}>
            <Header
                session={session}
                onSignOut={onSignOut}
                onModeChange={changeMode}
                busy={modeBusy}
                controlsOpen={controlsOpen}
                onToggleControls={() => setControlsOpen(!controlsOpen)}
            />
            <div className="canvas">
                <GraphCanvas
                    ref={canvas}
                    store={store}
                    version={version}
                    selectedId={selectedId}
                    filterSet={filterResult}
                    legend={legend}
                    palette={palette}
                    physics={physics}
                    loadStatus={load.status}
                    onSelect={setSelectedId}
                    onExpand={expandNode}
                    onPinChange={pinsChanged}
                    onEngine={setEngine}
                />

                {!hasGraph && !loading && load.status === 'idle' && (
                    <EmptyState title="No graph loaded yet">
                        Choose one or more root resource types and select Load graph. Then double-click a resource, or select Load
                        relationships, to bring in the resources it relates to.
                    </EmptyState>
                )}
                {!hasGraph && !loading && load.status === 'done' && (
                    <EmptyState title="Nothing to show">
                        The tenant returned no resources for the types you chose in {mode.charAt(0) + mode.slice(1).toLowerCase()}. Try
                        different types or another environment, or check the warnings under Source.
                    </EmptyState>
                )}
                {!hasGraph && !loading && load.status === 'cancelled' && (
                    <EmptyState title="Load cancelled">Choose your root resource types and select Load graph to start again.</EmptyState>
                )}

                <ControlsPanel
                    open={controlsOpen}
                    hasGraph={hasGraph}
                    loading={loading}
                    rootLabels={rootLabels}
                    source={{
                        roots,
                        counts,
                        selected: chosen,
                        onSelected: setSelectedRoots,
                        perRoot,
                        onPerRoot: setPerRoot,
                        maxResources,
                        onMaxResources: setMaxResources,
                        load,
                        onLoad: () => {
                            setControlsOpen(false);
                            startLoad();
                        },
                        onCancel: cancelLoad,
                        canLoadRelationships,
                        onLoadRelationships: () => loadRelationships(null, { all: true, label: 'all resources' }),
                    }}
                    filter={filter}
                    onFilter={setFilter}
                    filterResult={filterResult}
                    physics={physics}
                    onPhysics={setPhysics}
                    onResetLayout={() => canvas.current.resetLayout()}
                    legend={legend}
                    palette={palette}
                    colorBy={colorBy}
                    onColorBy={setColorBy}
                />

                <Toolbar
                    onExport={exportPng}
                    exportDisabled={!hasGraph}
                    exporting={exporting}
                    onLoadRelationships={() => loadRelationships(null, { all: true, label: 'all resources' })}
                    canLoadRelationships={canLoadRelationships}
                    unloaded={unloaded}
                    maxResources={maxResources}
                />
                <ZoomControls
                    disabled={!hasGraph}
                    onZoomIn={() => canvas.current.zoomIn()}
                    onZoomOut={() => canvas.current.zoomOut()}
                    onFit={() => canvas.current.fit()}
                />
                <StatusChip action={expansion ? { label: 'Cancel', onClick: cancelExpansions } : null}>{status}</StatusChip>
                {notice && <Toast {...notice} onClose={() => setNotice(null)} />}

                {selected && (
                    <DetailsPanel
                        key={selected.id}
                        node={selected}
                        store={store}
                        legend={legend}
                        palette={palette}
                        pinned={selected.fx !== undefined}
                        busy={Boolean(expansion) || loading}
                        onClose={() => setSelectedId(null)}
                        onSelect={(id) => {
                            setSelectedId(id);
                            canvas.current.centerOn(id);
                        }}
                        onLoadRelationships={(all) => loadRelationships([selected.id], { all, label: selected.label })}
                        onUnpin={() => {
                            canvas.current.unpin(selected.id);
                            pinsChanged();
                        }}
                    />
                )}
            </div>
        </div>
    );
}
