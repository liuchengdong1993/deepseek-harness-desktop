'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const backend = require('../lib/backend');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, backend.HOST, resolve));
  return { server, port: server.address().port };
}

test('probe 只把 Harness HTML 识别为健康服务', async (t) => {
  const generic = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>其他本地服务</title>');
  });
  t.after(() => generic.server.close());
  assert.deepEqual(await backend.probe(generic.port), {
    reachable: true,
    harness: false,
    statusCode: 200,
  });
  assert.equal(await backend.healthCheck(generic.port), false);

  const harness = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>${backend.HARNESS_TITLE}<div id="root"></div>`);
  });
  t.after(() => harness.server.close());
  assert.equal((await backend.probe(harness.port)).harness, true);
  assert.equal(await backend.waitForHarness(harness.port, 100), true);
});

test('probe 对未监听端口返回不可达', async () => {
  const temporary = await listen((_request, response) => response.end());
  const port = temporary.port;
  await new Promise((resolve) => temporary.server.close(resolve));
  assert.deepEqual(await backend.probe(port, 100), {
    reachable: false,
    harness: false,
    statusCode: null,
  });
});
