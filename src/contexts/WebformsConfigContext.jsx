// ============================================================================
// WebformsConfigContext — Phase 2.0.6 + Team Member Master List Cleanup
// ============================================================================
// Thin Provider for the webforms admin-panel config state. The default
// config blob (DEFAULT_WEBFORMS_CONFIG) is module-scope in main.jsx and
// threaded in as `configInit`.
//
//   wfGroups        : [{value,label}] — active pig group dropdown options
//   wfRoster        : [{id,name,active}] — canonical team-member roster
//                     (loaded from webform_config.team_roster, legacy
//                     fallback to webform_config.team_members)
//   wfTeamMembers   : string[] — derived view of active names from
//                     wfRoster, kept around for back-compat consumers
//                     during the team-member cleanup transition
//   webformsConfig  : the full webforms admin config blob
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

import {activeNames} from '../lib/teamMembers.js';

const WebformsConfigContext = createContext(null);

export function WebformsConfigProvider({children, configInit}) {
  const [wfGroups, setWfGroups] = useState([]);
  const [wfRoster, setWfRosterState] = useState([]);
  const [wfTeamMembers, setWfTeamMembers] = useState([]);
  const [webformsConfig, setWebformsConfig] = useState(configInit);

  // Roster setter that also updates the legacy active-name list so existing
  // consumers (PigDailysWebform etc.) keep rendering correctly without
  // touching their code paths in Pass A.
  const setWfRoster = (next) => {
    setWfRosterState(next);
    setWfTeamMembers(activeNames(next));
  };

  const value = {
    wfGroups,
    setWfGroups,
    wfRoster,
    setWfRoster,
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
