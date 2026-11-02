import Icon from './Icon.jsx';
import NumberField from './NumberField.jsx';
import RootSelect from './RootSelect.jsx';

const LIMITS = { perRoot: { min: 1, max: 10000 }, maxResources: { min: 10, max: 100000 } };

// Above this the graph is still shown, but loading and drawing take noticeably longer.
const LARGE = 5000;

export default function SourceSection({
    roots,
    counts,
    selected,
    onSelected,
    perRoot,
    onPerRoot,
    maxResources,
    onMaxResources,
    load,
    onLoad,
    onCancel,
    canLoadRelationships,
    onLoadRelationships,
}) {
    const loading = load.status === 'loading';
    const progress = load.progress;
    const pct = progress && progress.resources > 0 ? Math.round((progress.loaded / progress.resources) * 100) : 0;
    const summary = load.summary;

    return (
        <div className="stack">
            <RootSelect roots={roots} counts={counts} selected={selected} onChange={onSelected} disabled={loading} />
            <div className="field-pair">
                <NumberField label="Per type" value={perRoot} {...LIMITS.perRoot} onChange={onPerRoot} disabled={loading} />
                <NumberField
                    label="Max resources"
                    value={maxResources}
                    {...LIMITS.maxResources}
                    onChange={onMaxResources}
                    disabled={loading}
                />
            </div>
            {(perRoot > LARGE || maxResources > LARGE) && (
                <p className="hint">Very large graphs take a while to load, and are drawn in a simplified form until you zoom in.</p>
            )}
            <p className="hint">
                Load graph reads the selected types. Load relationships then brings in what they relate to, up to Max resources. You can
                also double-click a resource to load its relationships, or shift + double-click to load everything reachable from it.
            </p>

            {loading ? (
                <>
                    <div className="progress-card">
                        <div className="progress-head">
                            <span className="strong">Reading resources</span>
                            <span className="hint">
                                {progress.loaded.toLocaleString()} of {progress.resources.toLocaleString()} loaded
                            </span>
                        </div>
                        <div
                            className="progress"
                            role="progressbar"
                            aria-label="Crawl progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={pct}
                        >
                            <div className="progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
                        </div>
                        <span className="hint">{progress.requests.toLocaleString()} requests</span>
                    </div>
                    <div className="row">
                        <button type="button" className="ads-btn" disabled>
                            <Icon name="refresh" />
                            Loading graph
                        </button>
                        <button type="button" className="ads-btn ads-btn-secondary" onClick={onCancel}>
                            Cancel
                        </button>
                    </div>
                </>
            ) : (
                <div className="row">
                    <button type="button" className="ads-btn" disabled={selected.length === 0} onClick={onLoad}>
                        <Icon name="refresh" />
                        Load graph
                    </button>
                    <button
                        type="button"
                        className="ads-btn ads-btn-secondary"
                        disabled={!canLoadRelationships}
                        onClick={onLoadRelationships}
                        title="Load what the loaded resources relate to, up to Max resources"
                    >
                        Load relationships
                    </button>
                </div>
            )}

            {load.status === 'error' && (
                <div className="ads-alert ads-alert-error" role="alert">
                    <div>
                        <div className="ads-alert-title">Couldn't load the graph</div>
                        {load.error}
                    </div>
                </div>
            )}
            {summary?.truncated && (
                <div className="ads-alert ads-alert-warning">
                    <div>
                        <div className="ads-alert-title">Stopped at {maxResources.toLocaleString()} resources</div>
                        There are more. Raise Max resources to see them.
                    </div>
                </div>
            )}
            {summary?.warnings?.length > 0 && (
                <div className="ads-alert ads-alert-warning">
                    <div>
                        <div className="ads-alert-title">Some resources couldn't be loaded</div>
                        <ul className="warning-list">
                            {summary.warnings.slice(0, 5).map((w) => (
                                <li key={`${w.type}${w.status}`}>
                                    <strong>{w.type}</strong>
                                    {w.status ? ` (${w.status})` : ''}: {w.message}
                                    {w.count > 1 ? ` ×${w.count}` : ''}
                                </li>
                            ))}
                            {summary.warnings.length > 5 && <li>and {summary.warnings.length - 5} more</li>}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
