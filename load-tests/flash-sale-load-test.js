import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
export const successfulOrders = new Counter('orders_success_count');
export const rejectedOrders = new Counter('orders_rejected_count');
export const duplicateBlockedOrders = new Counter('orders_duplicate_blocked_count');
export const orderErrorRate = new Rate('orders_error_rate');
export const orderLatency = new Trend('order_placement_duration');

// Configurable Target Host (Defaults to localhost)
const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const TOTAL_USERS = parseInt(__ENV.TOTAL_USERS || '500', 10);
const TARGET_PRODUCT_ID = __ENV.PRODUCT_ID || 'p-1001';

export const options = {
  scenarios: {
    // 1. Read Load Scenario: 1,000 Concurrent VUs querying products
    read_load_scenario: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
      startTime: '0s',
      exec: 'readProductsLoad',
    },
    // 2. Write Load Scenario: 500 Concurrent VUs competing for limited stock
    write_load_scenario: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '1m',
      startTime: '35s', // Run after read load or warm-up
      exec: 'writeOrdersLoad',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'], // Global HTTP failure rate < 10%
    http_req_duration: ['p(95)<1500'], // 95% of requests should be below 1500ms
  },
};

/**
 * =========================================================================
 * 1. Preparation Phase (Setup)
 * Runs once before scenarios.
 * Obtains JWT tokens for 500 unique users: user-1 to user-500.
 * =========================================================================
 */
export function setup() {
  console.log(`[SETUP] Starting Preparation Phase: Generating JWT tokens for ${TOTAL_USERS} users from ${BASE_URL}...`);

  const tokens = [];
  const tokenUrl = `${BASE_URL}/api/v1/auth/token`;

  for (let i = 1; i <= TOTAL_USERS; i++) {
    const userId = `user-${i}`;
    const payload = JSON.stringify({
      userId: userId,
      username: `Customer ${i}`,
      role: 'customer',
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const res = http.post(tokenUrl, payload, params);

    if (res.status === 200 || res.status === 201) {
      try {
        const body = JSON.parse(res.body);
        tokens.push({
          userId: userId,
          token: body.accessToken || body.token || body.data?.accessToken,
        });
      } catch (err) {
        console.error(`Failed to parse token response for ${userId}: ${res.body}`);
      }
    } else {
      console.warn(`[SETUP WARNING] Failed to get token for ${userId}, status: ${res.status}`);
    }
  }

  console.log(`[SETUP] Successfully prepared ${tokens.length} / ${TOTAL_USERS} user JWT tokens.`);
  return { tokens };
}

/**
 * =========================================================================
 * 2. Read Load Scenario
 * 1,000 Concurrent Users querying GET /api/v1/products?page=1&limit=10
 * =========================================================================
 */
export function readProductsLoad() {
  group('Read Load: Products Pagination', () => {
    const url = `${BASE_URL}/api/v1/products?page=1&limit=10`;
    const res = http.get(url);

    check(res, {
      'status is 200': (r) => r.status === 200,
      'response has items': (r) => {
        try {
          const body = JSON.parse(r.body);
          return (body.items && body.items.length >= 0) || Array.isArray(body);
        } catch (_) {
          return false;
        }
      },
    });

    sleep(0.5); // Short pause before next iteration
  });
}

/**
 * =========================================================================
 * 3. Write Load Scenario
 * 500 Concurrent Users placing order for product p-1001 with JWT tokens.
 * Simulates duplicate/burst requests (2-3 simultaneous calls) for some users.
 * =========================================================================
 */
export function writeOrdersLoad(data) {
  group('Write Load: Flash Sale Orders', () => {
    const vuIndex = __VU - 1; // 0-indexed VU ID
    const userAuth = data.tokens[vuIndex % data.tokens.length];

    if (!userAuth || !userAuth.token) {
      console.error(`VU ${__VU} has no valid JWT token.`);
      return;
    }

    const orderUrl = `${BASE_URL}/api/v1/orders`;
    const payload = JSON.stringify({
      productId: TARGET_PRODUCT_ID,
    });

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userAuth.token}`,
    };

    // Simulate duplicate request for ~20% of users (e.g. VU 1, 5, 10, etc.)
    const isDoubleShooter = __VU % 5 === 0;

    if (isDoubleShooter) {
      // Send 2 or 3 requests in parallel (batch) for duplicate order test
      const requests = [
        ['POST', orderUrl, payload, { headers, tags: { name: 'OrderBurst1' } }],
        ['POST', orderUrl, payload, { headers, tags: { name: 'OrderBurst2' } }],
        ['POST', orderUrl, payload, { headers, tags: { name: 'OrderBurst3' } }],
      ];

      const startTime = Date.now();
      const responses = http.batch(requests);
      orderLatency.add(Date.now() - startTime);

      let acceptedCount = 0;
      let duplicateBlockedCount = 0;

      responses.forEach((res) => {
        if (res.status === 200 || res.status === 201 || res.status === 202) {
          acceptedCount++;
          successfulOrders.add(1);
        } else if (res.status === 400 || res.status === 409 || res.status === 429) {
          // Blocked due to already purchased, lock duplicate, or out of stock
          duplicateBlockedCount++;
          duplicateBlockedOrders.add(1);
        } else {
          orderErrorRate.add(1);
        }
      });

      // User should only succeed at most ONCE even if they fired 3 times
      check(acceptedCount, {
        'duplicate protection: max 1 success per user': (count) => count <= 1,
      });

    } else {
      // Single request for normal user
      const startTime = Date.now();
      const res = http.post(orderUrl, payload, { headers });
      orderLatency.add(Date.now() - startTime);

      const isAccepted = res.status === 200 || res.status === 201 || res.status === 202;
      const isExpectedReject = res.status === 400 || res.status === 409 || res.status === 429;

      if (isAccepted) {
        successfulOrders.add(1);
      } else if (isExpectedReject) {
        rejectedOrders.add(1);
      } else {
        orderErrorRate.add(1);
      }

      check(res, {
        'order status is 202/200 or out-of-stock/duplicate rejection (400/409)': (r) =>
          isAccepted || isExpectedReject,
      });
    }
  });
}
