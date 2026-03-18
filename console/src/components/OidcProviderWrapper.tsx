// Copyright Materialize, Inc. and contributors. All rights reserved.
//
// Use of this software is governed by the Business Source License
// included in the LICENSE file.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0.

import React, { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { apiClient } from "~/api/apiClient";
import { AuthProvider } from "~/external-library-wrappers/oidc";

export const OidcProviderWrapper = ({ children }: React.PropsWithChildren) => {
  const navigate = useNavigate();

  const userManager = useMemo(() => {
    if (apiClient.type !== "self-managed") return null;
    return apiClient.oidcManager?.getUserManager() ?? null;
  }, []);

  const onSigninCallback = useCallback(() => {
    // After the OIDC provider redirects back, navigate to "/" to clear
    // the callback URL params and let the auth guard take over.
    navigate("/", { replace: true });
  }, [navigate]);

  if (!userManager) {
    return children;
  }

  return (
    <AuthProvider userManager={userManager} onSigninCallback={onSigninCallback}>
      {children}
    </AuthProvider>
  );
};
