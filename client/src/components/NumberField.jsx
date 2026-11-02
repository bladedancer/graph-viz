import { useId, useState } from 'react';

// A whole-number input that lets you type freely and commits (clamped) when you leave the field.
export default function NumberField({ label, value, min, max, onChange, disabled }) {
    const id = useId();
    const [draft, setDraft] = useState(String(value));
    // Follow the value when it changes from outside (adjusting state while rendering, not in an effect).
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
        setSeen(value);
        setDraft(String(value));
    }

    const commit = () => {
        const n = Number.parseInt(draft, 10);
        const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
        setDraft(String(next));
        if (next !== value) onChange(next);
    };

    return (
        <div className="ads-form-item field">
            <label className="ads-form-label" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                className="ads-input"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
        </div>
    );
}
