import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err: Error) => {
  console.error('Error en base de datos:', err);
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
};