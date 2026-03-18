// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { type OidcConfig, type SelfManagedAuthMode } from "./AppConfig";

type AppConfigJson = {
  auth: {
    mode: SelfManagedAuthMode;
  };
};

const DEFAULT_APP_CONFIG = {
  auth: {
    mode: "None" as const,
  },
};

async function fetchAppConfigJson() {
  try {
    // app-config.json is how Orchestratord can propagate configuration changes to the client. Depending on the user's configuration, it'll rewrite
    // app-config.json. This is much simpler opposed to alternatives like creating an HTTP endpoint.
    return await (await fetch("/app-config/app-config.json")).json();
  } catch (error) {
    console.error("Failed to fetch app config", error);
    // If the fetch fails, fallback to the default app config that Cloud uses. This usually fails in Teleport impoersonation due to its reverse proxy not
    // properly routing the path to the app-config.json file.
    return DEFAULT_APP_CONFIG;
  }
}

interface ConsoleConfigResponse {
  oidc_issuer: string;
  console_oidc_client_id: string;
  console_oidc_scopes: string;
}

async function fetchOidcConfigFromEnvironmentd(): Promise<
  OidcConfig | undefined
> {
  try {
    const response = await fetch("/api/console/config");
    if (!response.ok) {
      console.error("Failed to fetch console config:", response.status);
      return undefined;
    }
    const data: ConsoleConfigResponse = await response.json();
    if (!data.oidc_issuer || !data.console_oidc_client_id) {
      return undefined;
    }
    return {
      issuer: data.oidc_issuer,
      clientId: data.console_oidc_client_id,
      scopes: data.console_oidc_scopes || "openid profile email",
    };
  } catch (error) {
    console.error("Failed to fetch OIDC config from environmentd", error);
    return undefined;
  }
}

const appConfigJson = await fetchAppConfigJson();

export function importAppConfig(): AppConfigJson {
  if (process.env.NODE_ENV === "test") {
    return DEFAULT_APP_CONFIG;
  }

  return appConfigJson as AppConfigJson;
}

export async function importOidcConfig(): Promise<OidcConfig | undefined> {
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }
  return fetchOidcConfigFromEnvironmentd();
}
