// Loads environment files for CLI scripts the way Next.js does for the app:
// .env.local first, then .env, and variables already set in the process win
// over both (dotenv never overrides). Import this before anything that reads
// process.env. Values are never printed.
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
