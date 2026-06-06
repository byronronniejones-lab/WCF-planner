// ============================================================================
// WebformsConfigContext — webforms admin-panel config state
// ============================================================================
// Thin Provider for the webforms admin-panel config state. The default
// config blob (DEFAULT_WEBFORMS_CONFIG) is module-scope in main.jsx and
// threaded in as `configInit`.
//
//   wfGroups        : [{value,label}] — active pig group dropdown options
//   webformsConfig  : the full webforms admin config blob
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

const WebformsConfigContext = createContext(null);

export function WebformsConfigProvider({children, configInit}) {
  const [wfGroups, setWfGroups] = useState([]);
  const [webformsConfig, setWebformsConfig] = useState(configInit);

  const value = {
    wfGroups,
    setWfGroups,
    webformsConfig,
    setWebformsConfig,
  };
  return <WebformsConfigContext.Provider value={value}>{children}</WebformsConfigContext.Provider>;
}

export function useWebformsConfig() {
  return useContext(WebformsConfigContext);
}
