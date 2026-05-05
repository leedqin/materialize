// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import {
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  useTheme,
  VStack,
} from "@chakra-ui/react";
import React from "react";

import { FreshnessGraph } from "~/components/FreshnessGraph/FreshnessGraph";
import TimePeriodSelect from "~/components/TimePeriodSelect";
import { MaterializeTheme } from "~/theme";

import { FRESHNESS_CHART_OPTIONS } from "./constants";
import { useObjectFreshnessHistory } from "./queries";

export interface ObjectFreshnessChartProps {
  objectId: string;
  timePeriodMinutes: number;
  setTimePeriodMinutes: React.Dispatch<React.SetStateAction<number>>;
  onTimestampSelect?: (timestamp: Date | null) => void;
  onTimestampLock?: (timestamp: Date | null) => void;
  selectedTimestamp?: Date | null;
  isLocked?: boolean;
}

export const ObjectFreshnessChart = ({
  objectId,
  timePeriodMinutes,
  setTimePeriodMinutes,
  onTimestampSelect,
  onTimestampLock,
  selectedTimestamp,
  isLocked,
}: ObjectFreshnessChartProps) => {
  const { colors } = useTheme<MaterializeTheme>();

  const lookbackMs = timePeriodMinutes * 60 * 1000;

  const { data, isLoading } = useObjectFreshnessHistory({
    objectId,
    lookbackMs,
  });

  return (
    <Card
      p={5}
      width="100%"
      borderRadius="md"
      border="1px"
      borderColor={colors.border.primary}
    >
      <VStack align="start" spacing={3} width="100%">
        <HStack width="100%" justify="space-between">
          <Text textStyle="heading-sm">Freshness over time</Text>
          <TimePeriodSelect
            timePeriodMinutes={timePeriodMinutes}
            setTimePeriodMinutes={setTimePeriodMinutes}
            options={FRESHNESS_CHART_OPTIONS}
          />
        </HStack>

        {isLoading || !data ? (
          <Center height="180px" width="100%">
            <Spinner size="sm" />
          </Center>
        ) : data.historicalData.length === 0 ? (
          <Center height="180px" width="100%">
            <Text textStyle="text-ui-reg" color={colors.foreground.secondary}>
              No freshness data available for this time period.
            </Text>
          </Center>
        ) : (
          <FreshnessGraph
            bucketSizeMs={data.bucketSizeMs}
            xAccessor={(d) => d.timestamp}
            lines={data.lines}
            data={data.historicalData}
            startTime={data.startTime}
            endTime={data.endTime}
            onPointSelect={
              onTimestampSelect
                ? (ts) => onTimestampSelect(ts !== null ? new Date(ts) : null)
                : undefined
            }
            onPointLock={
              onTimestampLock
                ? (ts) => onTimestampLock(ts !== null ? new Date(ts) : null)
                : undefined
            }
            selectedTimestamp={selectedTimestamp?.getTime() ?? null}
            isLocked={isLocked}
          />
        )}
      </VStack>
    </Card>
  );
};

export default ObjectFreshnessChart;
