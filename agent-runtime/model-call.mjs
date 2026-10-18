// One model response at a time: how long the model may stay silent, and what a
// reader is told when the call fails, in the same words as backend/model_errors.py.

export const CONNECTION = '连不上模型服务，请检查地址和网络后重试';
export const INTERRUPTED = '模型的回答中途断开了，请重试';
export const MALFORMED = '模型服务返回的内容无法识别，请确认地址和接口协议设置正确后重试';
export const STREAM_FAILED = '模型流式响应失败，请重试';
export const FAILED = '模型响应失败，请检查所选模型的连接与工具调用支持';

export function statusMessage(status) {
  const head = `模型服务返回 HTTP ${status}`;
  if (status === 429) return `${head}：请求太频繁或额度用完了，请稍后重试`;
  if (status === 401 || status === 403) return `${head}：API 密钥无效或没有权限，请在设置里检查密钥`;
  if (status === 404) return `${head}：找不到这个模型或地址，请在设置里检查模型名称和地址`;
  if (status === 408) return `${head}：请求超时，请稍后重试`;
  if (status >= 500) return `${head}：服务暂时出错，请稍后重试`;
  return `${head}：请求被拒绝，请检查模型配置后重试`;
}

export const silenceMessage = seconds =>
  `模型服务超过 ${seconds} 秒没有回应，已停止；请稍后重试或换一个模型`;

// `status` is what the provider answered (undefined: it never did), `silent`
// how long we waited before giving up, `error` the SDK's own description.
export function explain({status, silent, error = ''}) {
  if (silent) return silenceMessage(silent);
  if (status === undefined) return CONNECTION;
  if (status < 200 || status >= 300) return statusMessage(status);
  if (/JSON/i.test(error)) return MALFORMED;
  if (/terminated|ended without|closed|reset|socket|ECONN/i.test(error)) return INTERRUPTED;
  return STREAM_FAILED;
}

// A failure that did not come from the provider: our own messages are already
// written for the reader; anything else (an SDK or runtime internal) is not.
export const plain = error => /[㐀-鿿]/.test(error || '') ? error : FAILED;

// `fetch` goes to the provider and remembers the status of the current call;
// `watch` runs one call, aborting it once `seconds` pass with neither a byte of
// the response nor a stream event: the backend's read timeout also counts bytes.
export function modelCalls(send, seconds) {
  let current = null;
  const fetch = async (input, options) => {
    const call = current;
    const response = await send(input, options);
    if (!call) return response;
    call.status = response.status;
    call.arm();
    if (!response.body) return response;
    // Pi emits no event for some of what a model streams (MiniMax sends its
    // reasoning as reasoning_details), so the bytes themselves are the sign of life.
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, stream) { call.arm(); stream.enqueue(chunk); },
    }));
    const live = new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers});
    Object.defineProperty(live, 'url', {value:response.url});
    return live;
  };
  function watch(start, signal) {
    const call = current = {};
    const controller = new AbortController();
    let timer;
    call.arm = () => {
      clearTimeout(timer);
      if (call.settled) return;
      timer = setTimeout(() => { call.silent = seconds; controller.abort(); }, seconds * 1000);
    };
    const settle = () => { call.settled = true; clearTimeout(timer); };
    call.arm();
    let source;
    try { source = start(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); }
    catch (error) { settle(); throw error; }
    return {
      result: () => source.result(),
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of source) {
            call.arm();
            if (event.type === 'error') call.failure = explain({...call, error: event.error?.errorMessage});
            yield event;
          }
        } finally { settle(); }
      },
    };
  }
  // Why the latest call failed; undefined if it did not, or no call was made.
  return {fetch, watch, failure: () => current?.failure};
}
