// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { QueryKey } from "@tanstack/react-query";
import { sql } from "kysely";

import {
  executeSqlV2,
  IPostgresInterval,
  queryBuilder,
} from "~/api/materialize";

export interface UpstreamDependencyRow {
  id: string;
  name: string;
  objectType: string;
  schemaName: string;
  databaseName: string | null;
  clusterName: string | null;
  lag: IPostgresInterval | null;
  targetLag: IPostgresInterval | null;
  isBottleneck: boolean;
}

/**
 * Live single-hop upstream dependencies of an object. Bottleneck flag is set
 * for the input(s) tied for the highest lag among siblings — they're what's
 * pinning the probe's frontier.
 */
export const buildLiveUpstreamDependenciesQuery = (objectId: string) =>
  queryBuilder
    .with("input_of", (cte) =>
      cte
        .selectFrom("mz_compute_dependencies")
        .select(["dependency_id as source", "object_id as target"]),
    )
    .with("latest_lag", (cte) =>
      cte
        .selectFrom("mz_wallclock_global_lag_recent_history")
        .select(["object_id", "lag"])
        .distinctOn(["object_id"])
        .where(
          (eb) => sql`${eb.ref("occurred_at")} + INTERVAL '5 MINUTES'`,
          ">=",
          sql<Date>`mz_now()`,
        )
        .orderBy("object_id")
        .orderBy("occurred_at", "desc"),
    )
    .selectFrom("input_of as i")
    .innerJoin("mz_objects as o", "o.id", "i.source")
    .innerJoin("mz_object_fully_qualified_names as fqn", "fqn.id", "i.source")
    .leftJoin("mz_clusters as c", "c.id", "o.cluster_id")
    .leftJoin("latest_lag as ls", "ls.object_id", "i.source")
    .leftJoin("latest_lag as lt", "lt.object_id", "i.target")
    .select((eb) => [
      "i.source as id",
      "fqn.name",
      sql<string>`o.type`.as("objectType"),
      "fqn.schema_name as schemaName",
      "fqn.database_name as databaseName",
      "c.name as clusterName",
      "ls.lag",
      sql<IPostgresInterval | null>`lt.lag`.as("targetLag"),
      eb
        .case()
        .when(sql<boolean>`ls.lag IS NOT DISTINCT FROM max(ls.lag) OVER ()`)
        .then(sql<boolean>`true`)
        .else(sql<boolean>`false`)
        .end()
        .as("isBottleneck"),
    ])
    .where("i.target", "=", objectId)
    .orderBy("ls.lag", sql`desc nulls last`);

/**
 * Single-hop upstream dependencies of an object at a past timestamp. The
 * `lag_at_time` CTE bucket-aligns to match the freshness chart's pMAX-in-bucket
 * value at the same point — clicking a peak shows lags consistent with what
 * the chart drew.
 */
export const fetchUpstreamDependenciesAtTime = ({
  objectId,
  timestamp,
  bucketSizeMs,
  queryKey,
  requestOptions,
}: {
  objectId: string;
  timestamp: Date;
  bucketSizeMs: number;
  queryKey: QueryKey;
  requestOptions?: RequestInit;
}) => {
  const ts = timestamp.toISOString();
  const bucketMs = sql.raw(`${bucketSizeMs}`);
  const tsLit = sql.lit(ts);

  const query = sql<UpstreamDependencyRow>`
    WITH
      input_of AS (
        SELECT dependency_id AS source, object_id AS target
        FROM mz_compute_dependencies
      ),
      lag_at_time AS (
        SELECT DISTINCT ON (object_id) object_id, lag
        FROM mz_wallclock_global_lag_recent_history
        WHERE occurred_at >= date_bin(
            INTERVAL '${bucketMs} MILLISECONDS',
            ${tsLit}::timestamptz,
            TIMESTAMP '1970-01-01'
          )
          AND occurred_at < date_bin(
            INTERVAL '${bucketMs} MILLISECONDS',
            ${tsLit}::timestamptz,
            TIMESTAMP '1970-01-01'
          ) + INTERVAL '${bucketMs} MILLISECONDS'
        ORDER BY object_id, lag DESC
      )
    SELECT
      i.source AS "id",
      fqn.name AS "name",
      o.type AS "objectType",
      fqn.schema_name AS "schemaName",
      fqn.database_name AS "databaseName",
      c.name AS "clusterName",
      ls.lag AS "lag",
      lt.lag AS "targetLag",
      ls.lag IS NOT DISTINCT FROM max(ls.lag) OVER () AS "isBottleneck"
    FROM input_of i
    JOIN mz_objects o ON o.id = i.source
    JOIN mz_object_fully_qualified_names fqn ON fqn.id = i.source
    LEFT JOIN mz_clusters c ON c.id = o.cluster_id
    LEFT JOIN lag_at_time ls ON ls.object_id = i.source
    LEFT JOIN lag_at_time lt ON lt.object_id = i.target
    WHERE i.target = ${sql.lit(objectId)}
    ORDER BY ls.lag DESC NULLS LAST
  `.compile(queryBuilder);

  return executeSqlV2({
    queries: query,
    queryKey,
    requestOptions,
    requestTimeoutMs: 30_000,
    sessionVariables: { transaction_isolation: "serializable" },
  });
};
