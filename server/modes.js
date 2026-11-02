// The environment modes a Fusion tenant serves: the Env-Mode header selects which one a request reads. The tenant
// answers any other value with a 403. (Their order is the order the UI offers them in.)
export const MODES = ['DESIGN', 'CHECK', 'LIVE'];

/** 'check', 'Check' and 'CHECK' all mean CHECK; anything that isn't a mode gives undefined. */
export const normalizeMode = (value) => {
    const mode = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return MODES.includes(mode) ? mode : undefined;
};
