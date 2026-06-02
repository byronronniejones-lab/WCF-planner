import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const viewSrc = fs.readFileSync(path.join(ROOT, 'src/pig/PigDailysView.jsx'), 'utf8');

describe('PigDailysView hub cold-boot readiness', () => {
  it('owns a local records load instead of rendering directly from the app pigDailys prop', () => {
    expect(viewSrc).toContain('const [records, setRecords] = useState([]);');
    expect(viewSrc).toContain('const [loading, setLoading] = useState(true);');
    expect(viewSrc).not.toMatch(/\bpigDailys\b/);
    expect(viewSrc).toMatch(/from\('pig_dailys'\)[\s\S]*?\.select\('\*'\)[\s\S]*?\.is\('deleted_at', null\)/);
    expect(viewSrc).toMatch(/\.order\('date', \{ascending: false\}\)[\s\S]*?\.range\(from, from \+ PAGE - 1\)/);
    expect(viewSrc).toContain('all.push(...data);');
    expect(viewSrc).toContain('setRecords(all);');
    expect(viewSrc).toContain('setPigDailys && setPigDailys(all);');
  });

  it('fails closed on load errors and exposes a stable readiness marker', () => {
    expect(viewSrc).toContain('const [loadError, setLoadError] = useState(null);');
    expect(viewSrc).toContain('setRecords([]);');
    expect(viewSrc).toContain('setPigDailys && setPigDailys([]);');
    expect(viewSrc).toContain('Could not load daily reports. Please refresh the page.');
    expect(viewSrc).toContain("data-pig-dailys-loaded={loading || loadError ? 'false' : 'true'}");
  });

  it('shows a non-dismissible loadError notice and user-gated Retry', () => {
    expect(viewSrc).toContain('<InlineNotice notice={loadError} />');
    expect(viewSrc).not.toContain('<InlineNotice notice={loadError} onDismiss');
    expect(viewSrc).toContain('const [reloadKey, setReloadKey] = useState(0);');
    expect(viewSrc).toMatch(/data-daily-list-retry="1"[\s\S]*?onClick=\{\(\) => setReloadKey\(\(k\) => k \+ 1\)\}/);
    expect(viewSrc).toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[reloadKey\]\);/);
  });

  it('does not render empty-state or row content while loading or loadError is active', () => {
    expect(viewSrc).toMatch(/loading && <div[\s\S]*?>Loading\.\.\.<\/div>/);
    expect(viewSrc).toContain('!loading && !loadError && records.length === 0');
    expect(viewSrc).toContain('!loading && !loadError && records.length > 0 && filtered.length === 0');
    expect(viewSrc).toContain('!loading && !loadError && filtered.length > 0');
  });
});
