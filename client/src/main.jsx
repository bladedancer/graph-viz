import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Amplify Fusion design system (vendored from the design system artifact): tokens, Roboto, ads-* classes.
import './ds/tokens.css';
import './ds/bundle.css';
import './app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>
);
