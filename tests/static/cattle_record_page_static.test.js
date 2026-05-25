import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const herdsView = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleHerdsView.jsx'), 'utf8');
const animalPage = fs.readFileSync(path.join(ROOT, 'src/cattle/CattleAnimalPage.jsx'), 'utf8');
const cowDetail = fs.readFileSync(path.join(ROOT, 'src/cattle/CowDetail.jsx'), 'utf8');
const collapsible = fs.readFileSync(path.join(ROOT, 'src/cattle/CollapsibleOutcomeSections.jsx'), 'utf8');
const mainJsx = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
const registry = fs.readFileSync(path.join(ROOT, 'src/lib/activityRegistry.js'), 'utf8');

describe('CattleHerdsView — no legacy Activity or inline CowDetail', () => {
  it('does not import ActivityPanel', () => {
    expect(herdsView).not.toMatch(/^import ActivityPanel/m);
  });
  it('does not import ActivityModal', () => {
    expect(herdsView).not.toMatch(/^import ActivityModal/m);
  });
  it('does not render CowDetail inline', () => {
    expect(herdsView).not.toMatch(/<CowDetail\b/);
  });
  it('does not have expandedCow state', () => {
    expect(herdsView).not.toContain('setExpandedCow');
  });
  it('does not have cowNavStack state', () => {
    expect(herdsView).not.toContain('cowNavStack');
  });
  it('does not query cattle_comments', () => {
    expect(herdsView).not.toContain("from('cattle_comments')");
  });
  it('navigates to /cattle/herds/<id> on tile click', () => {
    expect(herdsView).toContain("navigate('/cattle/herds/' + c.id)");
  });
  it('imports CattleAnimalPage for hub routing', () => {
    expect(herdsView).toContain('CattleAnimalPage');
  });
  it('parses /cattle/herds/<id> from URL', () => {
    expect(herdsView).toContain('/cattle/herds/');
  });
});

describe('CollapsibleOutcomeSections — no inline CowDetail', () => {
  it('does not render CowDetail JSX', () => {
    expect(collapsible).not.toMatch(/<CowDetail\b/);
  });
  it('does not accept renderCowDetail prop', () => {
    const propsBlock = collapsible.match(/const CollapsibleOutcomeSections = \(\{[\s\S]*?\}\) =>/);
    expect(propsBlock).not.toBeNull();
    expect(propsBlock[0]).not.toContain('renderCowDetail');
  });
  it('accepts onCowClick for navigation', () => {
    expect(collapsible).toContain('onCowClick');
  });
});

describe('CattleAnimalPage — record page structure', () => {
  it('renders CommentsSection', () => {
    expect(animalPage).toContain('CommentsSection');
    expect(animalPage).toContain('entityType="cattle.animal"');
  });
  it('does not import ActivityPanel or ActivityModal', () => {
    expect(animalPage).not.toMatch(/^import ActivityPanel/m);
    expect(animalPage).not.toMatch(/^import ActivityModal/m);
  });
  it('does not have an Activity comment composer', () => {
    expect(animalPage).not.toContain('postActivityComment');
    expect(animalPage).not.toContain('data-activity-compose');
  });
  it('has a collapsed Activity audit log', () => {
    expect(animalPage).toContain('data-activity-log-toggle');
    expect(animalPage).toContain('data-activity-audit-log');
  });
  it('filters out comment.posted from Activity events', () => {
    expect(animalPage).toContain("event_type !== 'comment.posted'");
  });
  it('does not load cattle_comments', () => {
    expect(animalPage).not.toContain("from('cattle_comments')");
  });
  it('passes hideComments to CowDetail', () => {
    expect(animalPage).toContain('hideComments={true}');
  });
  it('has a back link to /cattle/herds', () => {
    expect(animalPage).toContain("navigate('/cattle/herds')");
  });
  it('handles hash anchors for comment deep-links', () => {
    expect(animalPage).toContain('location.hash');
    expect(animalPage).toContain('scrollIntoView');
  });
});

describe('CowDetail — hideComments prop and Issues wording', () => {
  it('accepts hideComments prop', () => {
    expect(cowDetail).toContain('hideComments');
  });
  it('labels the legacy section as Issues not Comments', () => {
    expect(cowDetail).toContain('>Issues<');
    expect(cowDetail).not.toContain('>Comments Timeline<');
  });
  it('does not say "Add a comment..."', () => {
    expect(cowDetail).not.toContain('Add a comment...');
  });
  it('does not render "Comments Timeline" as user-visible section title', () => {
    expect(cowDetail).not.toContain('>Comments Timeline<');
  });
});

describe('CattleHerdsView — no dead commented imports', () => {
  it('has no commented CowDetail import', () => {
    expect(herdsView).not.toContain('// import CowDetail');
  });
  it('has no commented ActivityPanel import', () => {
    expect(herdsView).not.toContain('// import ActivityPanel');
  });
  it('has no commented ActivityModal import', () => {
    expect(herdsView).not.toContain('// import ActivityModal');
  });
  it('does not reference "comments timeline" in UI text', () => {
    expect(herdsView.toLowerCase()).not.toContain('comments timeline');
  });
});

describe('URL adapter — cattle herds sub-path', () => {
  it('detects /cattle/herds/<id> as a sub-path', () => {
    expect(mainJsx).toContain("location.pathname.startsWith('/cattle/herds/')");
  });
  it('preserves /cattle/herds/<id> in view→URL sync', () => {
    expect(mainJsx).toContain("view === 'cattleherds' && location.pathname.startsWith('/cattle/herds/')");
  });
});

describe('activityRegistry — cattle.animal route', () => {
  it('routes to /cattle/herds/<id> not /cattle/herds', () => {
    expect(registry).toMatch(/route:\s*\(id\)\s*=>\s*'\/cattle\/herds\/'\s*\+\s*id/);
  });
  it('routeToView handles /cattle/herds/<id> paths', () => {
    expect(registry).toContain("path.startsWith('/cattle/herds/')");
  });
  it('resolveNotificationRoute handles comment_mention', () => {
    expect(registry).toContain("type === 'comment_mention'");
    expect(registry).toContain('#comment-');
  });
});
