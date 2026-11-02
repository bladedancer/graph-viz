import { useState } from 'react';
import Icon from './Icon.jsx';

const show = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

function RelatedList({ title, ids, store, palette, legend, onSelect, via }) {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button" className="ads-collapse-header section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
                <span className="ads-collapse-arrow">
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} />
                </span>
                <span className="section-title">{title}</span>
                <span className="section-summary always">{ids.length}</span>
            </button>
            {open && (
                <ul className="related">
                    {ids.length === 0 && <li className="hint">None</li>}
                    {ids.map((id) => {
                        const n = store.byId.get(id);
                        return (
                            <li key={id}>
                                <button type="button" className="related-item" onClick={() => onSelect(id)}>
                                    <span className="dot" style={{ background: palette[legend.slotOf(n)] }} aria-hidden="true" />
                                    <span className="related-name">{n.label}</span>
                                    <span className="hint">{via?.get(id) ?? n.type}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}

export default function DetailsPanel({ node, store, legend, palette, pinned, busy, onSelect, onClose, onLoadRelationships, onUnpin }) {
    const [tab, setTab] = useState('attributes');
    const groupLabel = legend.items.find((i) => i.slot === legend.slotOf(node))?.label;

    // Not memoized: the store is mutated in place while a load runs, so cached lists would go stale. Each neighbour is
    // shown with the relationship that connects it, read from the declaring node's `relationships`.
    const outbound = [...store.out.get(node.id)];
    const inbound = [...store.inn.get(node.id)];
    const via = (from, to) => {
        const rel = Object.entries(from.relationships ?? {}).find(([, targets]) => targets.includes(to.id))?.[0];
        return `${(from === node ? to : from).type} · ${rel}`;
    };
    const outVia = new Map(outbound.map((id) => [id, via(node, store.byId.get(id))]));
    const inVia = new Map(inbound.map((id) => [id, via(store.byId.get(id), node)]));

    const unloaded = store.unloadedCount(node.id);
    const attributes = Object.entries(node.attributes ?? {});
    const lists = (
        <div className="details-related">
            <RelatedList title="Outbound" ids={outbound} via={outVia} {...{ store, palette, legend, onSelect }} />
            <RelatedList title="Inbound" ids={inbound} via={inVia} {...{ store, palette, legend, onSelect }} />
        </div>
    );

    return (
        <aside className="panel panel-right" aria-label="Resource details">
            <div className="details-head">
                <div className="details-title">
                    <h2>{node.label}</h2>
                    <div className="details-meta">
                        <span className="tag">{node.type}</span>
                        {groupLabel && (
                            <>
                                <span className="dot" style={{ background: palette[legend.slotOf(node)] }} aria-hidden="true" />
                                <span className="hint">{groupLabel}</span>
                            </>
                        )}
                        {node.unresolved && <span className="hint">Couldn't be loaded</span>}
                    </div>
                </div>
                <button type="button" className="ads-btn ads-btn-text icon-button" aria-label="Close details" onClick={onClose}>
                    <Icon name="close" />
                </button>
            </div>
            <div className="details-actions">
                <button
                    type="button"
                    className="ads-btn ads-btn-secondary"
                    disabled={busy || unloaded === 0}
                    onClick={() => onLoadRelationships(false)}
                    title="Load this resource's related resources (or double-click it)"
                >
                    Load relationships{unloaded > 0 ? ` · ${unloaded.toLocaleString()}` : ''}
                </button>
                <button
                    type="button"
                    className="ads-btn ads-btn-text"
                    disabled={busy || unloaded === 0}
                    onClick={() => onLoadRelationships(true)}
                    title="Load everything reachable from this resource (or shift + double-click it)"
                >
                    Load all
                </button>
                {pinned && (
                    <button
                        type="button"
                        className="ads-btn ads-btn-text"
                        onClick={onUnpin}
                        title="Let the layout move this resource again (or right-click it)"
                    >
                        Unpin
                    </button>
                )}
                {unloaded === 0 && <span className="hint">All related resources are loaded.</span>}
            </div>
            <div className="details-tabs">
                <div className="ads-tabs" role="tablist" aria-label="Resource details">
                    {[
                        ['attributes', 'Attributes'],
                        ['relationships', 'Relationships'],
                        ['json', 'Raw JSON'],
                    ].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            className={`ads-tab tab-button${tab === id ? ' ads-tab-active' : ''}`}
                            onClick={() => setTab(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="details-body" role="tabpanel">
                {tab === 'attributes' && (
                    <>
                        <dl className="attributes">
                            {attributes.length === 0 && <p className="hint">No attributes.</p>}
                            {attributes.map(([key, value]) => (
                                <div key={key} className="attribute">
                                    <dt>{key}</dt>
                                    <dd title={typeof value === 'object' ? undefined : String(value)}>{show(value)}</dd>
                                </div>
                            ))}
                        </dl>
                        {lists}
                    </>
                )}
                {tab === 'relationships' && lists}
                {tab === 'json' && (
                    <pre className="json">
                        {JSON.stringify(
                            { type: node.type, id: node.rawId, attributes: node.attributes, relationships: node.relationships },
                            null,
                            2
                        )}
                    </pre>
                )}
            </div>
        </aside>
    );
}
