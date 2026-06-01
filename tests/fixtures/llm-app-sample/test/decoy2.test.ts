import { describe, it, expect } from 'vitest';

// DECOY for the v1.0.0 kinds: math/collection look-alikes, an internal-looking
// `get`, and a `fetchData` identifier must NOT register as code-exec, sandbox,
// api-route, log-sink or external-fetch.
describe('math + collections', () => {
  it('exp/map/filter/fetchData/new Map are not AI surfaces', () => {
    const e = Math.exp(2);                  // not code-exec
    const m = new Map();                    // new Map != new Worker — not sandbox
    const xs = [1, 2].map((n) => n * 2).filter((n) => n > 1);
    const get = () => 5;                    // lowercase get — not an HTTP route
    const r = fetchData('https://x.example.com');  // fetchData != fetch
    expect(e + m.size + xs.length + get() + r).toBeDefined();
  });
});

function fetchData(u: string) { return u.length; }
