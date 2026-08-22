import { createServer } from 'node:http';
import { createGatewayHttpHandler } from './http.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.GATEWAY_API_KEY;

if (!apiKey) {
  throw new Error('GATEWAY_API_KEY is required to start the HTTP server');
}

const handler = createGatewayHttpHandler({
  accounts: [],
  adapters: [],
  apiKey,
});

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const result = await handler({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      body,
      headers: {
        authorization: req.headers.authorization,
        'x-request-id': req.headers['x-request-id'] as string | undefined,
      },
    });
    res.statusCode = result.status;
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    res.end(JSON.stringify(result.body));
  } catch {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'InvalidRequest' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`LLM gateway listening on ${port}`);
});
