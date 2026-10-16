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
