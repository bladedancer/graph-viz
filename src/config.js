import { config } from 'dotenv';
// Load defaults from .env
config();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

export default {
    PORT,
};
