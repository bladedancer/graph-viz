import { useId } from 'react';
import Icon from './Icon.jsx';

// A collapsible panel section, built on the design system's collapse header.
export default function Section({ title, summary, open, onToggle, children }) {
    const id = useId();
    return (
        <section className="section">
            <button type="button" className="ads-collapse-header section-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
                <span className="ads-collapse-arrow">
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} />
                </span>
                <span className="section-title">{title}</span>
                {summary && !open && <span className="section-summary">{summary}</span>}
            </button>
            {open && (
                <div className="section-body" id={id}>
                    {children}
                </div>
            )}
        </section>
    );
}
