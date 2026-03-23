// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import { useQuery } from "@tanstack/react-query";
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { apiClient } from "~/api/apiClient";
import { useAppConfig } from "~/config/useAppConfig";
import { AuthProvider } from "~/external-library-wrappers/oidc";

export const OidcProviderWrapper = ({ children }: React.PropsWithChildren) => {
  const navigate = useNavigate();
  const appConfig = useAppConfig();

  const isOidc =
    appConfig.mode === "self-managed" && appConfig.authMode === "Oidc";

  const { data: oidcManager, isLoading } = useQuery({
    queryKey: ["oidc-manager"],
    queryFn: () => {
      if (apiClient.type !== "self-managed" || !apiClient.oidcManagerPromise) {
        return null;
      }
      return apiClient.oidcManagerPromise;
    },
    enabled: isOidc,
    staleTime: Infinity,
    retry: false,
  });

  const onSigninCallback = useCallback(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  if (isLoading) {
    return null;
  }

  const userManager = oidcManager?.getUserManager() ?? null;
  if (!userManager) {
    return children;
  }

  return (
    <AuthProvider userManager={userManager} onSigninCallback={onSigninCallback}>
      {children}
    </AuthProvider>
  );
};
