#!/usr/bin/env node
/**
 * Zero-dependency local server & MyAnimeList autocomplete proxy (Node.js built-ins only).
 * Requires no npm install and no admin permissions.
 * Binds strictly to 127.0.0.1 to avoid Windows Firewall prompts on university PCs.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4173;
const CACHE_TTL_MS = 5 * 60 * 1000;
const malCache = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function fetchMalCharacters(query) {
  const key = query.trim().toLowerCase();
  const cached = malCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return Promise.resolve(cached.body);
  }

  return new Promise((resolve, reject) => {
    const targetUrl =
      'https://myanimelist.net/search/prefix.json?type=character&keyword=' +
      encodeURIComponent(query) +
      '&v=1';

    const req = https.get(
      targetUrl,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TournamentBracket/1.0)',
          Accept: 'application/json',
        },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`MAL HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (malCache.size > 200) malCache.clear();
          malCache.set(key, { time: Date.now(), body });
          resolve(body);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('MAL request timed out'));
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, buffer) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': buffer.length,
  });
  res.end(buffer);
}

function openBrowserUrl(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

  if (reqUrl.pathname === '/api/health') {
    sendJson(res, 200, Buffer.from(JSON.stringify({ ok: true, malProxy: true })));
    return;
  }

  if (reqUrl.pathname === '/api/mal/characters') {
    const query = (reqUrl.searchParams.get('q') || '').trim();
    if (!query) {
      sendJson(res, 200, Buffer.from('{"categories":[]}'));
      return;
    }
    try {
      const body = await fetchMalCharacters(query);
      sendJson(res, 200, body);
    } catch (err) {
      sendJson(res, 502, Buffer.from(JSON.stringify({ error: String(err.message || err) })));
    }
    return;
  }

  const relPath = reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname.replace(/^\/+/, '');
  const fullPath = path.resolve(ROOT_DIR, relPath);

  if (!fullPath.startsWith(ROOT_DIR + path.sep) && fullPath !== path.join(ROOT_DIR, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
    });
    res.end(content);
  });
});

const noOpen = process.argv.includes('--no-open');
let requestedPort = DEFAULT_PORT;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--port=')) {
    const parsed = Number(arg.split('=')[1]);
    if (Number.isInteger(parsed) && parsed >= 0) requestedPort = parsed;
  }
}

function listenWithFallback(ports) {
  const [port, ...rest] = ports;
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && rest.length > 0) {
      listenWithFallback(rest);
    } else {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}/`;
    console.log(`Tournament Bracket running at ${url}`);
    console.log('Press Ctrl+C to stop.');
    if (!noOpen) {
      setTimeout(() => openBrowserUrl(url), 300);
    }
  });
}

listenWithFallback([requestedPort, requestedPort + 1, requestedPort + 2, 0]);
