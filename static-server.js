#!/usr/bin/env node
/**
 * Static preview server for the Supabase build.
 *
 * The main server.js exposes /api/state, so the client always picks local-server mode
 * when it is running. This tiny server serves public/ with no API at all, which is
 * exactly what Vercel does: the client then falls through to public/supabase-config.json
 * and uses Supabase Realtime. Useful to test the hosted behaviour on your own machine.
 *
 *   node static-server.js            # http://localhost:4322
 *   PORT=5050 node static-server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4322);
const HOST = process.env.HOST || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  var file = path.normalize(path.join(ROOT, pathname));
  if (file.indexOf(ROOT + path.sep) !== 0 && file !== path.join(ROOT, 'index.html')) {
    return send(res, 404, 'Not found');
  }
  fs.readFile(file, function (err, buf) {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': buf.length,
      'cache-control': 'no-cache'
    });
    if (req.method === 'HEAD') res.end(); else res.end(buf);
  });
});

server.listen(PORT, HOST, function () {
  var lan = null;
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (iface) {
      if (!lan && iface.family === 'IPv4' && !iface.internal) lan = iface.address;
    });
  });
  console.log('MAS WALL - static/Supabase preview (no API server)');
  console.log('  Local    http://localhost:' + PORT);
  if (lan) console.log('  Wi-Fi    http://' + lan + ':' + PORT);
  console.log('  Config   ' + path.join('public', 'supabase-config.json'));
});

process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });
process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
