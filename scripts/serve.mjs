import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Local preview only; no proxy to production and no directory listing.
const files = { '/': ['index.html','text/html'], '/index.html':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/app.css':['app.css','text/css'], '/logo.png':['logo.png','image/png'] };
const root = resolve('dist/web');
const server = createServer(async (request,response) => {
  if (process.env.CONDUIT_TEST_SERVER === '1' && request.method === 'POST' && request.url === '/__test_shutdown') {
    response.writeHead(204); response.end(); server.close(); return;
  }
  const file = files[new URL(request.url,'http://localhost').pathname];
  if (!file) { response.writeHead(404); response.end(); return; }
  try { response.writeHead(200,{'Content-Type':file[1]}); response.end(await readFile(resolve(root,file[0]))); }
  catch { response.writeHead(500); response.end('Preview build not available'); }
});
server.listen(4173,'127.0.0.1',()=>console.log(`Local review preview: http://127.0.0.1:4173 (PID ${process.pid})`));
