import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FiUpload, FiRefreshCw } from 'react-icons/fi';
import { useSettingsContext, useSetNodeData } from '../../hooks/useSettings';
import { fetchGraph, nodify }  from '../../utils/fetchGraph';
import './sourcecontrol.css';

const SourceControl = ({}) => {
    const { settings, setSettings } = useSettingsContext();
    const [busy, setBusy] = useState(false);
    const [selectedRootUrl, setSelectedRootUrl] = useState("/project");
    const { setNodeData } = useSetNodeData();

    const fetchRoot = useCallback(async () => {
        setBusy(true);
        const root = settings.auth.tenantUrl + "/api/config/v1" + selectedRootUrl;
        const graph = await fetchGraph(root, settings.auth.accessToken, settings.auth.mode);
        const nodes = await nodify(graph);
        setNodeData(nodes);
        setBusy(false);
    }, [selectedRootUrl, settings]);

    return (
        <>
            <div className="react-cy-control source-control">
                <label htmlFor="rootUrl">
                    Root
                </label>
                <input
                    id="rootUrl"
                    value={selectedRootUrl}
                    type="url"
                    onChange={(e) => setSelectedRootUrl(e.target.value)}
                    disabled={busy}
                />
                <label onClick={(e) => fetchRoot()}>
                    <FiRefreshCw />
                </label>
            </div>
        </>
    );
};

export default SourceControl;
