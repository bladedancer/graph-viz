// A faded, static picture of a graph behind the sign-in card. Purely decorative: it shows the kind of thing the app
// draws, and is not data.
const NODES = [
    [0.585, 0.598, 1, 0],
    [0.718, 0.478, 2, 0],
    [0.345, 0.627, 2, 0],
    [0.464, 0.514, 1, 0],
    [0.123, 0.618, 1, 0],
    [0.971, 0.512, 0, 0],
    [0.946, 0.392, 0, 0],
    [0.172, 0.753, 0, 0],
    [0.547, 0.426, 0, 0],
    [0.752, 0.915, 1, 1],
    [0.776, 0.769, 2, 1],
    [0.523, 0.899, 2, 1],
    [0.481, 0.741, 1, 1],
    [1, 0.778, 0, 1],
    [0.405, 1, 0, 1],
    [0.641, 0.829, 0, 1],
    [0.313, 0, 1, 2],
    [0.275, 0.149, 2, 2],
    [0.183, 0.304, 1, 2],
    [0.039, 0.162, 0, 2],
    [0.472, 0.069, 0, 2],
    [0.495, 0.297, 0, 2],
    [0.796, 0.184, 1, 3],
    [0.587, 0.208, 0, 3],
    [0.321, 0.358, 2, 3],
    [0.139, 0.451, 1, 3],
    [0, 0.359, 0, 3],
    [0.754, 0.306, 1, 4],
    [0.259, 0.528, 1, 4],
    [0.828, 0.626, 0, 4],
    [0.12, 0.044, 0, 4],
];
const EDGES = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
    [1, 5],
    [1, 6],
    [2, 7],
    [1, 8],
    [2, 8],
    [1, 29],
    [3, 28],
    [4, 28],
    [8, 27],
    [9, 10],
    [9, 11],
    [10, 12],
    [11, 12],
    [10, 13],
    [11, 14],
    [10, 15],
    [11, 15],
    [12, 28],
    [10, 29],
    [16, 17],
    [17, 18],
    [17, 19],
    [17, 20],
    [18, 28],
    [17, 30],
    [21, 17],
    [21, 1],
    [22, 23],
    [23, 24],
    [24, 25],
    [24, 26],
    [25, 28],
    [24, 8],
    [22, 27],
];
const SIZES = [4, 8, 11]; // leaf, hub, root
const COLORS = [
    'var(--ads-primary-500)',
    'var(--ads-warning-400)',
    'var(--ads-tertiary-500)',
    'var(--ads-primary-100)',
    'var(--ads-secondary-400)',
];
const X = (n) => 80 + n * 840;
const Y = (n) => 70 + n * 660;

export default function Backdrop() {
    return (
        <svg className="backdrop" viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
            <g stroke="var(--ads-secondary-300)" strokeWidth="1.5">
                {EDGES.map(([a, b]) => (
                    <line key={`${a}-${b}`} x1={X(NODES[a][0])} y1={Y(NODES[a][1])} x2={X(NODES[b][0])} y2={Y(NODES[b][1])} />
                ))}
            </g>
            {NODES.map(([x, y, size, group], i) => (
                <circle key={i} cx={X(x)} cy={Y(y)} r={SIZES[size]} fill={COLORS[group]} stroke="var(--ads-util-white)" strokeWidth="2" />
            ))}
        </svg>
    );
}
