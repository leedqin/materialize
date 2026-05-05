// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { VStack } from "@chakra-ui/react";
import React from "react";

import { calculateBucketSizeFromLookback } from "~/api/materialize/freshness/lagHistory";

import { CriticalPathGraph } from "./CriticalPathGraph";
import { ObjectFreshnessChart } from "./ObjectFreshnessChart";
import { MaintainedObjectListItem } from "./queries";
import { UpstreamDependenciesTable } from "./UpstreamDependenciesTable";

export interface ObjectFreshnessProps {
  item: MaintainedObjectListItem;
  timePeriodMinutes: number;
  setTimePeriodMinutes: React.Dispatch<React.SetStateAction<number>>;
}

export const ObjectFreshness = ({
  item,
  timePeriodMinutes,
  setTimePeriodMinutes,
}: ObjectFreshnessProps) => {
  const [hoverTimestamp, setHoverTimestamp] = React.useState<Date | null>(null);
  const [lockedTimestamp, setLockedTimestamp] = React.useState<Date | null>(
    null,
  );

  const isLocked = lockedTimestamp !== null;
  const selectedTimestamp = lockedTimestamp ?? hoverTimestamp;
  const bucketSizeMs = calculateBucketSizeFromLookback(
    timePeriodMinutes * 60 * 1000,
  );

  return (
    <VStack align="start" spacing={6} width="100%">
      <ObjectFreshnessChart
        objectId={item.id}
        timePeriodMinutes={timePeriodMinutes}
        setTimePeriodMinutes={setTimePeriodMinutes}
        onTimestampSelect={isLocked ? undefined : setHoverTimestamp}
        onTimestampLock={setLockedTimestamp}
        selectedTimestamp={selectedTimestamp}
        isLocked={isLocked}
      />
      <CriticalPathGraph
        probe={item}
        timestamp={lockedTimestamp}
        bucketSizeMs={bucketSizeMs}
      />
      <UpstreamDependenciesTable
        objectId={item.id}
        timestamp={lockedTimestamp}
        bucketSizeMs={bucketSizeMs}
      />
    </VStack>
  );
};
