import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Explorer from './components/Explorer.jsx';
import Header from './components/Header.jsx';
import SignIn from './components/SignIn.jsx';

export default function App() {
    // undefined while we ask the server who's signed in; null once we know nobody is.
    const [session, setSession] = useState(undefined);
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        const ctrl = new AbortController();
        api.session(ctrl.signal)
            .then((s) => setSession(s.authenticated ? s : null))
            .catch((err) => err.name !== 'AbortError' && setSession(null));
        return () => ctrl.abort();
    }, []);

    const signOut = useCallback(async () => {
        await api.logout().catch(() => {});
        setNotice(null);
        setSession(null);
    }, []);

    const expired = useCallback(() => {
        setNotice('Your session has ended. Sign in again to continue.');
        setSession(null);
    }, []);

    if (session === undefined) {
        return (
            <div className="app">
                <Header />
            </div>
        );
    }
    if (session === null) {
        return <SignIn notice={notice} onSignedIn={(s) => (setNotice(null), setSession(s))} />;
    }
    return <Explorer session={session} onSession={setSession} onSignOut={signOut} onExpired={expired} />;
}
