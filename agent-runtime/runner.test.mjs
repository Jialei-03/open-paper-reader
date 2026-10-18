import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress, providerFetch} from './network.mjs';
test('block private, metadata, loopback and mapped local destinations', () => {
  for(const ip of ['127.0.0.1','10.0.0.1','172.18.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','0.0.0.0']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('1.1.1.1'),true);
  assert.throws(() => providerFetch('http://example.com'));
  const f=providerFetch('https://api.minimax.cn/v1');
  assert.throws(() => f('https://127.0.0.1/secrets'));
  assert.throws(() => f('https://example.com/secrets'));
});

import {leasedStream} from './model-lease.mjs';
test('model lease covers streaming and releases before subsequent tools', async () => {
  const events = [];
  const stream = await leasedStream(
    async () => events.push('acquire'), async () => events.push('release'),
    () => ({result: async () => 'result', async *[Symbol.asyncIterator]() {
      events.push('provider'); yield {type:'done'};
    }}),
  );
  for await (const event of stream) { assert.equal(event.type,'done'); break; }
  events.push('tool');
  assert.deepEqual(events,['acquire','provider','release','tool']);
  assert.equal(await stream.result(),'result');
});
test('lease released on provider setup and stream failures', async () => {
  for (const setup of [true,false]) {
    let released=0;
    await assert.rejects(async () => {
      const stream=await leasedStream(async()=>{},async()=>{released++;},()=>{
        if(setup) throw Error('setup');
        return {async *[Symbol.asyncIterator](){throw Error('stream');}};
      });
      for await(const event of stream) void event;
    });
    assert.equal(released,1);
  }
});

import {explain, plain, modelCalls, statusMessage, CONNECTION, INTERRUPTED, MALFORMED, FAILED} from './model-call.mjs';
test('a failed model call is explained in the backend\'s words, keeping HTTP status', () => {
  assert.equal(explain({status:500, error:'500: {"message":"boom"}'}), '模型服务返回 HTTP 500：服务暂时出错，请稍后重试');
  assert.equal(explain({status:429}), statusMessage(429));
  for (const status of [400,401,403,404,408,429,502]) assert.match(statusMessage(status), new RegExp(`HTTP ${status}：`));
  assert.equal(explain({}), CONNECTION);
  assert.equal(explain({status:200, error:'terminated'}), INTERRUPTED);
  assert.equal(explain({status:200, error:'Stream ended without finish_reason'}), INTERRUPTED);
  assert.equal(explain({status:200, error:"Expected property name or '}' in JSON at position 1"}), MALFORMED);
  assert.equal(explain({silent:300}), '模型服务超过 300 秒没有回应，已停止；请稍后重试或换一个模型');
  // Our own reasons pass; SDK internals do not.
  assert.equal(plain('会话上下文达到本轮限制，请新建会话'), '会话上下文达到本轮限制，请新建会话');
  assert.equal(plain('TypeError: fetch failed\n    at node:internal'), FAILED);
});

const stream = (events, gap = 0) => ({
  result: async () => 'result',
  async *[Symbol.asyncIterator]() { for (const e of events) { await new Promise(r => setTimeout(r, gap)); yield e; } },
});
test('a model call records the provider status and explains its failure', async () => {
  const models = modelCalls(async () => ({status:500}), 5);
  const call = models.watch(() => {
    const events = stream([{type:'error', error:{errorMessage:'500: {}'}}]);
    return {...events, async *[Symbol.asyncIterator]() { await models.fetch('https://x'); yield* events; }};
  });
  for await (const e of call) void e;
  assert.equal(models.failure(), statusMessage(500));
  assert.equal(await call.result(), 'result');
  // The next call starts clean.
  for await (const e of models.watch(() => stream([{type:'done'}]))) void e;
  assert.equal(models.failure(), undefined);
});
test('a silent model is aborted after the limit; a talking one is not', async () => {
  const models = modelCalls(async () => ({status:200}), 0.1);
  let seen;
  const silent = models.watch(signal => {
    seen = signal;
    return {result: async () => 'r', async *[Symbol.asyncIterator]() {
      await new Promise(resolve => signal.addEventListener('abort', resolve));
      yield {type:'error', error:{errorMessage:'Request aborted'}};
    }};
  });
  for await (const e of silent) void e;
  assert.equal(seen.aborted, true);
  assert.equal(models.failure(), '模型服务超过 0.1 秒没有回应，已停止；请稍后重试或换一个模型');
  // Events every 50 ms keep a 100 ms limit from firing over 300 ms in all.
  const talking = models.watch(signal => { seen = signal; return stream(Array(6).fill({type:'text_delta'}).concat({type:'done'}), 50); });
  for await (const e of talking) void e;
  assert.equal(seen.aborted, false);
  assert.equal(models.failure(), undefined);
  // The agent's own stop still reaches the provider.
  const stop = new AbortController();
  const stopped = models.watch(signal => { seen = signal; return stream([]); }, stop.signal);
  stop.abort();
  assert.equal(seen.aborted, true);
  for await (const e of stopped) void e;
});

// The real Pi provider stream against a local server, as the runner uses it.
import http from 'node:http';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-completions';
import {silenceMessage} from './model-call.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = (delta, finish = null) => `data: ${JSON.stringify({id:'x', object:'chat.completion.chunk', created:1, model:'m', choices:[{index:0, delta, finish_reason:finish}]})}\n\n`;
async function answer(handler, seconds) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const models = modelCalls(providerFetch(base, true), seconds);
  const model = {id:'m', name:'m', api:'openai-completions', provider:'workspace', baseUrl:base, reasoning:false, input:['text'],
    contextWindow:128000, maxTokens:1000, cost:{input:0, output:0, cacheRead:0, cacheWrite:0},
    compat:{supportsDeveloperRole:false, maxTokensField:'max_tokens', supportsStore:false}};
  try {
    const call = models.watch(signal => streamSimple(model, {systemPrompt:'s', messages:[{role:'user', content:'hi', timestamp:0}]},
      {apiKey:'k', maxRetries:0, signal, fetch:models.fetch}));
    for await (const e of call) void e;
    return {message: await call.result(), failure: models.failure()};
  } finally { server.closeAllConnections(); server.close(); }
}
test('a model that only streams reasoning_details is not taken for silent', async () => {
  // MiniMax with reasoning_split sends its thinking this way, and Pi emits no
  // event for it: 1.2 s of reasoning bytes, 100 ms apart, under a 0.5 s limit.
  const {message, failure} = await answer(async (request, response) => {
    request.resume();
    response.writeHead(200, {'content-type':'text/event-stream'});
    for (let i = 0; i < 12; i++) {
      response.write(frame({reasoning_details:[{type:'reasoning.text', text:`第 ${i} 步。`}]}));
      await sleep(100);
    }
    response.write(frame({content:'答案'}));
    response.write(frame({}, 'stop'));
    response.end('data: [DONE]\n\n');
  }, 0.5);
  assert.equal(failure, undefined);
  assert.equal(message.stopReason, 'stop');
  assert.equal(message.content.find(c => c.type === 'text').text, '答案');
});
test('a model that falls silent, before or during its answer, still times out', async () => {
  for (const started of [false, true]) {
    const begun = Date.now();
    const {message, failure} = await answer((request, response) => {
      request.resume();
      if (!started) return;  // not even the headers
      response.writeHead(200, {'content-type':'text/event-stream'});
      response.write(frame({content:'一半'}));
    }, 0.3);
    assert.equal(message.stopReason, 'aborted', String(started));
    assert.equal(failure, silenceMessage(0.3));
    assert.ok(Date.now() - begun < 2000);
    if (started) assert.equal(message.content.find(c => c.type === 'text').text, '一半');
  }
});
