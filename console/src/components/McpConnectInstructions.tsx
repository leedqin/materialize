// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { BoxProps, Text, useTheme, VStack } from "@chakra-ui/react";
import { useAtom } from "jotai";
import React from "react";

import { useAppConfig } from "~/config/useAppConfig";
import { currentEnvironmentState } from "~/store/environments";
import { MaterializeTheme } from "~/theme";

import { CopyableBox, TabbedCodeBlock } from "./copyableComponents";

export interface McpConnectInstructionsProps extends BoxProps {
  userStr: string;
}

const mcpConfigJson = (
  baseUrl: string,
  endpoint: "agents" | "observatory",
  opts?: { includeType?: boolean },
) =>
  JSON.stringify(
    {
      mcpServers: {
        [`materialize-${endpoint}`]: {
          ...(opts?.includeType && { type: "http" }),
          url: `${baseUrl}/api/mcp/${endpoint}`,
          headers: {
            Authorization: "Basic <base64-token>",
          },
        },
      },
    },
    null,
    2,
  );

const McpConnectInstructions = ({
  userStr,
  ...props
}: McpConnectInstructionsProps) => {
  const { colors } = useTheme<MaterializeTheme>();
  const [currentEnvironment] = useAtom(currentEnvironmentState);
  const appConfig = useAppConfig();
  const isCloud = appConfig.mode === "cloud";

  const envAddress =
    currentEnvironment?.state === "enabled"
      ? currentEnvironment.httpAddress
      : undefined;

  if (!envAddress) return null;

  // Cloud: HTTPS with the environment's HTTP address hostname.
  // Self-managed: Use a placeholder since the MCP endpoint may be behind a
  // load balancer or custom domain that we can't determine from the console.
  const baseUrl = isCloud
    ? `https://${envAddress.split(":")[0]}`
    : "<your-materialize-host>";

  const user = userStr || "<user>";
  const base64Command = `printf '${user}:<password>' | base64`;
  const observatoryUrl = `${baseUrl}/api/mcp/observatory`;

  const agentsUrl = `${baseUrl}/api/mcp/agents`;
  const claudeCodeCliCommand = `claude mcp add --transport http materialize-agents ${agentsUrl} --header "Authorization: Basic <base64-token>"`;

  return (
    <VStack
      alignItems="stretch"
      spacing="4"
      p="6"
      overflowY="auto"
      maxHeight="60vh"
      {...props}
    >
      <Text fontSize="sm" color={colors.foreground.secondary}>
        Connect your AI agent or coding assistant to Materialize using the
        built-in MCP server.
      </Text>

      <VStack alignItems="stretch" spacing="2">
        <Text textStyle="heading-xs">Step 1. Get your Base64 token</Text>
        <Text fontSize="sm" color={colors.foreground.secondary}>
          {isCloud
            ? "Create an app password (under Account > App Passwords), then run the following in your terminal:"
            : "Use a SQL role with LOGIN and PASSWORD privileges. Run the following in your terminal:"}
        </Text>
        <CopyableBox variant="default" contents={base64Command} />
      </VStack>

      <VStack alignItems="stretch" spacing="2">
        <Text textStyle="heading-xs">Step 2. Connect your client</Text>
        <Text fontSize="sm" color={colors.foreground.secondary}>
          Replace <code>&lt;base64-token&gt;</code> with the output from Step 1.
        </Text>
        <TabbedCodeBlock
          tabs={[
            {
              title: "Claude Code",
              children: (
                <VStack alignItems="stretch" spacing="3" p="4">
                  <Text fontSize="xs" color={colors.foreground.secondary}>
                    Run this command in your terminal:
                  </Text>
                  <CopyableBox
                    variant="default"
                    contents={claudeCodeCliCommand}
                  />
                  <Text fontSize="xs" color={colors.foreground.secondary}>
                    Or save to <code>.mcp.json</code> in your project directory:
                  </Text>
                  <CopyableBox
                    variant="default"
                    contents={mcpConfigJson(baseUrl, "agents", {
                      includeType: true,
                    })}
                  />
                </VStack>
              ),
            },
            {
              title: "Claude Desktop",
              contents: mcpConfigJson(baseUrl, "agents"),
            },
            {
              title: "Cursor",
              contents: mcpConfigJson(baseUrl, "agents"),
            },
          ]}
        />
      </VStack>

      <VStack alignItems="stretch" spacing="1">
        <Text fontSize="sm" color={colors.foreground.secondary}>
          For observability (system catalog access), use the observatory
          endpoint instead:
        </Text>
        <CopyableBox variant="default" contents={observatoryUrl} />
      </VStack>
    </VStack>
  );
};

export default McpConnectInstructions;
