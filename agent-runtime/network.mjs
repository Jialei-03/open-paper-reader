import { Agent as Dispatcher, fetch } from 'undici';
import { lookup } from 'node:dns';
import ipaddr from 'ipaddr.js';
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function providerFetch(baseUrl, testing = false) {
  const base = new URL(baseUrl);
  const localTest = testing && base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !localTest) throw Error('HTTPS required');
  const dispatcher = new Dispatcher({connect: {lookup(host, options, callback) {
    lookup(host, {all:true}, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) return callback(Error('Private network blocked'));
      callback(null, ...(options.all ? [addresses] : [addresses[0].address, addresses[0].family]));
    });
  }}});
  return (input, options={}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== base.origin || (ipaddr.isValid(url.hostname) && !publicAddress(url.hostname) && !localTest)) throw Error('Provider destination blocked');
    return fetch(input, {...options, redirect:'error', dispatcher:localTest ? undefined : dispatcher});
  };
}
