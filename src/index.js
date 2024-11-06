import config from './config.js';
import express from 'express';
import cors from 'cors';
import { log } from './log.js';

const app = express();
app.use(cors());
app.use(express.static('client/dist'));

app.listen(config.PORT, async () => {
    log.info(`Graph Viz listening on port ${config.PORT}`);
});
