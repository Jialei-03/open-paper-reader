// Hold the shared provider slot only while a model response is streaming.
export async function leasedStream(acquire, release, start) {
  await acquire();
  let released = false;
  const finish = async () => {
    if (!released) { released = true; await release(); }
  };
  try {
    const source = start();
    return {
      result: () => source.result(),
      async *[Symbol.asyncIterator]() {
        try { for await (const event of source) yield event; }
        finally { await finish(); }
      },
    };
  } catch (error) { await finish(); throw error; }
}
