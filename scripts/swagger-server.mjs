import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code !== 'ENOENT') throw error;
}

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(process.env.SWAGGER_PORT ?? 3005);
const apiPort = Number(process.env.PORT ?? 3000);
const apiHost = process.env.API_HOST ?? 'localhost';
const apiUrl = process.env.API_URL ?? `http://${apiHost}:${apiPort}`;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relativePath = requestPath === '/' ? 'swagger-ui.html' : requestPath.replace(/^\/+/, '');
    const filePath = normalize(join(root, relativePath));

    if (!filePath.startsWith(root)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let content = await readFile(filePath, 'utf8');

    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      content = content.replaceAll('http://localhost:3000', apiUrl);
    }

    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Swagger UI listening on http://localhost:${port}/`);
  console.log(`Swagger API target: ${apiUrl}`);
  console.log(`OpenAPI specification: http://localhost:${port}/openapi.yaml`);
});
