// 16px (and 10px chevron) stroke icons in one weight, drawn to match the design system's line style.
const ICONS = {
    chevronDown: { box: 10, d: 'M2 3.5 5 6.5 8 3.5' },
    chevronRight: { box: 10, d: 'M3.5 2 6.5 5 3.5 8' },
    refresh: { box: 16, d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3' },
    pause: { box: 16, d: 'M6 3v10M10 3v10' },
    play: { box: 16, d: 'M5 3l8 5-8 5z' },
    plus: { box: 16, d: 'M8 3v10M3 8h10' },
    minus: { box: 16, d: 'M3 8h10' },
    fit: { box: 16, d: 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4' },
    download: { box: 16, d: 'M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11' },
    close: { box: 16, d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' },
    logout: { box: 16, d: 'M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6' },
    menu: { box: 16, d: 'M2 4h12M2 8h12M2 12h12' },
};

export default function Icon({ name, size }) {
    const { box, d } = ICONS[name];
    const px = size ?? box;
    return (
        <svg width={px} height={px} viewBox={`0 0 ${box} ${box}`} fill="none" aria-hidden="true" focusable="false">
            <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
