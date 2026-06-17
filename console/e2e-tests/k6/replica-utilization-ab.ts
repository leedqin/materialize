// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

/**
 * A/B load test for the replicaUtilizationHistory query: the same logical request served
 * by Materialize directly (the captured /api/sql rollup) vs by the serving layer's
 * fine-grained cache (GET /cache/replica_utilization_history). Each VU simulates one
 * cluster-detail tab polling at the real 20s refetchInterval.
 *
 * Run each mode separately so server-side CPU is attributable:
 *   k6 run -e MODE=sql   -e MZ_HTTP_URL=http://127.0.0.1:32885 replica-utilization-ab.ts
 *   k6 run -e MODE=cache -e LAYER_URL=http://127.0.0.1:4000    replica-utilization-ab.ts
 *
 * The captured query's startDate literal is rewritten at init to now-1h, so both modes
 * serve the console's real "Last hour" window.
 */

import { check, sleep } from "k6";
import http from "k6/http";

declare const __ENV: Record<string, string | undefined>;
declare function open(path: string): string;

const MODE = __ENV.MODE || "sql";
const MZ_URL = (__ENV.MZ_HTTP_URL || "http://127.0.0.1:6876").replace(/\/$/, "");
const LAYER_URL = (__ENV.LAYER_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const POLL_SECONDS = 20;

const START_DATE = new Date(Date.now() - 60 * 60 * 1000).toISOString();

interface CapturedQuery {
  urlPath: string;
  body: unknown;
}

const captured = (
  JSON.parse(open("./queries.json")) as Record<string, CapturedQuery>
)["clusters.replicaUtilizationHistory"];
if (!captured) {
  throw new Error(
    "clusters.replicaUtilizationHistory not in queries.json — re-dump with: npx playwright test --project=scalability dump-queries",
  );
}

// Rewrite the dump-time startDate literal (any non-1970 ISO timestamp) to now-1h.
const sqlBody = JSON.stringify(captured.body).replace(
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g,
  (ts) => (ts.startsWith("1970") ? ts : START_DATE),
);

const cacheUrl =
  `${LAYER_URL}/cache/replica_utilization_history` +
  `?bucketSizeMs=60000&startDate=${encodeURIComponent(START_DATE)}&clusterIds=s2`;

export const options = {
  scenarios: {
    tabs: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: parseInt(__ENV.VUS_STAGE_1 || "10", 10) },
        { duration: "60s", target: parseInt(__ENV.VUS_STAGE_2 || "30", 10) },
        { duration: "90s", target: parseInt(__ENV.VUS_STAGE_3 || "60", 10) },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Render the breakdown in the summary; generous gates so the run always reports.
    [`http_req_duration{mode:${MODE}}`]: ["p(95)<60000"],
    [`http_req_failed{mode:${MODE}}`]: ["rate<0.5"],
  },
};

export default function () {
  let ok: boolean;
  if (MODE === "cache") {
    const res = http.get(cacheUrl, { tags: { mode: MODE }, timeout: "60s" });
    ok = check(res, {
      "status 200": (r) => r.status === 200,
      "has rows": (r) => typeof r.body === "string" && r.body.includes('"rows"'),
    });
  } else {
    const res = http.post(`${MZ_URL}${captured.urlPath}`, sqlBody, {
      headers: { "Content-Type": "application/json" },
      tags: { mode: MODE },
      timeout: "60s",
    });
    ok = check(res, {
      "status 200": (r) => r.status === 200,
      "no error": (r) => typeof r.body === "string" && !r.body.includes('"error"'),
    });
  }
  if (!ok) {
    // Failures still sleep so a melting server doesn't get hammered harder.
  }
  sleep(POLL_SECONDS);
}
