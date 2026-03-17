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
  buildSessionVariables,
  executeSqlV2,
  queryBuilder,
} from "~/api/materialize";

export type LargestMaintainedQueriesParams = {
  replicaHeapLimit: number;
  limit: number;
  clusterName: string;
  replicaName: string;
};

/**
 * Builds an optimized query to find the largest maintained queries by memory usage.
 *
 * Instead of using mz_dataflow_arrangement_sizes (which expands into a 10-way CTE
 * reading 9 raw log tables for records, batches, size, capacity, and allocations),
 * this query reads only the 2 raw tables needed for the "size" metric:
 * mz_arrangement_heap_size_raw and mz_arrangement_batcher_size_raw.
 */
export function buildLargestMaintainedQueriesQuery({
  replicaHeapLimit,
  limit,
}: Omit<LargestMaintainedQueriesParams, "replicaName" | "clusterName">) {
  const memoryPercentageExpr = replicaHeapLimit
    ? sql`((COALESCE(SUM(hs.size), 0) + COALESCE(SUM(bs.size), 0))::float8 / ${sql.raw(replicaHeapLimit.toString())}) * 100`
    : sql`null`;

  return sql<{
    id: string | null;
    name: string | null;
    size: bigint | null;
    memoryPercentage: number | null;
    type: "materialized-view" | "index";
    schemaName: string | null;
    databaseName: string | null;
    dataflowId: string;
    dataflowName: string;
  }>`
    SELECT
      o.id,
      o.name,
      (COALESCE(SUM(hs.size), 0) + COALESCE(SUM(bs.size), 0))::int8 AS size,
      ${memoryPercentageExpr} AS "memoryPercentage",
      o.type AS "type",
      sc.name AS "schemaName",
      da.name AS "databaseName",
      ce.dataflow_id AS "dataflowId",
      dod.dataflow_name AS "dataflowName"
    FROM mz_compute_exports AS ce
    JOIN mz_dataflow_operator_dataflows AS dod
      ON dod.dataflow_id = ce.dataflow_id
    LEFT JOIN (
      SELECT operator_id, COUNT(*) AS size
      FROM mz_arrangement_heap_size_raw
      GROUP BY operator_id
    ) AS hs ON hs.operator_id = dod.id
    LEFT JOIN (
      SELECT operator_id, COUNT(*) AS size
      FROM mz_arrangement_batcher_size_raw
      GROUP BY operator_id
    ) AS bs ON bs.operator_id = dod.id
    LEFT JOIN mz_objects AS o ON o.id = ce.export_id
    LEFT JOIN mz_schemas AS sc ON sc.id = o.schema_id
    LEFT JOIN mz_databases AS da ON da.id = sc.database_id
    WHERE ce.export_id NOT LIKE 't%'
    GROUP BY ce.export_id, ce.dataflow_id, o.id, o.name, o.type, sc.name, da.name, dod.dataflow_name
    ORDER BY "memoryPercentage" DESC NULLS LAST
    LIMIT ${sql.raw(limit.toString())}
  `.compile(queryBuilder);
}

/**
 * Fetches the largest maintained queries for a given cluster replica.
 */
export async function fetchLargestMaintainedQueries({
  params,
  queryKey,
  requestOptions,
}: {
  params: LargestMaintainedQueriesParams;
  queryKey: QueryKey;
  requestOptions?: RequestInit;
}) {
  const compiledQuery = buildLargestMaintainedQueriesQuery(params);
  return executeSqlV2({
    sessionVariables: buildSessionVariables({
      cluster: params.clusterName,
      cluster_replica: params.replicaName,
    }),
    queries: compiledQuery,
    queryKey: queryKey,
    requestOptions,
  });
}
