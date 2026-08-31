/**
 * k6 load test — Flash Sale System (single file, per Final_Assignment.MD §3)
 *
 *   k6 run -e BASE_URL=http://localhost loadtest/flash-sale.js
 *   docker run --rm --network flash-sale-system_default \
 *     -v "$PWD/loadtest:/loadtest" grafana/k6 run -e BASE_URL=http://nginx /loadtest/flash-sale.js
 *
 * Run `node loadtest/reset.js` first (fresh stock + clean cache/metrics counters).
 *
 * Queue order:
 *   1. setup()   — fetch 500 unique JWTs (user-1..user-500). NOT timed; just
 *                  has to finish for everyone. Aborts the run if any != 200.
 *   2. read_load — timed, kept as short as still gives a stable p95; goal is
 *                  minimum duration + minimum failures. 1,000 concurrent VUs,
 *                  GET /api/v1/products with page + limit rotated per request
 *                  (limit in {5,10,20}); each response must echo the scope it
 *                  was asked for and return exactly the rows in that window.
 *   3. write_load— timed the same way. 500 concurrent, POST /api/v1/orders for
 *                  p-1001 (stock 50); every Nth VU double/triple-fires
 *                  concurrently to exercise the duplicate-rights guard.
 *
 * Both phases feed the report: teardown() pulls GET /api/v1/_metrics for the
 * cache check (L1/L2/miss hit ratio) and the queue check (waiting/active/
 * completed/failed + lifetime orders_completed / orders_failed counters).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================ Tunables (env-overridable) ====================
const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const USER_COUNT = Number(__ENV.USER_COUNT || 500); // unique users / JWTs
const PRODUCT_ID = __ENV.PRODUCT_ID || 'p-1001'; // write contention target
const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '10s'; // per-request HTTP timeout
const TOTAL_PRODUCTS = Number(__ENV.TOTAL_PRODUCTS || 20); // catalogue size (spec §2.2 example: total 20)
const READ_LIMITS = String(__ENV.READ_LIMITS || '5,10,20') // limit values the read phase rotates through
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => n > 0);

// -- read phase: 1,000 concurrent readers browsing/refreshing catalog
const READ_TARGET = Number(__ENV.READ_TARGET || 1000);
const READ_RAMP = __ENV.READ_RAMP || '8s';
const READ_HOLD = __ENV.READ_HOLD || '22s';
const READ_DOWN = __ENV.READ_DOWN || '5s';

// -- write phase: 500 concurrent buyers bursting at flash sale start (overlaps with read)
const WRITE_TARGET = Number(__ENV.WRITE_TARGET || 500);
const WRITE_START = __ENV.WRITE_START || '10s'; // Starts while read phase is at peak
const WRITE_MAXDUR = __ENV.WRITE_MAXDUR || '30s';

// ============================ Custom metrics ================================
const infraFail = new Rate('infra_failures'); // 5xx / timeout / unexpected 4xx (NOT 409/429)
const ordersAccepted = new Counter('orders_accepted'); // HTTP 202
const ordersSoldout = new Counter('orders_soldout'); // HTTP 409 "Product sold out"
const ordersDuplicate = new Counter('orders_duplicate'); // HTTP 409 already-claimed or duplicate
const ordersThrottled = new Counter('orders_throttled'); // HTTP 429 in-flight lock
const readCacheHitPct = new Trend('read_cache_hit_pct'); // sampled during read phase
const writeQueueBacklog = new Trend('write_queue_backlog'); // waiting+active, sampled during write
const dataIntegrityOk = new Rate('data_integrity_ok'); // post-burst remainingStock == 0

const REQ = { timeout: REQ_TIMEOUT };
const JSON_HDR = { 'Content-Type': 'application/json' };

// A response is an infra failure only if it is neither read success (200)
// nor an expected business order outcome (202, 409, 429).
function isInfraFailure(res) {
    if (res.status === 0) return true; // timeout / connection error
    if (res.status === 200 || res.status === 202 || res.status === 409 || res.status === 429) return false;
    return true;
}

// ============================ Options =====================================
export const options = {
    scenarios: {
        read_load: {
            executor: 'ramping-vus',
            startVUs: 100,
            stages: [
                { duration: READ_RAMP, target: READ_TARGET }, // 1. Users ramp up to browse products
                { duration: READ_HOLD, target: READ_TARGET }, // 2. Heavy refresh traffic during flash sale (Overlapping with write)
                { duration: READ_DOWN, target: 0 },           // 3. Traffic cools down
            ],
            exec: 'readScenario',
            gracefulRampDown: '5s',
        },
        write_load: {
            executor: 'per-vu-iterations',
            vus: WRITE_TARGET,
            iterations: 1,
            maxDuration: WRITE_MAXDUR,
            startTime: WRITE_START, // Overlaps with read_load while it is at 1,000 VUs peak
            exec: 'writeScenario',
            gracefulStop: '10s',
        },
    },
    thresholds: {
        'http_req_duration{scenario:read_load}': ['p(95)<500'],
        'http_req_duration{scenario:write_load}': ['p(95)<800'],
        infra_failures: ['rate<0.01'],
        'checks{scenario:read_load}': ['rate>0.99'],
        'checks{scenario:write_load}': ['rate>0.99'],
        data_integrity_ok: ['rate>0.99'], // remainingStock must be 0 after the drain
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ============================ 1. setup: 500 JWTs ==========================
export function setup() {
    const requests = [];
    for (let i = 1; i <= USER_COUNT; i++) {
        requests.push(['POST', `${BASE_URL}/api/v1/auth/token`, JSON.stringify({ userId: `user-${i}` }), { headers: JSON_HDR, timeout: REQ_TIMEOUT }]);
    }
    const responses = http.batch(requests);

    const tokens = responses.map((res, idx) => {
        const userId = `user-${idx + 1}`;
        if (res.status !== 200) {
            throw new Error(`setup: auth/token for ${userId} returned ${res.status} (spec §2.1 requires 200) — body: ${res.body}`);
        }
        const token = res.json('accessToken');
        if (!token) throw new Error(`setup: auth/token for ${userId} returned 200 but no accessToken`);
        return token;
    });

    console.log(`setup: issued ${tokens.length} JWTs (user-1..user-${tokens.length})`);
    return { tokens };
}

// ============================ 2. read phase ===============================
export function readScenario() {
    // Realistic Zipf / Pareto (80/20) browsing behavior:
    // 80% of users refresh Page 1 (where hot flash sale items are),
    // 20% browse deeper pages.
    const limit = READ_LIMITS[Math.floor(Math.random() * READ_LIMITS.length)];
    const maxPage = Math.max(1, Math.ceil(TOTAL_PRODUCTS / limit));
    const isFrontPage = Math.random() < 0.8;
    const page = isFrontPage ? 1 : (1 + Math.floor(Math.random() * maxPage));
    const expectedRows = Math.min(limit, Math.max(0, TOTAL_PRODUCTS - (page - 1) * limit));

    const res = http.get(`${BASE_URL}/api/v1/products?page=${page}&limit=${limit}`, {...REQ, tags: { name: 'products' } });

    check(res, {
        'read: status 200': (r) => r.status === 200,
        // response must echo the exact scope it was asked for
        'read: meta echoes scope': (r) => {
            try {
                const j = r.json();
                return !!j && !!j.meta && j.meta.page === page && j.meta.limit === limit;
            } catch (e) {
                return false;
            }
        },
        'read: rows match page window': (r) => {
            try {
                const j = r.json();
                return Array.isArray(j.data) && j.data.length <= limit && j.data.length === expectedRows;
            } catch (e) {
                return false;
            }
        },
    });
    infraFail.add(isInfraFailure(res));

    // cache check: sample cache hit ratio during peak traffic
    if (__VU === 1 && __ITER % 25 === 0) sampleCache('read');

    // Natural human think time / pull-to-refresh pacing (200ms - 500ms jitter)
    sleep(0.2 + Math.random() * 0.3);
}

// ============================ 3. write phase ==============================
export function writeScenario(data) {
    const token = data.tokens[(__VU - 1) % data.tokens.length];
    const params = {...REQ, headers: {...JSON_HDR, Authorization: `Bearer ${token}` }, tags: { name: 'orders' } };
    const body = JSON.stringify({ productId: PRODUCT_ID });

    // Realistic buyer behavior: Users excitedly tap the "Buy Now" button 2 to 3 times in rapid succession.
    // 50% fire dual concurrent burst requests, while 50% tap rapidly with 50-120ms human finger jitter.
    const isConcurrentBurst = Math.random() < 0.5;

    if (isConcurrentBurst) {
        // Concurrent burst (batch): tests exact same millisecond race condition on Redis lock
        const burstCount = 2 + Math.floor(Math.random() * 2);
        const burst = Array.from({ length: burstCount }, () => ({ method: 'POST', url: `${BASE_URL}/api/v1/orders`, body, params }));
        http.batch(burst).forEach(tallyOrder);
    } else {
        // Rapid sequential taps with human jitter
        const tapCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < tapCount; i++) {
            tallyOrder(http.post(`${BASE_URL}/api/v1/orders`, body, params));
            sleep(0.05 + Math.random() * 0.07); // 50ms - 120ms
        }
    }
}

function tallyOrder(res) {
    const ok = check(res, { 'write: status in {202, 409, 429}': (r) => r.status === 202 || r.status === 409 || r.status === 429 });
    infraFail.add(isInfraFailure(res));
    if (!ok) return;

    if (res.status === 202) {
        ordersAccepted.add(1);
        return;
    }
    if (res.status === 429) {
        ordersThrottled.add(1);
        return;
    }
    let msg = '';
    try {
        msg = res.json('message') || '';
    } catch (e) {
        /* keep '' */
    }
    if (msg.includes('sold out')) ordersSoldout.add(1);
    else ordersDuplicate.add(1);
}

// ============================ samplers ====================================
function sampleCache(phase) {
    const m = fetchMetrics();
    const mm = m && m.metrics;
    if (!mm) return; // other groups may expose no /_metrics, or a different shape
    const hit = mm.cache_hit || 0; // origin (Redis page cache) hit
    const miss = mm.cache_miss || 0; // Postgres rebuild
    const total = hit + miss;
    if (!total) return;
    const hitPct = (hit / total) * 100;
    readCacheHitPct.add(hitPct);
    console.log(`[${phase}] cache hit ${hitPct.toFixed(2)}%  (hit ${hit} / miss ${miss})`);
}

function fetchMetrics() {
    let res;
    try {
        res = http.get(`${BASE_URL}/api/v1/_metrics`, REQ);
    } catch (e) {
        return null;
    }
    if (!res || res.status !== 200) return null;
    try {
        const j = res.json();
        return j && typeof j === 'object' ? j : null;
    } catch (e) {
        return null;
    }
}

// ============================ teardown: cache + queue snapshot =============
export function teardown() {
    // Poll until the queue is fully drained (or give up) so the Data Integrity
    // check afterwards sees the final state, and record the peak backlog seen.
    let m = null;
    let peakBacklog = 0;
    for (let i = 0; i < 30; i++) {
        m = fetchMetrics();
        const q = (m && m.queue) || {};
        const backlog = (q.waiting || 0) + (q.active || 0);
        if (backlog > peakBacklog) peakBacklog = backlog;
        if (m && backlog === 0 && i >= 2) break; // 2 clean-ish reads minimum
        sleep(1);
    }
    writeQueueBacklog.add(peakBacklog);

    // Data Integrity Proof (spec §3.4): once the queue is drained, the read API
    // must report remainingStock === 0 for the contended product — proves the
    // Redis cache was invalidated correctly and never served a stale count.
    let integrityLine = '  remainingStock after drain : (not checked)'; {
        const res = http.get(`${BASE_URL}/api/v1/products?page=1&limit=10`, REQ);
        let rs = null;
        try {
            const j = res.json();
            const row = (j.data || []).find((p) => p.productId === PRODUCT_ID);
            rs = row ? row.remainingStock : null;
        } catch (e) {
            /* rs stays null */
        }
        const ok = rs === 0 || rs === '0';
        dataIntegrityOk.add(ok);
        check(null, { 'integrity: remainingStock == 0 after drain': () => ok });
        integrityLine = `  remainingStock after drain : ${rs}  (${ok ? 'OK' : 'STALE / WRONG'})`;
    }

    if (!m) {
        console.log('teardown: could not read /api/v1/_metrics');
        console.log(integrityLine);
        return;
    }
    const c = m.metrics || {};
    const q = m.queue || {};
    const hit = c.cache_hit || 0;
    const miss = c.cache_miss || 0;
    const dbBuild = c.db_build || 0; // misses that actually reached Postgres (rest were coalesced)
    const waitHit = c.cache_wait_hit || 0; // misses parked on the L2 lock, served once the builder published
    const waitTimeout = c.cache_wait_timeout || 0; // waited out WAIT_MAX_MS, built uncached
    const tot = hit + miss || 1;
    const pct = (n) => ((n / tot) * 100).toFixed(2);
    const coalesced = miss > 0 ? (((miss - dbBuild) / miss) * 100).toFixed(2) : '0.00';

    const lines = [
        '',
        '================  CACHE CHECK (GET /api/v1/_metrics)  ================',
        `  Redis hit             : ${hit}  (${pct(hit)}%)`,
        `  miss (cold key)       : ${miss}  (${pct(miss)}%)`,
        `  HIT / MISS ratio      : ${pct(hit)}%  /  ${pct(miss)}%`,
        `  Postgres builds       : ${dbBuild}   (${coalesced}% of misses coalesced by L1+L2 single-flight)`,
        `  parked on L2 lock     : ${waitHit}  served after builder published`,
        `  L2 wait timeouts      : ${waitTimeout}  (built uncached to stay responsive)`,
        '',
        '================  QUEUE CHECK  ======================================',
        `  waiting=${q.waiting ?? '?'}  active=${q.active ?? '?'}  delayed=${q.delayed ?? '?'}`,
        `  completed (lifetime) : ${c.orders_completed || 0}`,
        `  failed    (lifetime) : ${c.orders_failed || 0}`,
        `  Bull-Board window     : completed=${q.completed ?? '?'} failed=${q.failed ?? '?'}`,
        '',
        '================  ORDER OUTCOMES  ===================================',
        `  accepted (202)  : ${c.orders_accepted || 0}`,
        `  sold out (409)  : ${c.orders_soldout || 0}`,
        `  duplicate (409) : ${c.orders_duplicate || 0}`,
        '',
        '================  DATA INTEGRITY  ===================================',
        integrityLine,
        '====================================================================',
        '',
    ];
    console.log(lines.join('\n'));
}

// ============================ summary =====================================
export function handleSummary(data) {
    const M = data.metrics;
    const g = (name, path, dflt = 0) => {
        const metric = M[name];
        if (!metric) return dflt;
        const v = metric.values || {};
        return v[path] !== undefined ? v[path] : dflt;
    };
    const f2 = (n) => Number(n).toFixed(2);

    const rd = 'http_req_duration{scenario:read_load}';
    const wd = 'http_req_duration{scenario:write_load}';

    // handleSummary replaces k6's default end-of-test output, so surface the
    // threshold gate results explicitly.
    const thresholdLines = [];
    for (const [name, metric] of Object.entries(M)) {
        if (!metric.thresholds) continue;
        for (const [expr, r] of Object.entries(metric.thresholds)) {
            thresholdLines.push(`    ${r.ok ? 'PASS' : 'FAIL'}  ${name}  ${expr}`);
        }
    }

    const banner = [
        '',
        '#################  FLASH SALE LOAD TEST — SUMMARY  #################',
        '',
        '  THRESHOLDS',
        ...(thresholdLines.length ? thresholdLines : ['    (none)']),
        '',
        '  READ PHASE',
        `    requests ......... ${g('http_reqs', 'count')}   (${f2(g('http_reqs', 'rate'))}/s overall)`,
        `    p95 latency ...... ${f2(g(rd, 'p(95)'))} ms   (p99 ${f2(g(rd, 'p(99)'))} ms, max ${f2(g(rd, 'max'))} ms)`,
        `    checks .......... ${f2(g('checks{scenario:read_load}', 'rate') * 100)}% pass`,
        `    cache hit ........ ${f2(g('read_cache_hit_pct', 'avg'))}% avg (Redis cache-aside, sampled)`,
        '',
        '  WRITE PHASE',
        `    orders accepted .. ${g('orders_accepted', 'count')}   (expect 50)`,
        `    409 sold out ..... ${g('orders_soldout', 'count')}`,
        `    409 duplicate .... ${g('orders_duplicate', 'count')}`,
        `    429 throttled .... ${g('orders_throttled', 'count')}`,
        `    p95 latency ...... ${f2(g(wd, 'p(95)'))} ms   (max ${f2(g(wd, 'max'))} ms)`,
        `    checks .......... ${f2(g('checks{scenario:write_load}', 'rate') * 100)}% pass`,
        `    queue backlog .... peak ${g('write_queue_backlog', 'max')} (waiting+active, sampled)`,
        '',
        '  OVERALL',
        `    infra failure rate ${f2(g('infra_failures', 'rate') * 100)}%   (5xx / timeout / non-409 4xx)`,
        `    data integrity ... ${g('data_integrity_ok', 'rate') === 1 ? 'PASS (remainingStock == 0 after drain)' : 'FAIL — stale count served'}`,
        `    total requests ... ${g('http_reqs', 'count')}`,
        '',
        '##################################################################',
        '',
    ].join('\n');

    const out = { stdout: banner };
    if (__ENV.SUMMARY_PATH) {
        out[__ENV.SUMMARY_PATH] = JSON.stringify(data, null, 2);
    }
    return out;
}