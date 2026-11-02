import { useId, useMemo, useState } from 'react';
import Icon from './Icon.jsx';

const countText = (info) => {
    if (info === undefined) return '…';
    if (info.error) return 'unavailable';
    return info.total === null ? '—' : info.total.toLocaleString();
};

/**
 * Multi-select for the root resource types (the types the Fusion graph model exposes as collections).
 * Selected types show as removable chips; the list opens inline (not as an overlay, so the side panel can't clip it)
 * with a search box and each type's record count. Types the tenant can't list are shown but disabled.
 */
export default function RootSelect({ roots, counts, selected, onChange, disabled }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const listId = useId();
    const searchId = useId();
    const byName = useMemo(() => new Map(roots.map((r) => [r.name, r])), [roots]);

    const options = useMemo(() => {
        const q = query.trim().toLowerCase();
        const unavailable = (r) => Boolean(counts?.[r.name]?.error);
        return roots
            .filter((r) => !q || `${r.label} ${r.name} ${r.description}`.toLowerCase().includes(q))
            .sort((a, b) => unavailable(a) - unavailable(b) || a.label.localeCompare(b.label));
    }, [roots, counts, query]);

    const toggle = (name) => onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

    return (
        <div className="ads-form-item field root-select">
            <span className="ads-form-label" id={`${listId}-label`}>
                Root resources
            </span>
            <div className={`root-select-field${disabled ? ' is-disabled' : ''}`}>
                <ul className="chips" aria-labelledby={`${listId}-label`}>
                    {selected.length === 0 && <li className="chips-empty">Select one or more types</li>}
                    {selected.map((name) => (
                        <li key={name} className="chip">
                            <span>{byName.get(name)?.label ?? name}</span>
                            <button
                                type="button"
                                className="chip-remove"
                                aria-label={`Remove ${byName.get(name)?.label ?? name}`}
                                disabled={disabled}
                                onClick={() => toggle(name)}
                            >
                                <Icon name="close" size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    className="root-select-toggle"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-label={open ? 'Hide resource types' : 'Show resource types'}
                    disabled={disabled}
                    onClick={() => setOpen(!open)}
                >
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} />
                </button>
            </div>

            {open && (
                <div className="root-list" id={listId}>
                    <label className="visually-hidden" htmlFor={searchId}>
                        Search resource types
                    </label>
                    <input
                        id={searchId}
                        className="ads-input"
                        type="search"
                        placeholder="Search types"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div role="group" aria-label="Root resource types" className="root-options">
                        {options.length === 0 && <p className="hint">No types match “{query}”.</p>}
                        {options.map((r) => {
                            const info = counts?.[r.name];
                            const blocked = Boolean(info?.error);
                            return (
                                <label
                                    key={r.name}
                                    className={`option${blocked ? ' is-blocked' : ''}`}
                                    title={blocked ? `The tenant can't list this type: ${info.error}` : r.description}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(r.name)}
                                        disabled={blocked}
                                        onChange={() => toggle(r.name)}
                                    />
                                    <span className="option-text">
                                        {r.label}
                                        {r.label !== r.name && <span className="option-name"> {r.name}</span>}
                                    </span>
                                    <span
                                        className={`option-count${info?.total === 0 ? ' is-zero' : ''}`}
                                        title={info?.total === null ? "The tenant doesn't report a count for this type" : undefined}
                                    >
                                        {countText(info)}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                    <div className="root-list-footer">
                        <span className="hint">{selected.length} selected</span>
                        <button
                            type="button"
                            className="ads-btn ads-btn-text"
                            disabled={selected.length === 0}
                            onClick={() => onChange([])}
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
