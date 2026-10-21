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
test('only the local build reaches a model server on this machine', () => {
  assert.throws(() => providerFetch('http://127.0.0.1:11434/v1'));
  assert.throws(() => providerFetch('http://localhost:1234/v1'));
  const local = providerFetch('http://127.0.0.1:11434/v1', false, true);
  assert.throws(() => local('http://127.0.0.1:8765/api/v1/items'));
  assert.doesNotThrow(() => providerFetch('http://localhost:1234/v1', false, true));
  assert.throws(() => providerFetch('http://192.168.1.5:11434/v1', false, true));
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
  const models = modelCalls(async () => ({status:200}), 0.2);
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
  assert.equal(models.failure(), '模型服务超过 0.2 秒没有回应，已停止；请稍后重试或换一个模型');
  // Events every 40 ms (a fifth of the 200 ms limit, so a loaded runner has
  // room) keep it from firing over 320 ms in all.
  const talking = models.watch(signal => { seen = signal; return stream(Array(7).fill({type:'text_delta'}).concat({type:'done'}), 40); });
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

// The runner as the backend drives it: Pi's AgentSession against a local model server.
import {spawn} from 'node:child_process';
async function fakeModel(reply) {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    seen.push(payload);
    response.writeHead(200, {'content-type':'text/event-stream'});
    for (const delta of reply(payload, seen.length)) response.write(frame(delta));
    response.write(frame({}, reply.finish?.(payload, seen.length) || 'stop'));
    // Like a real service: how many tokens the request took (about one per three characters here).
    const prompt = Math.round(body.length / 3);
    response.write(`data: ${JSON.stringify({id:'x', object:'chat.completion.chunk', created:1, model:'m', choices:[], usage:{prompt_tokens:prompt, completion_tokens:50, total_tokens:prompt + 50}})}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {seen, base:`http://127.0.0.1:${server.address().port}/v1`, close:() => { server.closeAllConnections(); server.close(); }};
}
function runRunner(payload, onTool = () => ({result:{ok:true}})) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('./runner.mjs', import.meta.url).pathname], {env:{...process.env, NODE_ENV:'test'}});
    const out = [];
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        out.push(event);
        if (event.type === 'tool') child.stdin.write(JSON.stringify({id:event.id, ...onTool(event)}) + '\n');
        // The backend reserves each model request against the budget.
        if (event.type === 'model_request') { if (payload.deny) child.kill(); else child.stdin.write(JSON.stringify({id:event.id}) + '\n'); }
      }
    });
    let err = '';
    child.stderr.on('data', c => { err += c; });
    child.on('exit', code => code === 0 ? resolve(out) : reject(Error(`exit ${code}: ${err}\n${JSON.stringify(out)}`)));
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}
const config = base => ({base_url:base, api_key:'k', model:'m', protocol:'openai'});

test('a conversation continues from the entries the backend kept', async () => {
  const model = await fakeModel((payload, n) => [{content:`第 ${n} 次回答`}]);
  try {
    const first = await runRunner({config:config(model.base), prompt:'你好', tools:[]});
    const entries = first.filter(e => e.type === 'entry').map(e => e.entry);
    assert.ok(entries.some(e => e.type === 'message' && e.message.role === 'user'));
    assert.equal(first.find(e => e.type === 'answer').text, '第 1 次回答');
    const done = first.find(e => e.type === 'done');
    assert.ok(done.session_id);
    assert.ok(first.find(e => e.type === 'context'));
    const second = await runRunner({config:config(model.base), session:{id:done.session_id, entries}, prompt:'再说一次', tools:[]});
    assert.equal(second.find(e => e.type === 'answer').text, '第 2 次回答');
    // The second request carried the first exchange.
    const said = model.seen[1].messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    assert.match(said, /你好/);
    assert.match(said, /第 1 次回答/);
  } finally { model.close(); }
});

test('our tools run in the parent process and their results reach the model', async () => {
  const reply = (payload, n) => n === 1
    ? [{tool_calls:[{index:0, id:'call_1', type:'function', function:{name:'lookup', arguments:'{"q":"x"}'}}]}]
    : [{content:'查到了'}];
  reply.finish = (payload, n) => n === 1 ? 'tool_calls' : 'stop';
  const model = await fakeModel(reply);
  try {
    const out = await runRunner({config:config(model.base), prompt:'查一下', tools:[{name:'lookup', description:'d', parameters:{type:'object', properties:{q:{type:'string'}}}}]},
      event => ({result:{found:event.args.q}}));
    assert.deepEqual(out.find(e => e.type === 'tool').args, {q:'x'});
    assert.equal(out.filter(e => e.type === 'answer').at(-1).text, '查到了');
    assert.match(JSON.stringify(model.seen[1].messages), /found/);
  } finally { model.close(); }
});

test('a long conversation is compacted by Pi, on its own and when asked', async () => {
  const model = await fakeModel((payload, n) => [{content:`回答 ${n}：` + '很长的内容。'.repeat(200)}]);
  try {
    const small = {...config(model.base), context_window:3000};
    const limits = {output_tokens:500, compaction:{reserveTokens:600, keepRecentTokens:300}};
    let entries = [], id;
    let compacted = [];
    for (let i = 0; i < 6; i++) {
      const out = await runRunner({config:small, limits, session:{id, entries}, prompt:`第 ${i} 个问题 ` + '背景。'.repeat(150), tools:[]});
      entries = entries.concat(out.filter(e => e.type === 'entry').map(e => e.entry));
      id = out.find(e => e.type === 'done').session_id;
      compacted = compacted.concat(out.filter(e => e.type === 'compaction'));
    }
    assert.ok(compacted.some(e => e.phase === 'end' && !e.aborted), JSON.stringify(compacted));
    assert.ok(entries.some(e => e.type === 'compaction'));
    // Asked for: /compact with instructions.
    const asked = await runRunner({config:small, limits, session:{id, entries}, command:'compact', instructions:'只留结论', tools:[]});
    const end = asked.find(e => e.type === 'compaction' && e.phase === 'end');
    assert.equal(end.reason, 'manual');
    // The summary call asked the backend first and reported its usage after.
    const kinds = asked.map(e => e.type);
    assert.ok(kinds.indexOf('model_request') < kinds.indexOf('usage'), kinds.join(','));
    assert.ok(asked.find(e => e.type === 'usage').usage);
    assert.ok(asked.some(e => e.type === 'entry' && e.entry.type === 'compaction'));
  } finally { model.close(); }
});

test('changing the model is written into the conversation', async () => {
  const model = await fakeModel(() => [{content:'好'}]);
  try {
    const first = await runRunner({config:config(model.base), prompt:'一', tools:[]});
    const entries = first.filter(e => e.type === 'entry').map(e => e.entry);
    const id = first.find(e => e.type === 'done').session_id;
    const second = await runRunner({config:{...config(model.base), model:'m2'}, session:{id, entries}, prompt:'二', tools:[]});
    const change = second.find(e => e.type === 'entry' && e.entry.type === 'model_change');
    assert.equal(change.entry.modelId, 'm2');
    assert.equal(model.seen[1].model, 'm2');
    // The same model again adds no change.
    const all = entries.concat(second.filter(e => e.type === 'entry').map(e => e.entry));
    const third = await runRunner({config:{...config(model.base), model:'m2'}, session:{id, entries:all}, prompt:'三', tools:[]});
    assert.ok(!third.some(e => e.type === 'entry' && e.entry.type === 'model_change'));
  } finally { model.close(); }
});

test('a conversation from before starts from the history the backend rebuilt', async () => {
  const model = await fakeModel(() => [{content:'接着说'}]);
  try {
    const history = [{role:'user', content:'以前的问题', timestamp:0}];
    const out = await runRunner({config:config(model.base), history, prompt:'现在的问题', tools:[]});
    assert.match(JSON.stringify(model.seen[0].messages), /以前的问题/);
    const kept = out.filter(e => e.type === 'entry').map(e => e.entry);
    assert.ok(kept.some(e => e.type === 'message' && JSON.stringify(e.message.content).includes('以前的问题')));
  } finally { model.close(); }
});

test('a model request the backend refuses is never sent', async () => {
  const model = await fakeModel(() => [{content:'不该出现'}]);
  try {
    // The backend, finding the budget spent, stops the runner rather than answer.
    await assert.rejects(runRunner({config:config(model.base), prompt:'你好', tools:[], deny:true}));
    assert.equal(model.seen.length, 0);
  } finally { model.close(); }
});
