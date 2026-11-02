import { useId } from 'react';
import Icon from './Icon.jsx';

// The environments a Fusion tenant serves. The value is what the server sends as the Env-Mode header.
const MODES = [
    ['DESIGN', 'Design'],
    ['CHECK', 'Check'],
    ['LIVE', 'Live'],
];

export default function Header({ session, onSignOut, onModeChange, onToggleControls, controlsOpen, busy }) {
    const modeId = useId();
    return (
        <header className="app-header">
            <button
                type="button"
                className="ads-btn ads-btn-text icon-button controls-toggle"
                aria-label="Controls"
                aria-expanded={controlsOpen}
                onClick={onToggleControls}
            >
                <Icon name="menu" />
            </button>
            <span className="app-title">Graph Visualizer</span>
            {session && (
                <>
                    <span className="header-divider" aria-hidden="true" />
                    <span className="hint header-tenant">{new URL(session.tenantUrl).host}</span>
                    <label className="visually-hidden" htmlFor={modeId}>
                        Environment
                    </label>
                    <select
                        id={modeId}
                        className="ads-input mode-select"
                        value={session.mode}
                        disabled={busy}
                        onChange={(e) => onModeChange(e.target.value)}
                    >
                        {MODES.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <span className="header-spacer" />
                    <span className="header-user">{session.user.name}</span>
                    <button type="button" className="ads-btn ads-btn-text" aria-label="Sign out" onClick={onSignOut} disabled={busy}>
                        <Icon name="logout" />
                        <span className="btn-label">Sign out</span>
                    </button>
                </>
            )}
        </header>
    );
}
