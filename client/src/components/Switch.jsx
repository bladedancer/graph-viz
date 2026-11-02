export default function Switch({ checked, onChange, label }) {
    return (
        <label className="switch-row">
            <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
                <span className="switch-thumb" />
            </button>
            <span>{label}</span>
        </label>
    );
}
