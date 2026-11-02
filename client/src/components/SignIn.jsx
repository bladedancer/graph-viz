import { useId, useState } from 'react';
import { ApiError, api } from '../api.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import Backdrop from './Backdrop.jsx';
import Header from './Header.jsx';

const FAILURE_TITLES = {
    unreachable: "Can't reach the tenant",
    rate_limited: 'Too many attempts',
    tenant_not_allowed: 'Tenant not allowed',
    network: "Can't reach the server",
};

export default function SignIn({ notice, onSignedIn }) {
    const [tenantUrl, setTenantUrl] = usePersistentState('gv.tenantUrl', '');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const ids = { tenant: useId(), email: useId(), password: useId() };

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            onSignedIn(await api.login({ tenantUrl: tenantUrl.trim(), email: email.trim(), password }));
        } catch (err) {
            setError(err instanceof ApiError ? err : new ApiError('error', 'Something went wrong. Try again.', 0));
            setPassword('');
            setBusy(false);
        }
    };

    return (
        <div className="app">
            <Header />
            <div className="canvas">
                <Backdrop />
                <main className="signin-card">
                    <h1>Sign in to your tenant</h1>
                    <p className="lede">Graph Visualizer reads your tenant's configuration and draws it as a graph you can explore.</p>
                    <form onSubmit={submit} className="stack-lg">
                        <div className="ads-form-item field">
                            <label className="ads-form-label" htmlFor={ids.tenant}>
                                Tenant URL
                            </label>
                            <input
                                id={ids.tenant}
                                className="ads-input"
                                type="url"
                                autoComplete="url"
                                placeholder="https://acme.fusion.example.com"
                                value={tenantUrl}
                                onChange={(e) => setTenantUrl(e.target.value)}
                                required
                                disabled={busy}
                            />
                        </div>
                        <div className="ads-form-item field">
                            <label className="ads-form-label" htmlFor={ids.email}>
                                Email
                            </label>
                            <input
                                id={ids.email}
                                className="ads-input"
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={busy}
                            />
                        </div>
                        <div className="ads-form-item field">
                            <label className="ads-form-label" htmlFor={ids.password}>
                                Password
                            </label>
                            <input
                                id={ids.password}
                                className="ads-input"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={busy}
                            />
                        </div>
                        {error && (
                            <div className="ads-alert ads-alert-error" role="alert">
                                <div>
                                    <div className="ads-alert-title">{FAILURE_TITLES[error.code] ?? 'Sign-in failed'}</div>
                                    {error.message}
                                </div>
                            </div>
                        )}
                        {!error && notice && (
                            <div className="ads-alert ads-alert-warning" role="status">
                                <div>
                                    <div className="ads-alert-title">Signed out</div>
                                    {notice}
                                </div>
                            </div>
                        )}
                        <div className="row row-end">
                            <button type="submit" className="ads-btn" disabled={busy}>
                                {busy ? 'Signing in…' : 'Sign in'}
                            </button>
                        </div>
                    </form>
                    <p className="hint fine-print">
                        Your credentials go to this app's server, which signs in to the tenant for you. They are not stored in your browser.
                    </p>
                </main>
            </div>
        </div>
    );
}
