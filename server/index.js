import { createApp } from './app.js';
import { config } from './config.js';
import { log } from './log.js';

const app = createApp({ config });

const server = app.listen(config.port, config.host, () => {
    log.info(`Graph Visualizer listening on http://${config.host}:${config.port}`);
    if (config.allowedTenantHosts.length === 0) {
        log.warn('ALLOWED_TENANT_HOSTS is not set: users can sign in to any tenant host.');
    }
});

const shutdown = () => {
    log.info('Shutting down');
    app.locals.sessions.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
