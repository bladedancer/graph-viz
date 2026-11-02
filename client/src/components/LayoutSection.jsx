import { useId } from 'react';
import Icon from './Icon.jsx';

function Slider({ label, value, display, min, max, onChange }) {
    const id = useId();
    return (
        <div className="slider">
            <div className="slider-head">
                <label htmlFor={id}>{label}</label>
                <span className="hint">{display}</span>
            </div>
            <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        </div>
    );
}

export default function LayoutSection({ physics, onChange, onReset }) {
    return (
        <div className="stack">
            <Slider
                label="Link distance"
                min={20}
                max={200}
                value={physics.linkDistance}
                display={physics.linkDistance}
                onChange={(linkDistance) => onChange({ ...physics, linkDistance })}
            />
            <Slider
                label="Repulsion"
                min={0}
                max={1000}
                value={physics.repulsion}
                display={physics.repulsion}
                onChange={(repulsion) => onChange({ ...physics, repulsion })}
            />
            <Slider
                label="Center gravity"
                min={0}
                max={100}
                value={physics.gravity}
                display={(physics.gravity / 100).toFixed(2)}
                onChange={(gravity) => onChange({ ...physics, gravity })}
            />
            <div className="row">
                <button
                    type="button"
                    className="ads-btn ads-btn-secondary"
                    aria-pressed={physics.paused}
                    onClick={() => onChange({ ...physics, paused: !physics.paused })}
                >
                    <Icon name={physics.paused ? 'play' : 'pause'} />
                    {physics.paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" className="ads-btn ads-btn-text" onClick={onReset}>
                    Reset layout
                </button>
            </div>
            <p className="hint">Drag a resource to pin it; right-click it (or use Unpin in its details) to release it.</p>
        </div>
    );
}
