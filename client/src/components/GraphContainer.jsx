import React, { useState, useMemo } from 'react';
import { SettingsProvider } from '../hooks/useSettings.js';

const GraphContainer = ({ children }) => {
    const [settings, setSettings] = useState({
        selection: [],
        nodes: {
            filter: '',
            connected: false,
            direction: 'both',
        }
    });
    const context = useMemo(() => ({ settings, setSettings }), [settings]);

    return (
        <div>
            <SettingsProvider value={context}>{children}</SettingsProvider>
        </div>
    );
};

export default GraphContainer;
