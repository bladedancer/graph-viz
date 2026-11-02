import { useId } from 'react';
import Switch from './Switch.jsx';

const DIRECTIONS = [
    ['both', 'Both'],
    ['inbound', 'Inbound'],
    ['outbound', 'Outbound'],
];

export default function FilterSection({ filter, onChange, result }) {
    const id = useId();
    return (
        <div className="stack">
            <div className="ads-form-item field">
                <label className="ads-form-label" htmlFor={id}>
                    Search resources
                </label>
                <input
                    id={id}
                    className="ads-input"
                    type="search"
                    placeholder="Filter by name or type"
                    value={filter.text}
                    onChange={(e) => onChange({ ...filter, text: e.target.value })}
                />
            </div>
            <Switch
                checked={filter.connected}
                onChange={(connected) => onChange({ ...filter, connected })}
                label="Include connected resources"
            />
            <Switch checked={filter.hide} onChange={(hide) => onChange({ ...filter, hide })} label="Hide unselected" />
            {filter.connected && (
                <div className="segmented" role="group" aria-label="Direction">
                    {DIRECTIONS.map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={filter.direction === value}
                            className={`ads-btn${filter.direction === value ? '' : ' ads-btn-secondary'}`}
                            onClick={() => onChange({ ...filter, direction: value })}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}
            {result && (
                <p className="hint" aria-live="polite">
                    {result.matches.size === 0
                        ? 'Nothing matches.'
                        : `Showing ${result.matches.size.toLocaleString()} ${result.matches.size === 1 ? 'match' : 'matches'}${
                              filter.connected ? ' and the resources they connect to' : ''
                          }. Everything else is ${filter.hide ? 'hidden' : 'dimmed'}.`}
                </p>
            )}
        </div>
    );
}
