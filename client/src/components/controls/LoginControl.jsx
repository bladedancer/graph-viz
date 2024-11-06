import React, { useState, useRef, useId, useCallback, useEffect } from 'react';
import { useSetAuth, useSetAccesToken, useSettingsContext, useSetNodeData } from '../../hooks/useSettings.js';
import { FiUpload, FiRefreshCw } from 'react-icons/fi';
import './login.css';

const LoginControl = ({}) => {
    const { settings } = useSettingsContext();
    const { setAuth } = useSetAuth();
    const { setAccessToken } = useSetAccesToken();
    const { setNodeData } = useSetNodeData();
    
    const [busy, setBusy] = useState(false);
    const [tenantUrl, setTenantUrl] = useState("https://multi.10-128-151-171.nip.io");

    const [userName, setUserName] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const tenantUrlId = useId();
    const usernameId = useId();
    const passwordId = useId();

    const login = useCallback(async () => {
        setBusy(true);
        
        // Get services url
        const servicesUrl = new URL(tenantUrl);
        const hostnameParts = servicesUrl.hostname.split('.');
        const tenant = hostnameParts[0];
        hostnameParts[0] = 'services';
        servicesUrl.hostname = hostnameParts.join('.');
        const loginUrl = `${servicesUrl.toString()}api/auth/login`;

        // login
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: userName,
                password: password,
                domain: tenant,
                remember: false,
                duplicateSession: true
            }),
        });

        if (!response.ok) {
            console.log(response);
            setAccessToken("");
            setError('Login failed.');
        } else {
            const data = await response.json();
            setAuth({
                accessToken: data["access_token"],
                mode: 'DESIGN',
                tenantUrl: tenantUrl,
                servicesUrl: servicesUrl.toString()
            });
            setError('');
        }

        setBusy(false);        
    }, [tenantUrl, userName, password, settings]);

    const logout = useCallback(async () => {
        setBusy(true);
        const logoutUrl = `${settings.auth.tenantUrl}/api/auth/logout`;
        console.log(settings);
        if (settings.auth.accessToken !== "") {
            await fetch(logoutUrl, {
                method: 'GET',    
                headers: {
                    'Authorization': 'Bearer ' + settings.auth.accessToken,
                    'Env-Mode': settings.auth.mode
                }
            });   
        }
        setAccessToken("");
        setError('');
        setBusy(false);
    }, [settings.auth]);

    return (
        <>
            <div className="react-cy-control login-control">
                {settings.auth.accessToken !== "" && 
                    <div className='authenticated'>
                        <button onClick={logout} disabled={busy}>
                            <label>Logout</label>
                        </button>
                    </div>}
                {settings.auth.accessToken === "" && 
                    <div className="unauthenticated">
                        <label htmlFor={tenantUrlId}>Tenant Url</label>
                        <input
                            id={tenantUrlId}
                            value={tenantUrl}
                            onChange={(e) => setTenantUrl(e.target.value)}
                            type='text'
                            placeholder='Tenant URL'
                            disabled={busy}
                        />
                        <label htmlFor={usernameId}>Email</label>
                        <input
                            id={usernameId}
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            type='text'
                            placeholder='Username'
                            disabled={busy}
                        />
                        <label htmlFor={passwordId}>Password</label>
                        <input
                            id={passwordId}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type="password"
                            placeholder='Password'
                            disabled={busy}
                        />
                        <button onClick={login} disabled={busy || (!userName || !tenantUrl || !password)}>
                            <label>Login
                                {busy && <FiRefreshCw />}
                                {!busy && <FiUpload />}
                            </label>
                        </button>
                        <label className='error'>{error}</label>
                    </div>}
            </div>
        </>
    );    
};

export default LoginControl;
