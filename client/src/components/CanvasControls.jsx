import Icon from './Icon.jsx';

export function Toolbar({ onExport, exportDisabled, exporting, onLoadRelationships, canLoadRelationships, unloaded }) {
    return (
        <div className="toolbar">
            <button
                type="button"
                className="ads-btn ads-btn-secondary"
                onClick={onLoadRelationships}
                disabled={!canLoadRelationships}
                title={
                    unloaded > 0
                        ? `Load the resources that the ${unloaded.toLocaleString()} unloaded relationships point to, and follow on from them`
                        : 'Everything the loaded resources relate to is already loaded'
                }
            >
                <Icon name="refresh" />
                Load relationships
            </button>
            <button type="button" className="ads-btn ads-btn-text" onClick={onExport} disabled={exportDisabled || exporting}>
                <Icon name={exporting ? 'refresh' : 'download'} />
                Export PNG
            </button>
        </div>
    );
}

export function ZoomControls({ onZoomIn, onZoomOut, onFit, disabled }) {
    return (
        <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="ads-btn ads-btn-text icon-button" aria-label="Zoom in" disabled={disabled} onClick={onZoomIn}>
                <Icon name="plus" />
            </button>
            <button
                type="button"
                className="ads-btn ads-btn-text icon-button"
                aria-label="Zoom out"
                disabled={disabled}
                onClick={onZoomOut}
            >
                <Icon name="minus" />
            </button>
            <button
                type="button"
                className="ads-btn ads-btn-text icon-button"
                aria-label="Fit graph to screen"
                disabled={disabled}
                onClick={onFit}
            >
                <Icon name="fit" />
            </button>
        </div>
    );
}

export function StatusChip({ children, action }) {
    return (
        <div className="status" role="status">
            <span>{children}</span>
            {action && (
                <button type="button" className="ads-btn ads-btn-text status-action" onClick={action.onClick}>
                    {action.label}
                </button>
            )}
        </div>
    );
}

// A message about something that happened off to the side (a load that found nothing, hit its limit, partly failed).
export function Toast({ tone, title, text, onClose }) {
    return (
        <div className={`toast ads-alert ads-alert-${tone === 'info' ? 'success' : tone}`} role={tone === 'error' ? 'alert' : 'status'}>
            <div className="toast-body">
                {title && <div className="ads-alert-title">{title}</div>}
                {text}
            </div>
            <button type="button" className="ads-btn ads-btn-text icon-button toast-close" aria-label="Dismiss" onClick={onClose}>
                <Icon name="close" />
            </button>
        </div>
    );
}

export function EmptyState({ title, children }) {
    return (
        <div className="empty">
            <div className="empty-card">
                <h2>{title}</h2>
                <p>{children}</p>
            </div>
        </div>
    );
}
