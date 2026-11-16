/**
 * Local stub for Biometric Service /attempts used to verify oidc-ui FLV wiring.
 * Usage: node scripts/flv-attempts-stub.js [APPROVED|LIVENESS_PASSED|REJECTED]
 */
const http = require('http');

const completeStatus = process.argv[2] || 'APPROVED';
const port = Number(process.env.PORT || 8099);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {};
    console.log(req.method, req.url, parsed);

    if (req.method === 'POST' && req.url === '/attempts') {
      if (!parsed.transactionId || !parsed.trn) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'INVALID_REQUEST' }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          attemptId: 'stub-attempt-id',
          sessionId: 'stub-session-id',
          credentials: {
            accessKeyId: 'ASIATEST',
            secretAccessKey: 'secret',
            sessionToken: 'token',
            expiration: new Date(Date.now() + 900000).toISOString(),
            region: 'eu-west-1',
          },
        })
      );
      return;
    }

    const completeMatch = req.url && req.url.match(/^\/attempts\/([^/]+)\/complete$/);
    if (req.method === 'POST' && completeMatch) {
      if (!parsed.transactionId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'ATTEMPT_NOT_FOUND' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          attemptId: completeMatch[1],
          status: completeStatus,
          failureCode: completeStatus === 'REJECTED' ? 'LOW_CONFIDENCE' : null,
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'NOT_FOUND' }));
  });
});

server.listen(port, () => {
  console.log(`FLV attempts stub on :${port} completeStatus=${completeStatus}`);
});
