import { forceX, forceY } from 'd3-force-3d';
import ForceGraph from 'force-graph';
import { useEffect, useImperativeHandle, useRef } from 'react';

const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const rgba = (hex, alpha) => {
    const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const radiusOf = (node) => (node.root ? 8 : 4 + Math.min(3, Math.sqrt(node.degree) * 0.5));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const DOUBLE_CLICK_MS = 350;
const FIT = [400, 80]; // zoomToFit(duration, padding)

/**
 * The interactive force-directed graph (force-graph on canvas, d3-force physics). React owns the data and the
 * look-affecting state; this component draws it and reports clicks. The store's node and link objects are handed to
 * force-graph as-is (in fresh arrays), so positions survive as the graph grows.
 */
export default function GraphCanvas({
    ref,
    store,
    version,
    selectedId,
    filterSet,
    legend,
    palette,
    physics,
    loadStatus,
    onSelect,
    onExpand,
    onPinChange,
    onEngine,
}) {
    const container = useRef(null);
    const graph = useRef(null);
    const latest = useRef({});
    const colors = useRef({});
    const fit = useRef({ pending: true });
    const engine = useRef('running');
    const gravity = useRef({});
    const helpers = useRef({});

    // What the canvas callbacks read. Updated after every render, before any redraw below.
    useEffect(() => {
        latest.current = {
            selectedId,
            focus: selectedId ? store.neighbours(selectedId) : null,
            filterSet,
            legend,
            palette,
            onSelect,
            onExpand,
            onPinChange,
            onEngine,
            many: store.nodes.length > 60,
            huge: store.nodes.length > 5000,
        };
    });

    useEffect(() => {
        const el = container.current;
        const c = (colors.current = {
            ink: cssVar('--ads-text-primary'),
            halo: cssVar('--ads-util-emphasis-soft'),
            white: cssVar('--ads-util-white'),
            focus: cssVar('--ads-util-focus'),
            focusFill: cssVar('--ads-util-focus-fill'),
            link: cssVar('--ads-secondary-300'),
            hot: cssVar('--ads-primary-500'),
            muted: cssVar('--ads-secondary-300'),
            canvas: cssVar('--ads-util-emphasis-soft'),
        });

        const alphaOf = (node) => {
            const v = latest.current;
            if (v.filterSet && !v.filterSet.included.has(node.id)) return 0.12;
            if (v.focus && !v.focus.has(node.id)) return 0.45;
            return 1;
        };
        const isHot = (l) =>
            latest.current.selectedId && (l.source.id === latest.current.selectedId || l.target.id === latest.current.selectedId);
        const linkColor = (l) => (isHot(l) ? rgba(c.hot, 0.9) : rgba(c.link, Math.min(alphaOf(l.source), alphaOf(l.target)) * 0.8));

        const drawNode = (node, ctx, scale) => {
            const v = latest.current;
            if (node.x === undefined) return;
            const px = 1 / scale;
            const r = radiusOf(node);
            const color = v.palette[v.legend.slotOf(node)];
            const selected = node.id === v.selectedId;
            const alpha = alphaOf(node);

            // Thousands of nodes: while zoomed out, a plain colored dot is all anyone can make out, and far cheaper.
            if (v.huge && scale < 1.2 && !node.root && !selected) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                ctx.fill();
                ctx.globalAlpha = 1;
                return;
            }

            ctx.save();
            ctx.globalAlpha = alpha;
            if (selected) {
                const halo = r + (node.root ? 8 : 5) * px;
                ctx.beginPath();
                ctx.arc(node.x, node.y, halo, 0, 2 * Math.PI);
                ctx.fillStyle = c.focusFill;
                ctx.fill();
                ctx.lineWidth = 2 * px;
                ctx.strokeStyle = c.focus;
                ctx.stroke();
            }
            if (node.root) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 3 * px, 0, 2 * Math.PI);
                ctx.lineWidth = 1.5 * px;
                ctx.strokeStyle = color;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 1.5 * px, 0, 2 * Math.PI);
            ctx.fillStyle = c.white;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            if (node.unresolved) {
                ctx.setLineDash([3 * px, 2 * px]);
                ctx.lineWidth = 1.5 * px;
                ctx.strokeStyle = c.muted;
                ctx.stroke();
            } else {
                ctx.fillStyle = color;
                ctx.fill();
            }

            // Labels of a selection's neighbours or a filter's matches: only while there are few enough to read.
            const neighbourLabel = v.focus?.has(node.id) && (v.focus.size <= 14 || scale >= 1.4);
            const matchLabel = v.filterSet?.matches.has(node.id) && (v.filterSet.matches.size <= 60 || scale >= 1.4);
            if (alpha > 0.2 && (selected || neighbourLabel || matchLabel || scale >= (v.many ? 1.8 : 0.7) || (node.root && scale >= 0.9))) {
                ctx.setLineDash([]);
                ctx.font = `${selected || node.root ? 500 : 400} ${12 * px}px Roboto, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const y = node.y + r + 5 * px;
                ctx.lineJoin = 'round';
                ctx.lineWidth = 3 * px;
                ctx.strokeStyle = c.halo;
                ctx.strokeText(node.label, node.x, y);
                ctx.fillStyle = c.ink;
                ctx.fillText(node.label, node.x, y);
            }
            ctx.restore();
        };

        // No arrowheads on huge graphs (they are invisible at that scale and expensive), except on a selection's links.
        const arrowLength = (l) => (isHot(l) ? 5 : latest.current.huge ? 0 : 3.5);

        helpers.current = { drawNode, linkColor, isHot, arrowLength };

        let lastClick = { id: null, at: 0 };
        const g = new ForceGraph(el)
            .nodeId('id')
            .nodeCanvasObjectMode(() => 'replace')
            .nodeCanvasObject(drawNode)
            .nodePointerAreaPaint((node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radiusOf(node) + 3, 0, 2 * Math.PI);
                ctx.fill();
            })
            .nodeLabel((n) => `<div class="tip"><strong>${escapeHtml(n.label)}</strong><span>${escapeHtml(n.type)}</span></div>`)
            .linkColor(linkColor)
            .linkWidth((l) => (isHot(l) ? 2 : 1))
            .linkDirectionalArrowLength(arrowLength)
            .linkDirectionalArrowRelPos(1)
            .linkDirectionalArrowColor(linkColor)
            .warmupTicks(20)
            .cooldownTime(12000)
            .onNodeClick((node, event) => {
                const now = Date.now();
                if (lastClick.id === node.id && now - lastClick.at < DOUBLE_CLICK_MS) {
                    // Double-click loads this resource's relationships; with shift, everything reachable from it.
                    lastClick = { id: null, at: 0 };
                    latest.current.onExpand?.(node.id, { all: event.shiftKey });
                    return;
                }
                latest.current.onSelect(node.id);
                lastClick = { id: node.id, at: now };
            })
            .onNodeRightClick((node, event) => {
                // Right-click releases a pinned node.
                event.preventDefault();
                node.fx = node.fy = undefined;
                g.d3ReheatSimulation();
                latest.current.onPinChange?.(node.id);
            })
            .onBackgroundClick(() => latest.current.onSelect(null))
            .onNodeHover((node) => (el.style.cursor = node ? 'pointer' : ''))
            .onNodeDragEnd((node) => {
                node.fx = node.x; // dragging pins
                node.fy = node.y;
                latest.current.onPinChange?.(node.id);
            })
            .onEngineTick(() => {
                if (engine.current !== 'running') {
                    engine.current = 'running';
                    latest.current.onEngine?.('running');
                }
            })
            .onEngineStop(() => {
                engine.current = 'settled';
                latest.current.onEngine?.('settled');
                if (fit.current.pending && store.nodes.length) {
                    fit.current.pending = false;
                    g.zoomToFit(...FIT);
                }
            });

        gravity.current = { x: forceX(0).strength(0.01), y: forceY(0).strength(0.01) };
        g.d3Force('x', gravity.current.x).d3Force('y', gravity.current.y);
        // Repulsion only reaches so far, so separate clusters settle near each other instead of drifting apart.
        g.d3Force('charge').distanceMax(300);

        const resize = new ResizeObserver(([entry]) => g.width(entry.contentRect.width).height(entry.contentRect.height));
        resize.observe(el);
        // Once the user pans or zooms themselves, stop re-framing the graph for them.
        const userMoved = () => (fit.current.pending = false);
        el.addEventListener('wheel', userMoved, { passive: true });
        el.addEventListener('pointerdown', userMoved);

        graph.current = g;
        return () => {
            resize.disconnect();
            el.removeEventListener('wheel', userMoved);
            el.removeEventListener('pointerdown', userMoved);
            g._destructor();
            graph.current = null;
        };
    }, [store]);

    // New data. A cleared store means a new load, so frame it when it settles.
    useEffect(() => {
        const g = graph.current;
        if (!g) return;
        if (store.nodes.length === 0) fit.current.pending = true;
        // A snapshot, not the live arrays: the store keeps growing between renders, and force-graph's link force must
        // never see a link whose endpoints it hasn't resolved yet.
        // Big graphs skip the synchronous warm-up (it would freeze the page) and cool down faster.
        const big = store.nodes.length > 2000;
        g.warmupTicks(big ? 0 : 20).d3AlphaDecay(store.nodes.length > 5000 ? 0.06 : 0.0228);
        g.graphData({ nodes: store.nodes.slice(), links: store.links.slice() });
    }, [store, version]);

    // Look changes (selection, filter, colors) don't touch the data. Setting an accessor again, with a fresh closure,
    // is what makes force-graph repaint a settled graph.
    useEffect(() => {
        const g = graph.current;
        if (!g) return;
        const { drawNode, linkColor, isHot, arrowLength } = helpers.current;
        g.nodeCanvasObject((n, ctx, scale) => drawNode(n, ctx, scale))
            .linkColor((l) => linkColor(l))
            .linkDirectionalArrowColor((l) => linkColor(l))
            .linkWidth((l) => (isHot(l) ? 2 : 1))
            .linkDirectionalArrowLength((l) => arrowLength(l));
    }, [selectedId, filterSet, legend, palette]);

    // Physics.
    useEffect(() => {
        const g = graph.current;
        if (!g) return;
        g.d3Force('link')?.distance(physics.linkDistance);
        g.d3Force('charge')?.strength(-physics.repulsion / 3);
        gravity.current.x.strength(physics.gravity / 1000);
        gravity.current.y.strength(physics.gravity / 1000);
        g.cooldownTicks(physics.paused ? 0 : Infinity);
        if (!physics.paused) g.d3ReheatSimulation();
    }, [physics]);

    // When a load finishes, frame the finished graph once the layout settles.
    useEffect(() => {
        const g = graph.current;
        if (loadStatus !== 'done' || !g) return;
        fit.current.pending = true;
        if (engine.current === 'settled') {
            fit.current.pending = false;
            g.zoomToFit(...FIT);
        }
    }, [loadStatus]);

    useImperativeHandle(
        ref,
        () => ({
            zoomIn: () => graph.current?.zoom(graph.current.zoom() * 1.4, 200),
            zoomOut: () => graph.current?.zoom(graph.current.zoom() / 1.4, 200),
            fit: () => graph.current?.zoomToFit(...FIT),
            centerOn: (id) => {
                const n = store.byId.get(id);
                if (n?.x !== undefined) graph.current?.centerAt(n.x, n.y, 500);
            },
            unpin: (id) => {
                const n = store.byId.get(id);
                if (!n) return;
                n.fx = n.fy = undefined;
                graph.current?.d3ReheatSimulation();
            },
            resetLayout: () => {
                store.nodes.forEach((n) => (n.fx = n.fy = undefined));
                graph.current?.d3ReheatSimulation();
                latest.current.onPinChange?.();
            },
            exportPng: () => {
                const source = container.current.querySelector('canvas');
                const out = document.createElement('canvas');
                out.width = source.width;
                out.height = source.height;
                const ctx = out.getContext('2d');
                ctx.fillStyle = colors.current.canvas;
                ctx.fillRect(0, 0, out.width, out.height);
                ctx.drawImage(source, 0, 0);
                return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
            },
        }),
        [store]
    );

    return <div ref={container} className="graph-canvas" role="img" aria-label="Interactive graph of resources and their relationships" />;
}
