// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { atom } from "jotai";

import { allClusters } from "~/store/allClusters";
import { allObjects } from "~/store/allObjects";
import { allSchemas } from "~/store/allSchemas";

export type SubscribeDerivedHealth = "healthy" | "unhealthy" | "unknown";

/**
 * Derives environment health from the state of global SUBSCRIBE connections.
 * - "healthy": at least one subscribe is connected and has completed its snapshot
 * - "unhealthy": all subscribes have errors (connections lost)
 * - "unknown": no subscribe has completed yet (bootstrap phase)
 *
 * This allows us to stop polling SELECT mz_version() once subscribes are alive,
 * eliminating O(tabs * time) health check queries against mz_catalog_server.
 */
export const subscribeDerivedHealthAtom = atom<SubscribeDerivedHealth>((get) => {
  const states = [get(allClusters), get(allObjects), get(allSchemas)];

  const anyHealthy = states.some((s) => s.snapshotComplete && !s.error);
  if (anyHealthy) return "healthy";

  const allErrored = states.every((s) => s.error);
  if (allErrored) return "unhealthy";

  return "unknown";
});
