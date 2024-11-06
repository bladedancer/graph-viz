import {
    createContext,
    useContext,
} from 'react';

export const SettingsContext = createContext({
    settings: {},
    setSettings: () => {},
});

export const SettingsProvider = SettingsContext.Provider;

export function useSettingsContext() {
    const context = useContext(SettingsContext);
    if (context == null) {
        throw new Error(
            'No context provided: useSettingsContext() can only be used in a descendant of <GraphContainer>'
        );
    }
    return context;
}

export function useSetNodeData() {
    const { settings, setSettings } = useSettingsContext();
    return {
        setNodeData: (nodeData) =>
            setSettings({ ...settings, nodeData, selection: [] }),
    };
}

export function useSetNodeFilter() {
    const { settings, setSettings } = useSettingsContext();
    return {
        setNodeFilter: (nodeFilter) =>
            setSettings({
                ...settings,
                nodeFilter: {
                    ...settings.nodeFilter,
                    ...nodeFilter,
                },
            }),
    };
}

export function useSetSelection() {
    const { settings, setSettings } = useSettingsContext();
    return {
        setSelection: (selection) => setSettings({ ...settings, selection }),
    };
}

export function useSetAuth() {
    const { settings, setSettings } = useSettingsContext();
    return {
        setAuth: (auth) =>
            setSettings({ ...settings, auth })
    };
}

export function useSetAccesToken() {
    const { settings, setSettings } = useSettingsContext();
    return {
        setAccessToken: (accessToken) =>
            setSettings({
                ...settings,
                auth: {
                    ...settings.auth,
                    accessToken,
                }
            })
    };
}