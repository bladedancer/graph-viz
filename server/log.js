// Minimal levelled logger. Never pass credentials, tokens or request bodies to it.
const write = (level, args) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)}`;
    (level === 'error' ? console.error : console.log)(line, ...args);
};

export const log = {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
};
