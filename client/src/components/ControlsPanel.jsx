import { useState } from 'react';
import FilterSection from './FilterSection.jsx';
import LayoutSection from './LayoutSection.jsx';
import LegendSection from './LegendSection.jsx';
import Section from './Section.jsx';
import SourceSection from './SourceSection.jsx';

export default function ControlsPanel({
    open,
    hasGraph,
    loading,
    source,
    rootLabels,
    filter,
    onFilter,
    filterResult,
    physics,
    onPhysics,
    onResetLayout,
    legend,
    palette,
    colorBy,
    onColorBy,
}) {
    const [sourceOpen, setSourceOpen] = useState(true);
    const [filterOpen, setFilterOpen] = useState(true);
    const [layoutOpen, setLayoutOpen] = useState(true);
    const [legendOpen, setLegendOpen] = useState(true);

    // Tuck Source away once a graph has loaded; bring it back when a new load starts. (Adjusting state while
    // rendering, as React recommends, rather than in an effect.)
    const status = source.load.status;
    const [seenStatus, setSeenStatus] = useState(status);
    if (status !== seenStatus) {
        setSeenStatus(status);
        if (status === 'loading') setSourceOpen(true);
        if (status === 'done') setSourceOpen(false);
    }

    const summary = rootLabels.length <= 2 ? rootLabels.join(', ') : `${rootLabels.slice(0, 2).join(', ')} +${rootLabels.length - 2}`;
    const ready = hasGraph && !loading;

    return (
        <aside className={`panel panel-left${open ? ' is-open' : ''}`} aria-label="Graph controls">
            <Section title="Source" summary={summary} open={sourceOpen} onToggle={() => setSourceOpen(!sourceOpen)}>
                <SourceSection {...source} />
            </Section>
            {ready ? (
                <>
                    <Section title="Filter" open={filterOpen} onToggle={() => setFilterOpen(!filterOpen)}>
                        <FilterSection filter={filter} onChange={onFilter} result={filterResult} />
                    </Section>
                    <Section title="Layout" open={layoutOpen} onToggle={() => setLayoutOpen(!layoutOpen)}>
                        <LayoutSection physics={physics} onChange={onPhysics} onReset={onResetLayout} />
                    </Section>
                    <Section title="Colors" open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)}>
                        <LegendSection legend={legend} palette={palette} colorBy={colorBy} onColorBy={onColorBy} />
                    </Section>
                </>
            ) : (
                <p className="hint panel-hint">
                    {loading
                        ? 'Search, layout and colors become available as soon as the graph has loaded. You can drag resources around while it settles.'
                        : 'Search, layout and colors become available once a graph is loaded.'}
                </p>
            )}
        </aside>
    );
}
