import { useEffect, useState } from 'react';

// useState that survives a reload. Storage can be blocked or full, so every access is guarded.
export function usePersistentState(key, initial) {
    const [value, setValue] = useState(() => {
        try {
            const stored = window.localStorage.getItem(key);
            return stored === null ? initial : JSON.parse(stored);
        } catch {
            return initial;
        }
    });
    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* not persisted */
        }
    }, [key, value]);
    return [value, setValue];
}
