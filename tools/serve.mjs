#!/usr/bin/env node
/**
 * Minimal static server for local testing.
 * file:// is not good enough: fetch() of data/ shards and history.pushState
 * both need a real origin.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '') file = path.join(ROOT, 'index.html');
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}`));
