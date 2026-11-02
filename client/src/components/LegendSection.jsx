export default function LegendSection({ legend, palette, colorBy, onColorBy }) {
    return (
        <div className="stack">
            <div className="segmented" role="group" aria-label="Color by">
                {[
                    ['group', 'Project'],
                    ['type', 'Type'],
                ].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={colorBy === value}
                        className={`ads-btn${colorBy === value ? '' : ' ads-btn-secondary'}`}
                        onClick={() => onColorBy(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <ul className="legend">
                {legend.items.map((item) => (
                    <li key={item.key}>
                        <span className="dot" style={{ background: palette[item.slot] }} aria-hidden="true" />
                        <span className="legend-label">{item.label}</span>
                        <span className="hint">{item.count.toLocaleString()}</span>
                    </li>
                ))}
            </ul>
            <p className="hint">Larger rings are the root resources you selected.</p>
        </div>
    );
}
