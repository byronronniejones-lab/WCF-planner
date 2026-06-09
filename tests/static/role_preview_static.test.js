import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('admin role preview', () => {
  const auth = read('src/contexts/AuthContext.jsx');
  const header = read('src/shared/Header.jsx');

  it('keeps the preview client-side and scoped to a real admin user', () => {
    const previewRuntime = `${auth}\n${header}`;
    expect(auth).toContain('export const ROLE_PREVIEW_ROLES');
    for (const role of ['admin', 'management', 'farm_team', 'equipment_tech', 'light', 'inactive']) {
      expect(auth, `preview role ${role}`).toContain(`'${role}'`);
    }
    expect(auth).toMatch(/const \[realAuthState, setAuthState\] = useState\(null\)/);
    expect(auth).toMatch(/const canUseRolePreview = !!\(realAuthState[\s\S]*realAuthState\.role === 'admin'/);
    expect(auth).toMatch(/rolePreviewActive:\s*true/);
    expect(auth).toMatch(/realRole:\s*authState\.role/);
    expect(auth).toMatch(/profile:[\s\S]*\{\.\.\.authState\.profile, role: rolePreview\}/);
    expect(auth).not.toMatch(/localStorage|sessionStorage/);
    expect(previewRuntime).not.toMatch(/\b(?:sb|supabase)\.auth\.(?:setSession|updateUser|refreshSession|signIn)/);
    expect(auth).not.toMatch(/from\('profiles'\)[\s\S]*\.update\(/);
  });

  it('threads the effective auth state while preserving the real state for admin tools', () => {
    expect(auth).toMatch(/const authState = useMemo\(/);
    expect(auth).toMatch(/activeRolePreview \? withRolePreview\(realAuthState, activeRolePreview\) : realAuthState/);
    expect(auth).toMatch(/authState,\s*realAuthState,\s*setAuthState/);
    expect(auth).toMatch(/rolePreview:\s*activeRolePreview/);
    expect(auth).toMatch(/rolePreviewRoles:\s*ROLE_PREVIEW_ROLES/);
  });

  it('adds menu and banner controls that are gated by the real admin role', () => {
    expect(header).toMatch(/realAuthState[\s\S]*rolePreview[\s\S]*setRolePreview[\s\S]*clearRolePreview/);
    expect(header).toMatch(/function chooseRolePreview\(nextRole\)/);
    expect(header).toMatch(/\{canUseRolePreview && \([\s\S]*data-role-preview-menu="1"/);
    expect(header).toMatch(/data-role-preview-select="1"/);
    expect(header).toMatch(/\{canUseRolePreview && rolePreview && \([\s\S]*data-role-preview-banner="1"/);
    expect(header).toMatch(/Server permissions remain/);
    expect(header).toMatch(/data-role-preview-banner-select="1"/);
    expect(header).toMatch(/data-role-preview-exit="1"[\s\S]*chooseRolePreview\(''\)/);
  });

  it('does not weaken the existing effective-role nav gates', () => {
    expect(header).toMatch(/const isAdmin = authState\?\.role === 'admin'/);
    expect(header).toMatch(/const isLight = authState\?\.role === 'light'/);
  });
});
