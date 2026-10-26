/** Test-only swap for outbound provider HTTP (Google token + Calendar + People). */
type FetchFn = typeof fetch;

let impl: FetchFn = globalThis.fetch.bind(globalThis);

export function outboundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return impl(input, init);
}

export function installOutboundFetchForTests(fn: FetchFn): () => void {
  impl = fn;
  return () => {
    impl = globalThis.fetch.bind(globalThis);
  };
}
