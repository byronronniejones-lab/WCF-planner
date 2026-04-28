// ============================================================================
// WebformsConfigContext — Phase 2.0.6
// ============================================================================
// Thin Provider for the webforms admin-panel config state. The default
// config blob (DEFAULT_WEBFORMS_CONFIG) is module-scope in main.jsx and
// threaded in as `configInit`.
//
//   wfGroups        : [{value,label}] — active pig group dropdown options
//   wfTeamMembers   : string[] — team member names
//   webformsConfig  : the full webforms admin config blob
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

const WebformsConfigContext = createContext(null);

export function WebformsConfigProvider({children, configInit}) {
  const [wfGroups, setWfGroups] = useState([]);
  const [wfTeamMembers, setWfTeamMembers] = useState([]);
  const [webformsConfig, setWebformsConfig] = useState(configInit);

  const value = {
    wfGroups,
    setWfGroups,
    wfTeamMembers,
    setWfTeamMembers,
    webformsConfig,
    setWebformsConfig,
  };
  return <WebformsConfigContext.Provider value={value}>{children}</WebformsConfigContext.Provider>;
}

export function useWebformsConfig() {
  return useContext(WebformsConfigContext);
}
