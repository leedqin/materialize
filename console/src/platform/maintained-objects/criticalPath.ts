// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { useQuery } from "@tanstack/react-query";

import {
  buildQueryKeyPart,
  buildRegionQueryKey,
} from "~/api/buildQueryKeySchema";
import { IPostgresInterval } from "~/api/materialize";
import {
  fetchUpstreamDependenciesAtTime,
  UpstreamDependencyRow,
} from "~/api/materialize/maintained-objects/upstreamDependencies";

export interface CriticalPathNode {
  id: string;
  name: string;
  schemaName: string;
  databaseName: string | null;
  objectType: string;
  clusterName: string | null;
  lag: IPostgresInterval | null;
  /** True if this node is on the critical (bottleneck) chain. False = off-path sibling. */
  isBottleneck: boolean;
}

export interface CriticalPathEdge {
  /** Upstream object id. */
  parentId: string;
  /** Downstream object id (toward the probe). */
  childId: string;
  /** True if this edge connects two bottleneck nodes (i.e. lies on the critical chain). */
  isBottleneck: boolean;
}

export interface CriticalPathData {
  nodes: CriticalPathNode[];
  edges: CriticalPathEdge[];
}

const criticalPathQueryKey = (
  objectId: string,
  timestamp: string,
  bucketSizeMs: number,
  maxDepth: number,
) =>
  [
    ...buildRegionQueryKey("maintainedObjects"),
    buildQueryKeyPart("criticalPath", {
      objectId,
      timestamp,
      bucketSizeMs,
      maxDepth,
    }),
  ] as const;

const DEFAULT_MAX_DEPTH = 5;

export function useCriticalPath({
  objectId,
  timestamp,
  bucketSizeMs,
  maxDepth = DEFAULT_MAX_DEPTH,
}: {
  objectId: string | undefined;
  /** Null = live (re-walk every 30s at "now"). */
  timestamp: Date | null;
  bucketSizeMs: number;
  maxDepth?: number;
}) {
  const isLive = timestamp === null;
  return useQuery({
    queryKey: criticalPathQueryKey(
      objectId ?? "",
      isLive ? "live" : timestamp.toISOString(),
      bucketSizeMs,
      maxDepth,
    ),
    queryFn: ({ queryKey, signal }) =>
      walkCriticalPath({
        probeId: objectId!,
        timestamp: timestamp ?? new Date(),
        bucketSizeMs,
        maxDepth,
        signal,
        queryKey,
      }),
    enabled: !!objectId,
    staleTime: isLive ? 30_000 : Infinity,
    refetchInterval: isLive ? 30_000 : false,
  });
}

const walkCriticalPath = async ({
  probeId,
  timestamp,
  bucketSizeMs,
  maxDepth,
  signal,
  queryKey,
}: {
  probeId: string;
  timestamp: Date;
  bucketSizeMs: number;
  maxDepth: number;
  signal: AbortSignal | undefined;
  queryKey: readonly unknown[];
}): Promise<CriticalPathData> => {
  const nodesById = new Map<string, CriticalPathNode>();
  const edges: CriticalPathEdge[] = [];
  let frontier: string[] = [probeId];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const results = await Promise.all(
      frontier.map((id) =>
        fetchUpstreamDependenciesAtTime({
          objectId: id,
          timestamp,
          bucketSizeMs,
          queryKey: [...queryKey, "level", depth, id],
          requestOptions: { signal },
        }).then((res) => ({ id, rows: res.rows })),
      ),
    );

    const nextFrontier: string[] = [];
    for (const { id: childId, rows } of results) {
      for (const input of rows) {
        edges.push({
          parentId: input.id,
          childId,
          isBottleneck: input.isBottleneck,
        });
        if (!nodesById.has(input.id)) {
          nodesById.set(input.id, toNode(input));
          // Only follow bottleneck inputs — off-path nodes terminate here.
          if (input.isBottleneck) nextFrontier.push(input.id);
        }
      }
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return { nodes: [...nodesById.values()], edges };
};

const toNode = (row: UpstreamDependencyRow): CriticalPathNode => ({
  id: row.id,
  name: row.name,
  schemaName: row.schemaName,
  databaseName: row.databaseName,
  objectType: row.objectType,
  clusterName: row.clusterName,
  lag: row.lag,
  isBottleneck: row.isBottleneck,
});
