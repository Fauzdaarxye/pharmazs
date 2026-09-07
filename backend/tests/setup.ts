// Jest setup: ensure env is loaded from the backend .env before modules initialise.
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
// Keep test output readable — silence the app logger unless explicitly overridden.
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'silent';
