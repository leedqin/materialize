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
  Spinner,
  Text,
  useTheme,
  VStack,
} from "@chakra-ui/react";
import React from "react";

import { IPostgresInterval } from "~/api/materialize";
import { Canvas, GraphEdgeContainer, STROKE_WIDTH } from "~/components/Graph";
import { useDagreGraph } from "~/hooks/useDagreGraph";
import { MaterializeTheme } from "~/theme";
import { formatIntervalShort } from "~/utils/format";

import {
  CriticalPathData,
  CriticalPathEdge,
  useCriticalPath,
} from "./criticalPath";
import { MaintainedObjectListItem } from "./queries";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const RANK_SEP = 32;

export interface CriticalPathGraphProps {
  probe: MaintainedObjectListItem;
  /** Null = live (now). When the chart is locked, this is the locked timestamp. */
  timestamp: Date | null;
  bucketSizeMs: number;
}

export const CriticalPathGraph = ({
  probe,
  timestamp,
  bucketSizeMs,
}: CriticalPathGraphProps) => {
  const { colors } = useTheme<MaterializeTheme>();
  const { data, isLoading } = useCriticalPath({
    objectId: probe.id,
    timestamp,
    bucketSizeMs,
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
        <Text textStyle="heading-sm">Critical path</Text>

        {isLoading || !data ? (
          <Center height="200px" width="100%">
            <Spinner size="sm" />
          </Center>
        ) : (
          <CriticalPathGraphInner probe={probe} data={data} />
        )}
      </VStack>
    </Card>
  );
};

interface RenderableNode {
  id: string;
  name: string;
  lag: IPostgresInterval | null;
  isProbe: boolean;
  isBottleneck: boolean;
  /** Count of off-path sibling inputs sharing the same child as this node. */
  offPathCount: number;
}

const CriticalPathGraphInner = ({
  probe,
  data,
}: {
  probe: MaintainedObjectListItem;
  data: CriticalPathData;
}) => {
  const [expandedBottleneckId, setExpandedBottleneckId] = React.useState<
    string | null
  >(null);

  // Visible nodes/edges depend on which bottleneck (if any) is currently
  // expanded. By default we show the bottleneck chain only; expanding splices
  // in that node's off-path siblings.
  const { renderableNodes, renderableEdges, offPathCountByNode } =
    React.useMemo(
      () => buildRenderable(data, probe, expandedBottleneckId),
      [data, probe, expandedBottleneckId],
    );

  const dagreNodes = React.useMemo(
    () =>
      renderableNodes.map((n) => ({
        id: n.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
    [renderableNodes],
  );

  const {
    graph,
    nodePositionMap,
    height,
    width,
    orderedGraphEdges,
    clampPoints,
  } = useDagreGraph({
    nodes: dagreNodes,
    edges: renderableEdges,
    selectedNodeId: undefined,
    ranksep: RANK_SEP,
  });

  const nodesById = React.useMemo(() => {
    const map = new Map<string, RenderableNode>();
    for (const n of renderableNodes) {
      map.set(n.id, { ...n, offPathCount: offPathCountByNode.get(n.id) ?? 0 });
    }
    return map;
  }, [renderableNodes, offPathCountByNode]);

  if (!width || !height) {
    return (
      <Center height="200px" width="100%">
        <Spinner size="sm" />
      </Center>
    );
  }

  const toggleExpanded = (nodeId: string) => {
    setExpandedBottleneckId((curr) => (curr === nodeId ? null : nodeId));
  };

  return (
    <Box
      position="relative"
      width="100%"
      height={`${height + 40}px`}
      overflow="hidden"
    >
      <Canvas width={width} height={height} selectedNode={null}>
        {graph.nodes().map((id) => {
          const node = graph.node(id);
          const position = nodePositionMap.get(id);
          const nodeData = nodesById.get(id);
          if (!node || !position || !nodeData) return null;
          return (
            <CriticalPathGraphNode
              key={id}
              node={nodeData}
              expanded={expandedBottleneckId === nodeData.id}
              left={position.left}
              top={position.top}
              width={node.width}
              height={node.height}
              onToggleExpand={() => toggleExpanded(nodeData.id)}
            />
          );
        })}
        <GraphEdgeContainer width={width} height={height}>
          {orderedGraphEdges.map((e) => {
            const edge = graph.edge(e);
            const parentNodePosition = nodePositionMap.get(e.v);
            if (!edge || !parentNodePosition) return null;
            const points = clampPoints(edge.points);
            const [firstPoint, ...rest] = points;
            const adjusted = [
              { x: firstPoint.x, y: parentNodePosition.bottom },
              ...rest,
            ];
            const isOffPathEdge = !renderableEdges.find(
              (re) => re.parentId === e.v && re.childId === e.w,
            )?.isBottleneck;
            return (
              <CriticalPathEdgeLine
                key={`${e.v}->${e.w}`}
                points={adjusted}
                isOffPath={isOffPathEdge}
              />
            );
          })}
        </GraphEdgeContainer>
      </Canvas>
    </Box>
  );
};

const CriticalPathGraphNode = ({
  node,
  expanded,
  left,
  top,
  width,
  height,
  onToggleExpand,
}: {
  node: RenderableNode;
  expanded: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  onToggleExpand: () => void;
}) => {
  const { colors } = useTheme<MaterializeTheme>();
  const lagText = node.lag ? formatIntervalShort(node.lag) : "—";

  const borderColor = node.isProbe
    ? colors.accent.brightPurple
    : node.isBottleneck
      ? colors.accent.red
      : colors.border.secondary;
  const borderStyle = node.isProbe || expanded ? "dashed" : "solid";

  return (
    <Box
      position="absolute"
      left={`${left}px`}
      top={`${top}px`}
      width={`${width}px`}
      height={`${height}px`}
      borderRadius="md"
      borderWidth="2px"
      borderStyle={borderStyle}
      borderColor={borderColor}
      bg={colors.background.primary}
      px={3}
      py={1}
      display="flex"
      flexDirection="column"
      justifyContent="center"
      overflow="hidden"
    >
      <Text textStyle="text-ui-med" noOfLines={1}>
        {node.name}
      </Text>
      <Text
        textStyle="text-small"
        color={colors.foreground.secondary}
        noOfLines={1}
      >
        {lagText}
        {node.offPathCount > 0 && (
          <>
            {" · "}
            <Box
              as="span"
              cursor="pointer"
              textDecoration="underline"
              onClick={onToggleExpand}
            >
              {node.offPathCount} off-path
            </Box>
          </>
        )}
      </Text>
    </Box>
  );
};

const CriticalPathEdgeLine = ({
  points,
  isOffPath,
}: {
  points: { x: number; y: number }[];
  isOffPath: boolean;
}) => {
  const { colors } = useTheme<MaterializeTheme>();
  const [start, ...rest] = points;
  const end = rest.pop();
  if (!end) return null;
  const controlPoints = rest.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <path
      d={`M${start.x},${start.y} S ${controlPoints} ${end.x},${end.y}`}
      stroke={isOffPath ? colors.border.secondary : colors.accent.red}
      strokeWidth={STROKE_WIDTH}
      strokeDasharray={isOffPath ? "4 4" : undefined}
      fill="none"
    />
  );
};

const buildRenderable = (
  data: CriticalPathData,
  probe: MaintainedObjectListItem,
  expandedBottleneckId: string | null,
): {
  renderableNodes: RenderableNode[];
  renderableEdges: CriticalPathEdge[];
  offPathCountByNode: Map<string, number>;
} => {
  // Off-path counts: for each bottleneck node, how many non-bottleneck siblings
  // share the same child.
  const offPathCountByNode = new Map<string, number>();
  for (const node of data.nodes) {
    if (!node.isBottleneck) continue;
    const childId = data.edges.find(
      (e) => e.parentId === node.id && e.isBottleneck,
    )?.childId;
    if (!childId) continue;
    const count = data.edges.filter(
      (e) => e.childId === childId && !e.isBottleneck,
    ).length;
    offPathCountByNode.set(node.id, count);
  }

  const probeNode: RenderableNode = {
    id: probe.id,
    name: probe.name,
    lag: probe.lag?.value ?? null,
    isProbe: true,
    isBottleneck: false,
    offPathCount: 0,
  };

  const bottleneckNodes: RenderableNode[] = data.nodes
    .filter((n) => n.isBottleneck)
    .map((n) => ({
      id: n.id,
      name: n.name,
      lag: n.lag,
      isProbe: false,
      isBottleneck: true,
      offPathCount: offPathCountByNode.get(n.id) ?? 0,
    }));

  const baseNodes = [probeNode, ...bottleneckNodes];
  const baseEdges = data.edges.filter((e) => e.isBottleneck);

  if (!expandedBottleneckId) {
    return {
      renderableNodes: baseNodes,
      renderableEdges: baseEdges,
      offPathCountByNode,
    };
  }

  const childId = data.edges.find(
    (e) => e.parentId === expandedBottleneckId && e.isBottleneck,
  )?.childId;
  if (!childId) {
    return {
      renderableNodes: baseNodes,
      renderableEdges: baseEdges,
      offPathCountByNode,
    };
  }

  const offPathEdges = data.edges.filter(
    (e) => e.childId === childId && !e.isBottleneck,
  );
  const offPathSiblingIds = new Set(offPathEdges.map((e) => e.parentId));
  const offPathSiblings: RenderableNode[] = data.nodes
    .filter((n) => offPathSiblingIds.has(n.id))
    .map((n) => ({
      id: n.id,
      name: n.name,
      lag: n.lag,
      isProbe: false,
      isBottleneck: false,
      offPathCount: 0,
    }));

  return {
    renderableNodes: [...baseNodes, ...offPathSiblings],
    renderableEdges: [...baseEdges, ...offPathEdges],
    offPathCountByNode,
  };
};
