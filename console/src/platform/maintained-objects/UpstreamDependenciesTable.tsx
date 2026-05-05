// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import {
  Box,
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  Tooltip,
  useTheme,
  VStack,
} from "@chakra-ui/react";
import { createColumnHelper } from "@tanstack/react-table";
import React from "react";
import { Link as RouterLink } from "react-router-dom";

import { createNamespace, IPostgresInterval } from "~/api/materialize";
import { UpstreamDependencyRow } from "~/api/materialize/maintained-objects/upstreamDependencies";
import { UniversalTable } from "~/components/Table/UniversalTable";
import { useUniversalTable } from "~/components/Table/useUniversalTable";
import TextLink from "~/components/TextLink";
import { MaterializeTheme } from "~/theme";
import { truncateMaxWidth } from "~/theme/components/Table";
import { sumPostgresIntervalMs } from "~/util";
import { formatIntervalShort } from "~/utils/format";

import { useUpstreamDependencies } from "./queries";

export interface UpstreamDependenciesTableProps {
  objectId: string;
  /** When set, query at this exact past timestamp; otherwise live SUBSCRIBE. */
  timestamp: Date | null;
  bucketSizeMs: number;
}

export const UpstreamDependenciesTable = ({
  objectId,
  timestamp,
  bucketSizeMs,
}: UpstreamDependenciesTableProps) => {
  const { colors } = useTheme<MaterializeTheme>();
  const { data, isLoading } = useUpstreamDependencies({
    objectId,
    timestamp,
    bucketSizeMs,
  });

  const breakdown = computeFreshnessBreakdown(data);

  return (
    <Card
      p={5}
      width="100%"
      borderRadius="md"
      border="1px"
      borderColor={colors.border.primary}
    >
      <VStack align="start" spacing={3} width="100%">
        <Text textStyle="heading-sm">Upstream dependencies</Text>

        {breakdown && <FreshnessBreakdownStrip breakdown={breakdown} />}

        {isLoading ? (
          <Center height="120px" width="100%">
            <Spinner size="sm" />
          </Center>
        ) : data.length === 0 ? (
          <Center height="120px" width="100%">
            <Text textStyle="text-ui-reg" color={colors.foreground.secondary}>
              No upstream dependencies.
            </Text>
          </Center>
        ) : (
          <UpstreamDependenciesTableInner data={data} />
        )}
      </VStack>
    </Card>
  );
};

const columnHelper = createColumnHelper<UpstreamDependencyRow>();

const tableColumns = [
  columnHelper.accessor("name", {
    header: "Object",
    cell: (info) => {
      const row = info.row.original;
      const namespace = createNamespace(row.databaseName, row.schemaName);
      const fullyQualified = namespace ? `${namespace}.${row.name}` : row.name;
      return (
        <Tooltip label={fullyQualified} lineHeight={1.2} openDelay={200}>
          <Box {...truncateMaxWidth} minW={0} overflow="hidden">
            {namespace && (
              <Text textStyle="text-small" noOfLines={1}>
                {namespace}
              </Text>
            )}
            <TextLink
              as={RouterLink}
              to={`../${row.id}`}
              relative="path"
              textStyle="text-ui-med"
              noOfLines={1}
            >
              {row.name}
            </TextLink>
          </Box>
        </Tooltip>
      );
    },
    meta: { cellProps: { py: "2" } },
  }),
  columnHelper.accessor("objectType", {
    header: "Type",
    cell: (info) => (
      <Text textStyle="text-ui-reg" noOfLines={1}>
        {info.getValue()}
      </Text>
    ),
    meta: { cellProps: { ...truncateMaxWidth, py: "2" } },
  }),
  columnHelper.accessor("clusterName", {
    header: "Cluster",
    cell: (info) => (
      <Text textStyle="text-ui-reg" noOfLines={1}>
        {info.getValue() ?? "-"}
      </Text>
    ),
    meta: { cellProps: { ...truncateMaxWidth, py: "2" } },
  }),
  columnHelper.accessor("lag", {
    header: "Lag",
    cell: (info) => <LagCell lag={info.getValue()} />,
    sortingFn: (a, b) => lagToMs(a.original.lag) - lagToMs(b.original.lag),
    meta: { cellProps: { py: "2" } },
  }),
];

const UpstreamDependenciesTableInner = ({
  data,
}: {
  data: UpstreamDependencyRow[];
}) => {
  const table = useUniversalTable({
    data,
    columns: tableColumns,
    initialSorting: [{ id: "lag", desc: true }],
    pageSize: 1000,
  });

  return <UniversalTable table={table} />;
};

const LagCell = ({ lag }: { lag: IPostgresInterval | null }) => {
  const { colors } = useTheme<MaterializeTheme>();
  if (!lag) {
    return (
      <Tooltip
        label="No lag data — object may not be hydrated."
        lineHeight={1.2}
        openDelay={200}
      >
        <Text textStyle="text-ui-reg" color={colors.foreground.secondary}>
          —
        </Text>
      </Tooltip>
    );
  }
  return <Text textStyle="text-ui-med">{formatIntervalShort(lag)}</Text>;
};

interface FreshnessBreakdown {
  selfDelayMs: number;
  maxInputMs: number;
  isSelfBottleneck: boolean;
}

const FreshnessBreakdownStrip = ({
  breakdown,
}: {
  breakdown: FreshnessBreakdown;
}) => {
  const { colors } = useTheme<MaterializeTheme>();
  const { selfDelayMs, maxInputMs, isSelfBottleneck } = breakdown;
  return (
    <HStack
      width="100%"
      px={3}
      py={2}
      borderRadius="md"
      bg={colors.background.secondary}
      spacing={1}
      flexWrap="wrap"
    >
      <Text textStyle="text-ui-reg" color={colors.foreground.secondary}>
        Output lag breakdown:
      </Text>
      <Text
        textStyle="text-ui-med"
        color={
          isSelfBottleneck
            ? colors.foreground.primary
            : colors.accent.red
        }
      >
        {formatDuration(maxInputMs)} upstream
      </Text>
      <Text textStyle="text-ui-reg" color={colors.foreground.secondary}>
        +
      </Text>
      <Text
        textStyle="text-ui-med"
        color={
          isSelfBottleneck
            ? colors.accent.red
            : colors.foreground.primary
        }
      >
        {formatDuration(selfDelayMs)} local processing
      </Text>
    </HStack>
  );
};

const lagToMs = (lag: IPostgresInterval | null): number =>
  lag ? sumPostgresIntervalMs(lag) : 0;

// Don't show the breakdown for objects that are essentially fresh — there's
// nothing to diagnose, and tiny rounding-level numbers just add noise.
const BREAKDOWN_MIN_LAG_MS = 1000;

const computeFreshnessBreakdown = (
  data: UpstreamDependencyRow[],
): FreshnessBreakdown | null => {
  if (data.length === 0) return null;
  const targetLag = data[0]?.targetLag;
  if (!targetLag) return null;
  const targetMs = sumPostgresIntervalMs(targetLag);
  if (targetMs < BREAKDOWN_MIN_LAG_MS) return null;
  const maxInputMs = Math.max(...data.map((r) => lagToMs(r.lag)));
  const selfDelayMs = targetMs - maxInputMs;
  if (selfDelayMs <= 0) return null;
  return {
    selfDelayMs,
    maxInputMs,
    isSelfBottleneck: selfDelayMs > maxInputMs,
  };
};

const formatDuration = (ms: number): string => {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m ${totalSec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
};
