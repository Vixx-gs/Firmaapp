// Wrapper de arranque para hosting (Plesk u otros) que solo permiten
// configurar "node <archivo>" sin añadir flags propios. Relanza el proceso
// real con --experimental-sqlite, que node:sqlite necesita.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const child = spawn(
  process.execPath,
  ['--experimental-sqlite', path.join(__dirname, 'index.js')],
  { stdio: 'inherit', env: process.env }
);

child.on('exit', (code) => process.exit(code ?? 0));
