// Phase 2 Round 3 extraction (verbatim).
import React from 'react';
import UsersModal from '../auth/UsersModal.jsx';
import CattleBulkImport from './CattleBulkImport.jsx';
import CowDetail from './CowDetail.jsx';
import CollapsibleOutcomeSections from './CollapsibleOutcomeSections.jsx';
import { loadCattleWeighInsCached } from '../lib/cattleCache.js';
const CattleHerdsView = ({sb, fmt, Header, authState, setView, showUsers, setShowUsers, allUsers, setAllUsers, loadUsers, pendingEdit, setPendingEdit}) => {
  const {useState, useEffect} = React;
  const [cattle, setCattle] = useState([]);
  const [weighIns, setWeighIns] = useState([]);
  const [calvingRecs, setCalvingRecs] = useState([]);
  const [comments, setComments] = useState([]);
  const [breedOpts, setBreedOpts] = useState([]);
  const [originOpts, setOriginOpts] = useState([]);
  const [processingBatches, setProcessingBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // active | all | mommas | backgrounders | finishers | bulls | processed | deceased | sold
  const [sortBy, setSortBy] = useState('tag-asc');

  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedCow, setExpandedCow] = useState(null);
  const [expandedHerds, setExpandedHerds] = useState({});
  // Navigation stack for clicking into calving/dam/sire links — lets the
  // cow detail panel show a "← Back to #X" button to return to the prior cow.
  const [cowNavStack, setCowNavStack] = useState([]);

  const HERDS = ['mommas','backgrounders','finishers','bulls'];
  const OUTCOMES = ['processed','deceased','sold'];
  const ALL_HERDS = [...HERDS, ...OUTCOMES];
  const HERD_LABELS = {mommas:'Mommas', backgrounders:'Backgrounders', finishers:'Finishers', bulls:'Bulls', processed:'Processed', deceased:'Deceased', sold:'Sold'};
  const HERD_COLORS = {mommas:{bg:'#fef2f2',tx:'#991b1b',bd:'#fca5a5'}, backgrounders:{bg:'#ffedd5',tx:'#9a3412',bd:'#fdba74'}, finishers:{bg:'#fff1f2',tx:'#9f1239',bd:'#fda4af'}, bulls:{bg:'#fee2e2',tx:'#7f1d1d',bd:'#fca5a5'}, processed:{bg:'#f3f4f6',tx:'#374151',bd:'#d1d5db'}, deceased:{bg:'#f9fafb',tx:'#6b7280',bd:'#e5e7eb'}, sold:{bg:'#eff6ff',tx:'#1e40af',bd:'#bfdbfe'}};

  const EMPTY_COW = {
    tag:'', sex:'cow', herd:'mommas', breed:'', breeding_blacklist:false,
    pct_wagyu:'', origin:'', birth_date:'', purchase_date:'', purchase_amount:'',
    dam_tag:'', sire_tag:'', registration_num:'',
    breeding_status:'',
    maternal_issue_flag:false, maternal_issue_desc:'',
    sale_date:'', sale_amount:'', death_date:'', death_reason:'',
    old_tags:[],  // [{tag, changed_at, source}] — source ∈ 'import'|'weigh_in'|'manual'
  };

  async function loadAll() {
    const [cR, wAll, calR, comR, brR, orR, pbR] = await Promise.all([
      sb.from('cattle').select('*').order('tag'),
      loadCattleWeighInsCached(sb),  // already sorted entered_at desc
      sb.from('cattle_calving_records').select('*').order('calving_date',{ascending:false}),
      sb.from('cattle_comments').select('*').order('created_at',{ascending:false}),
      sb.from('cattle_breeds').select('*').order('label'),
      sb.from('cattle_origins').select('*').order('label'),
      sb.from('cattle_processing_batches').select('id,name,actual_process_date,planned_process_date'),
    ]);
    if(cR.data) setCattle(cR.data);
    setWeighIns(wAll);
    if(calR.data) setCalvingRecs(calR.data);
    if(comR.data) setComments(comR.data);
    if(brR.data) setBreedOpts(brR.data);
    if(orR.data) setOriginOpts(orR.data);
    if(pbR.data) setProcessingBatches(pbR.data);
    setLoading(false);
  }
  useEffect(()=>{ loadAll(); }, []);

  function age(birth) {
    if(!birth) return null;
    const ms = Date.now() - new Date(birth+'T12:00:00').getTime();
    const days = Math.floor(ms/86400000);
    if(days < 0) return null;
    const y = Math.floor(days/365);
    const m = Math.floor((days%365)/30);
    if(y > 0) return y+'y '+m+'m';
    return m+'m';
  }
  function ageAtDate(birth, endDate) {
    if(!birth || !endDate) return null;
    const ms = new Date(endDate+'T12:00:00').getTime() - new Date(birth+'T12:00:00').getTime();
    const days = Math.floor(ms/86400000);
    if(days < 0) return null;
    const y = Math.floor(days/365);
    const m = Math.floor((days%365)/30);
    if(y > 0) return y+'y '+m+'m';
    return m+'m';
  }
  // For a processed cow, return { date, age } using the linked batch's
  // actual_process_date (fall back to planned_process_date if actual is null).
  function processingInfo(cow) {
    if(!cow || cow.herd !== 'processed' || !cow.processing_batch_id) return null;
    const b = processingBatches.find(pb => pb.id === cow.processing_batch_id);
    if(!b) return null;
    const date = b.actual_process_date || b.planned_process_date;
    if(!date) return null;
    return { date, age: ageAtDate(cow.birth_date, date) };
  }
  function cowTagSet(cow) {
    // Includes current WCF tag + prior WCF tags (source='weigh_in' retags).
    // Excludes purchase-farm tags (source='import') because those are the
    // selling farm's numbers and can collide with other WCF cows' tags.
    const set = new Set();
    if(cow && cow.tag) set.add(cow.tag);
    if(cow && Array.isArray(cow.old_tags)) {
      for(const ot of cow.old_tags) {
        if(!ot || !ot.tag) continue;
        if(ot.source === 'import') continue;
        set.add(ot.tag);
      }
    }
    return set;
  }
  function lastWeight(cow) {
    const tags = cowTagSet(cow);
    if(tags.size === 0) return null;
    const w = weighIns.find(x => tags.has(x.tag));
    return w ? parseFloat(w.weight) : null;
  }
  // For aggregate herd weight: cows without a weigh-in fall back to 1,000 lb
  // so a freshly-imported group still feeds into the per-herd live-weight
  // total. Scope: only cows purchased within last 120 days — older un-weighed
  // records (calves, legacy data gaps) contribute 0. Per-cow rows still show
  // "no weigh-in" honestly; this fallback is aggregate-only.
  const HERD_TILE_DEFAULT_COW_WEIGHT = 1000;
  const HERD_TILE_ESTIMATE_DAYS = 120;
  function isHerdTileRecentlyPurchased(cow) {
    if(!cow || !cow.purchase_date) return false;
    const ms = Date.now() - new Date(cow.purchase_date+'T12:00:00').getTime();
    return ms >= 0 && ms <= HERD_TILE_ESTIMATE_DAYS * 86400000;
  }
  function effectiveWeight(cow) {
    const real = lastWeight(cow);
    if(real != null && real > 0) return real;
    return isHerdTileRecentlyPurchased(cow) ? HERD_TILE_DEFAULT_COW_WEIGHT : 0;
  }
  // Jump to another cow's detail (called from calving / dam / sire links).
  // Pushes the currently-open cow onto a back stack so the detail panel can
  // render a "← Back" button. Handles both tile mode (active herds) and
  // flat mode (outcome herds) by adjusting filter + ensuring the target's
  // herd tile is expanded.
  function navigateToCow(target, fromCowId) {
    if(!target || !target.id) return;
    if(fromCowId && fromCowId !== target.id) setCowNavStack(s => [...s, fromCowId]);
    if(HERDS.includes(target.herd)) {
      setSearch('');
      setStatusFilter('active');
      setExpandedHerds(prev => ({...prev, [target.herd]: true}));
    } else {
      // Outcome herd — put the cow in flat-list view filtered to that outcome
      setSearch('');
      setStatusFilter(target.herd);
    }
    setExpandedCow(target.id);
    setTimeout(() => {
      const el = document.getElementById('cow-'+target.id);
      if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
    }, 80);
  }
  function navigateBack() {
    if(cowNavStack.length === 0) { setExpandedCow(null); return; }
    const prevId = cowNavStack[cowNavStack.length-1];
    const prev = cattle.find(c => c.id === prevId);
    setCowNavStack(s => s.slice(0, -1));
    if(prev) {
      if(HERDS.includes(prev.herd)) {
        setStatusFilter('active');
        setExpandedHerds(p => ({...p, [prev.herd]: true}));
      } else {
        setStatusFilter(prev.herd);
      }
      setExpandedCow(prev.id);
      setTimeout(() => {
        const el = document.getElementById('cow-'+prev.id);
        if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
      }, 80);
    } else {
      setExpandedCow(null);
    }
  }
  function lastCalving(tag) {
    if(!tag) return null;
    return calvingRecs.find(r => r.dam_tag === tag);
  }
  function calfCount(tag) {
    return cattle.filter(c => c.dam_tag === tag).length;
  }

  // Filter + sort. When the user is actively searching, relax the default
  // 'active' restriction so outcome cows (processed/deceased/sold) match too.
  // Explicit per-herd filters still apply.
  const filtered = cattle.filter(c => {
    const searching = !!search;
    if(!searching && statusFilter === 'active' && !HERDS.includes(c.herd)) return false;
    if(statusFilter !== 'all' && statusFilter !== 'active' && c.herd !== statusFilter) return false;
    if(searching) {
      const s = search.toLowerCase().trim();
      const fields = [c.tag, c.dam_tag, c.sire_tag, c.breed, c.origin].map(x => (x||'').toLowerCase());
      if(!fields.some(f => f.includes(s))) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a,b) => {
    if(sortBy === 'tag-asc') return (parseFloat(a.tag)||0) - (parseFloat(b.tag)||0) || (a.tag||'').localeCompare(b.tag||'');
    if(sortBy === 'tag-desc') return (parseFloat(b.tag)||0) - (parseFloat(a.tag)||0) || (b.tag||'').localeCompare(a.tag||'');
    if(sortBy === 'age-asc') return (a.birth_date||'9999').localeCompare(b.birth_date||'9999');
    if(sortBy === 'age-desc') return (b.birth_date||'').localeCompare(a.birth_date||'');
    if(sortBy === 'weight-desc') return (lastWeight(b)||0) - (lastWeight(a)||0);
    if(sortBy === 'weight-asc') return (lastWeight(a)||0) - (lastWeight(b)||0);
    return 0;
  });

  function openAdd() {
    setForm({...EMPTY_COW});
    setEditId(null);
    setShowAddForm(true);
  }
  function openEdit(cow) {
    setForm({...EMPTY_COW, ...cow,
      pct_wagyu: cow.pct_wagyu != null ? String(cow.pct_wagyu) : '',
      purchase_amount: cow.purchase_amount != null ? String(cow.purchase_amount) : '',
      sale_amount: cow.sale_amount != null ? String(cow.sale_amount) : '',
      birth_date: cow.birth_date || '',
      purchase_date: cow.purchase_date || '',
      sale_date: cow.sale_date || '',
      death_date: cow.death_date || '',
      breeding_status: cow.breeding_status || '',
      maternal_issue_desc: cow.maternal_issue_desc || '',
      old_tags: Array.isArray(cow.old_tags) ? cow.old_tags.map(function(t){
        return {
          tag: t.tag || '',
          // changed_at can be a full ISO string or just YYYY-MM-DD; strip to date for the picker.
          changed_at: (t.changed_at||'').slice(0,10),
          source: t.source || 'manual',
        };
      }) : [],
    });
    setEditId(cow.id);
    setShowAddForm(true);
  }
  async function saveCow() {
    if(!form.tag.trim() && form.herd !== 'mommas') {
      // Allow tagless calves only when herd is mommas
    }
    if(!form.tag.trim()) {
      if(!confirm('Save cow without a tag? (For unweaned calves; admin can tag later.)')) return;
    }
    setSaving(true);
    const isFemale = form.sex === 'cow' || form.sex === 'heifer';
    const rec = {
      tag: form.tag.trim() || null,
      sex: form.sex,
      herd: form.herd,
      breed: form.breed || null,
      breeding_blacklist: !!form.breeding_blacklist,
      pct_wagyu: form.pct_wagyu !== '' ? parseInt(form.pct_wagyu) : null,
      origin: form.origin || null,
      birth_date: form.birth_date || null,
      purchase_date: form.purchase_date || null,
      purchase_amount: form.purchase_amount !== '' ? parseFloat(form.purchase_amount) : null,
      dam_tag: form.dam_tag || null,
      sire_tag: form.sire_tag || null,
      registration_num: form.registration_num || null,
      breeding_status: isFemale ? (form.breeding_status || null) : null,
      maternal_issue_flag: !!form.maternal_issue_flag,
      maternal_issue_desc: form.maternal_issue_desc || null,
      sale_date: form.sale_date || null,
      sale_amount: form.sale_amount !== '' ? parseFloat(form.sale_amount) : null,
      death_date: form.death_date || null,
      death_reason: form.death_reason || null,
      // Clean + persist prior-tag entries. Drop empty tags; keep date + source
      // so the original import stamp survives intact when admin edits other fields.
      old_tags: (Array.isArray(form.old_tags) ? form.old_tags : [])
        .map(function(t){
          var tag = String(t.tag||'').trim();
          if(!tag) return null;
          var out = { tag: tag };
          if(t.changed_at) out.changed_at = t.changed_at.length === 10 ? (t.changed_at + 'T12:00:00.000Z') : t.changed_at;
          if(t.source) out.source = t.source;
          return out;
        })
        .filter(Boolean),
    };
    if(form.maternal_issue_flag && !(form.maternal_issue_desc||'').trim()) {
      alert('Maternal issue description is required when the flag is set.');
      setSaving(false); return;
    }
    let newId = editId;
    if(editId) {
      const {error} = await sb.from('cattle').update(rec).eq('id', editId);
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    } else {
      newId = (rec.tag ? 'c-'+rec.tag : 'c-'+Date.now()) + '-' + Math.random().toString(36).slice(2,5);
      const {error} = await sb.from('cattle').insert({id:newId, ...rec});
      if(error) { alert('Save failed: '+error.message); setSaving(false); return; }
    }
    setSaving(false);
    await loadAll();
    setShowAddForm(false);
    setEditId(null);
    setForm(null);
  }
  async function deleteCow(id) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Permanently delete this cow record? Weigh-ins, calving records, comments, and transfer history will also be deleted (cascade).', async () => {
      await sb.from('cattle').delete().eq('id', id);
      await loadAll();
      setShowAddForm(false);
      setEditId(null);
      setForm(null);
      setExpandedCow(null);
    });
  }
  async function transferCow(id, newHerd) {
    const cow = cattle.find(c => c.id === id);
    if(!cow) return;
    const oldHerd = cow.herd;
    const updates = {herd: newHerd};
    if(newHerd === 'deceased' && !cow.death_date) updates.death_date = new Date().toISOString().slice(0,10);
    if(newHerd === 'sold' && !cow.sale_date) updates.sale_date = new Date().toISOString().slice(0,10);
    await sb.from('cattle').update(updates).eq('id', id);
    await sb.from('cattle_transfers').insert({
      id: String(Date.now())+Math.random().toString(36).slice(2,6),
      cattle_id: id,
      from_herd: oldHerd,
      to_herd: newHerd,
      reason: 'manual',
      team_member: authState && authState.name ? authState.name : null,
    });
    await loadAll();
  }
  async function addQuickComment(cattleId, cattleTag, text) {
    if(!text.trim()) return;
    await sb.from('cattle_comments').insert({
      id: String(Date.now())+Math.random().toString(36).slice(2,6),
      cattle_id: cattleId,
      cattle_tag: cattleTag,
      comment: text.trim(),
      team_member: authState && authState.name ? authState.name : null,
      source: 'manual',
    });
    await loadAll();
  }
  async function editComment(id, newText) {
    if(!newText.trim()) return;
    await sb.from('cattle_comments').update({comment: newText.trim()}).eq('id', id);
    await loadAll();
  }
  async function deleteComment(id) {
    if(!window._wcfConfirmDelete) {
      if(!window.confirm('Delete this comment?')) return;
      await sb.from('cattle_comments').delete().eq('id', id);
      await loadAll();
      return;
    }
    window._wcfConfirmDelete('Delete this comment?', async () => {
      await sb.from('cattle_comments').delete().eq('id', id);
      await loadAll();
    });
  }
  async function addCalvingRecord(cow, formData) {
    if(!formData.calving_date) { alert('Calving date required.'); return false; }
    if(formData.complications_flag && !(formData.complications_desc||'').trim()) {
      alert('Complications description required when complications flag is set.'); return false;
    }
    const id = String(Date.now())+Math.random().toString(36).slice(2,6);
    const rec = {
      id,
      dam_tag: cow.tag,
      calving_date: formData.calving_date,
      calf_tag: formData.calf_tag || null,
      sire_tag: formData.sire_tag || null,
      total_born: parseInt(formData.total_born) || 0,
      deaths: parseInt(formData.deaths) || 0,
      complications_flag: !!formData.complications_flag,
      complications_desc: formData.complications_desc || null,
      notes: formData.notes || null,
    };
    const {error} = await sb.from('cattle_calving_records').insert(rec);
    if(error) { alert('Save failed: '+error.message); return false; }
    // Auto-publish a comment on the dam's timeline
    try {
      const note = rec.total_born+' born'+(rec.deaths>0?', '+rec.deaths+' died':'')+(rec.calf_tag?', calf #'+rec.calf_tag:'')+(rec.complications_flag?' [complications: '+rec.complications_desc+']':'');
      await sb.from('cattle_comments').insert({
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        cattle_id: cow.id,
        cattle_tag: cow.tag,
        comment: note,
        team_member: authState && authState.name ? authState.name : null,
        source: 'calving',
        reference_id: id,
      });
    } catch(e){ /* table may not exist */ }
    await loadAll();
    return true;
  }
  async function deleteCalvingRecord(recId) {
    if(!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this calving record?', async () => {
      await sb.from('cattle_calving_records').delete().eq('id', recId);
      await loadAll();
    });
  }

  const inpS = {fontSize:13, padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontFamily:'inherit', width:'100%', boxSizing:'border-box'};
  const lbl = {fontSize:11, color:'#6b7280', display:'block', marginBottom:3, fontWeight:500};

  // Determine if we're in flat-list mode (filtered/searched) or per-herd-tile mode
  const isFlatMode = search || (statusFilter !== 'active');

  return (
    <div style={{minHeight:'100vh', background:'#f1f3f2'}}>
      {showUsers && <UsersModal sb={sb} authState={authState} allUsers={allUsers} setAllUsers={setAllUsers} setShowUsers={setShowUsers} loadUsers={loadUsers}/>}
      <Header/>
      <div style={{padding:'1rem', maxWidth:1200, margin:'0 auto'}}>
        {/* Top toolbar */}
        <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:10, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by tag, dam, sire, breed, origin..." style={{...inpS, flex:1, minWidth:200}}/>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{...inpS, width:'auto'}}>
            <option value='active'>All Active Herds</option>
            <option value='all'>All (including outcomes)</option>
            <option disabled>{'\u2500\u2500\u2500'}</option>
            {HERDS.map(h => <option key={h} value={h}>{HERD_LABELS[h]}</option>)}
            <option disabled>{'\u2500\u2500\u2500'}</option>
            {OUTCOMES.map(h => <option key={h} value={h}>{HERD_LABELS[h]}</option>)}
          </select>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inpS, width:'auto'}}>
            <option value='tag-asc'>Tag {'\u2191'}</option>
            <option value='tag-desc'>Tag {'\u2193'}</option>
            <option value='age-asc'>Age (youngest first)</option>
            <option value='age-desc'>Age (oldest first)</option>
            <option value='weight-desc'>Weight {'\u2193'}</option>
            <option value='weight-asc'>Weight {'\u2191'}</option>
          </select>
          <button onClick={()=>setShowBulkImport(true)} style={{padding:'7px 14px', borderRadius:7, border:'1px solid #991b1b', background:'white', color:'#991b1b', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>{'\ud83d\udce5'} Bulk Import</button>
          <button onClick={openAdd} style={{padding:'7px 16px', borderRadius:7, border:'none', background:'#991b1b', color:'white', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>+ Add Cow</button>
        </div>

        {showBulkImport && <CattleBulkImport
          sb={sb}
          breedOpts={breedOpts}
          originOpts={originOpts}
          existingCattle={cattle}
          onClose={()=>setShowBulkImport(false)}
          onComplete={loadAll}
        />}

        {loading && <div style={{textAlign:'center', padding:'3rem', color:'#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && cattle.length === 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'2rem', textAlign:'center', color:'#6b7280', fontSize:13}}>
            No cattle records yet. Click <strong>+ Add Cow</strong> to add your first one, or wait for the Podio import.
          </div>
        )}

        {/* FLAT MODE — search or non-active filter */}
        {!loading && isFlatMode && cattle.length > 0 && (
          <div style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden'}}>
            <div style={{padding:'10px 16px', borderBottom:'1px solid #e5e7eb', background:'#f9fafb', fontSize:12, fontWeight:600, color:'#4b5563'}}>{sorted.length} cattle match</div>
            {sorted.length === 0 && <div style={{padding:'2rem', textAlign:'center', color:'#9ca3af', fontSize:13}}>No cattle match the current filter.</div>}
            {sorted.map((c, i) => {
              const hc = HERD_COLORS[c.herd] || HERD_COLORS.mommas;
              const lw = lastWeight(c);
              const isExpanded = expandedCow === c.id;
              const cTags = cowTagSet(c);
              const cowWeighIns = weighIns.filter(w => cTags.has(w.tag));
              const cowCalving = calvingRecs.filter(r => r.dam_tag === c.tag);
              const cowComments = comments.filter(cm => cm.cattle_id === c.id || cm.cattle_tag === c.tag).slice(0, 20);
              return (
                <div key={c.id} id={'cow-'+c.id} style={{borderBottom:i<sorted.length-1?'1px solid #f3f4f6':'none'}}>
                  <div onClick={()=>setExpandedCow(isExpanded?null:c.id)} style={{padding:'10px 16px 10px 0', display:'grid', gridTemplateColumns:'48px 16px 70px 110px 60px 180px 70px 90px 1fr', alignItems:'center', gap:10, cursor:'pointer', background:c.breeding_blacklist?'#fecaca':'white'}} className="hoverable-tile">
                    <span style={{fontSize:11, color:'#9ca3af', fontVariantNumeric:'tabular-nums', alignSelf:'stretch', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:10, paddingLeft:8, marginTop:-10, marginBottom:-10, borderRight:'1px solid #d1d5db', fontWeight:600}}>{i+1}</span>
                    <span style={{fontSize:11, color:'#9ca3af'}}>{isExpanded?'\u25bc':'\u25b6'}</span>
                    <span style={{fontWeight:700, fontSize:13, color:'#111827'}}>{c.tag ? '#'+c.tag : '(no tag)'}</span>
                    <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:hc.bg, color:hc.tx, border:'1px solid '+hc.bd, fontWeight:600, textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{HERD_LABELS[c.herd]}</span>
                    <span style={{fontSize:11, color:'#6b7280'}}>{c.sex||'\u2014'}</span>
                    <span style={{fontSize:11, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{c.breed||'\u2014'}</span>
                    <span style={{fontSize:11, color:'#6b7280'}}>{age(c.birth_date)||'\u2014'}</span>
                    <span style={{fontSize:11, color:lw?'#065f46':'#9ca3af', fontWeight:lw?600:400}}>{lw ? lw.toLocaleString()+' lb' : 'no weigh-in'}</span>
                    <span style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                      {c.dam_tag && <span style={{fontSize:11, color:'#9ca3af'}}>{'dam #'+c.dam_tag}</span>}
                      {c.maternal_issue_flag && <span style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c', fontWeight:600}}>MATERNAL ISSUE</span>}
                      {c.breeding_blacklist && <span style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c', fontWeight:600}}>BLACKLIST</span>}
                    </span>
                  </div>
                  {isExpanded && <CowDetail
                    cow={c}
                    weighIns={cowWeighIns}
                    calving={cowCalving}
                    comments={cowComments}
                    calves={cattle.filter(x => x.dam_tag === c.tag)}
                    dam={cattle.find(x => x.tag === c.dam_tag)}
                    cattleList={cattle}
                    fmt={fmt}
                    HERDS={ALL_HERDS}
                    HERD_LABELS={HERD_LABELS}
                    HERD_COLORS={HERD_COLORS}
                    onEdit={()=>openEdit(c)}
                    onTransfer={(newHerd)=>transferCow(c.id, newHerd)}
                    onDelete={()=>deleteCow(c.id)}
                    onComment={(text)=>addQuickComment(c.id, c.tag, text)}
                    onEditComment={editComment}
                    onDeleteComment={deleteComment}
                    onAddCalving={(data)=>addCalvingRecord(c, data)}
                    onDeleteCalving={(id)=>deleteCalvingRecord(id)}
                    onNavigateToCow={(target)=>navigateToCow(target, c.id)}
                    onNavigateBack={navigateBack}
                    canNavigateBack={cowNavStack.length > 0}
                    backToTag={cowNavStack.length > 0 ? (cattle.find(x => x.id === cowNavStack[cowNavStack.length-1])||{}).tag : null}
                  />}
                </div>
              );
            })}
          </div>
        )}

        {/* HERD TILES MODE — default view */}
        {!loading && !isFlatMode && cattle.length > 0 && (
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {HERDS.map(h => {
              const cows = sorted.filter(c => c.herd === h);
              const totalWt = cows.reduce((s,c) => s + effectiveWeight(c), 0);
              const estCount = cows.filter(c => (lastWeight(c) == null || lastWeight(c) === 0) && isHerdTileRecentlyPurchased(c)).length;
              const hc = HERD_COLORS[h];
              const herdOpen = !!expandedHerds[h];
              return (
                <div key={h} style={{background:'white', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden'}}>
                  <div onClick={()=>setExpandedHerds({...expandedHerds, [h]:!herdOpen})} style={{padding:'12px 18px', background:hc.bg, borderBottom:herdOpen?'1px solid '+hc.bd:'none', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', cursor:'pointer'}}>
                    <span style={{fontSize:12, color:hc.tx}}>{herdOpen?'\u25bc':'\u25b6'}</span>
                    <span style={{fontSize:15, fontWeight:700, color:hc.tx}}>{'\ud83d\udc04 '+HERD_LABELS[h]}</span>
                    <span style={{fontSize:12, color:hc.tx, opacity:.8}}>{cows.length} {cows.length===1?'cow':'cows'}</span>
                    {totalWt > 0 && <span style={{fontSize:12, color:hc.tx, opacity:.8}}>{'\u00b7 '+Math.round(totalWt).toLocaleString()+' lbs total'}</span>}
                    {estCount > 0 && <span style={{fontSize:11, color:hc.tx, opacity:.7, fontStyle:'italic'}}>{'('+estCount+' est. @ 1,000 lb)'}</span>}
                  </div>
                  {herdOpen && cows.length === 0 && <div style={{padding:'1rem 18px', color:'#9ca3af', fontSize:12, fontStyle:'italic'}}>No cows in this herd yet.</div>}
                  {herdOpen && cows.map((c, cowIdx) => {
                    const lw = lastWeight(c);
                    const lc = lastCalving(c.tag);
                    const cc = calfCount(c.tag);
                    const isExpanded = expandedCow === c.id;
                    const cTags = cowTagSet(c);
                    const cowWeighIns = weighIns.filter(w => cTags.has(w.tag));
                    const cowCalving = calvingRecs.filter(r => r.dam_tag === c.tag);
                    const cowComments = comments.filter(cm => cm.cattle_id === c.id || cm.cattle_tag === c.tag).slice(0, 20);
                    return (
                      <div key={c.id} id={'cow-'+c.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                        <div onClick={()=>setExpandedCow(isExpanded?null:c.id)} style={{padding:'10px 18px 10px 0', display:'grid', gridTemplateColumns:'48px 16px 70px 60px 180px 70px 90px 1fr', alignItems:'center', gap:10, cursor:'pointer', background:c.breeding_blacklist?'#fecaca':'transparent'}} className="hoverable-tile">
                          <span style={{fontSize:11, color:'#9ca3af', fontVariantNumeric:'tabular-nums', alignSelf:'stretch', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:10, paddingLeft:8, marginTop:-10, marginBottom:-10, borderRight:'1px solid #d1d5db', fontWeight:600}}>{cowIdx+1}</span>
                          <span style={{fontSize:11, color:'#9ca3af'}}>{isExpanded?'\u25bc':'\u25b6'}</span>
                          <span style={{fontWeight:700, fontSize:13, color:'#111827'}}>{c.tag ? '#'+c.tag : '(no tag)'}</span>
                          <span style={{fontSize:11, color:'#6b7280'}}>{c.sex||'\u2014'}</span>
                          <span style={{fontSize:11, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{c.breed||'\u2014'}</span>
                          <span style={{fontSize:11, color:'#6b7280'}}>{age(c.birth_date)||'\u2014'}</span>
                          <span style={{fontSize:11, color:lw?'#065f46':'#9ca3af', fontWeight:lw?600:400}}>{lw ? lw.toLocaleString()+' lb' : '\u2014'}</span>
                          <span style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                            {h === 'mommas' && cc > 0 && <span style={{fontSize:11, color:'#7f1d1d', fontWeight:600}}>{cc+' '+(cc===1?'calf':'calves')}</span>}
                            {h === 'mommas' && lc && <span style={{fontSize:11, color:'#9ca3af'}}>{'last calved '+fmt(lc.calving_date)}</span>}
                            {c.maternal_issue_flag && <span style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c', fontWeight:600}}>MATERNAL</span>}
                            {c.breeding_blacklist && <span style={{fontSize:10, padding:'1px 6px', borderRadius:4, background:'#fef2f2', color:'#b91c1c', fontWeight:600}}>BLACKLIST</span>}
                          </span>
                        </div>
                        {isExpanded && <CowDetail
                          cow={c}
                          weighIns={cowWeighIns}
                          calving={cowCalving}
                          comments={cowComments}
                          calves={cattle.filter(x => x.dam_tag === c.tag)}
                          dam={cattle.find(x => x.tag === c.dam_tag)}
                          cattleList={cattle}
                          fmt={fmt}
                          HERDS={ALL_HERDS}
                          HERD_LABELS={HERD_LABELS}
                          HERD_COLORS={HERD_COLORS}
                          onEdit={()=>openEdit(c)}
                          onTransfer={(newHerd)=>transferCow(c.id, newHerd)}
                          onDelete={()=>deleteCow(c.id)}
                          onComment={(text)=>addQuickComment(c.id, c.tag, text)}
                          onEditComment={editComment}
                          onDeleteComment={deleteComment}
                          onAddCalving={(data)=>addCalvingRecord(c, data)}
                          onDeleteCalving={(id)=>deleteCalvingRecord(id)}
                          onNavigateToCow={(target)=>navigateToCow(target, c.id)}
                          onNavigateBack={navigateBack}
                          canNavigateBack={cowNavStack.length > 0}
                          backToTag={cowNavStack.length > 0 ? (cattle.find(x => x.id === cowNavStack[cowNavStack.length-1])||{}).tag : null}
                        />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {/* Outcome herds shown collapsed at the bottom */}
            <CollapsibleOutcomeSections
              cattle={cattle}
              weighIns={weighIns}
              HERD_COLORS={HERD_COLORS}
              HERD_LABELS={HERD_LABELS}
              OUTCOMES={OUTCOMES}
              fmt={fmt}
              setStatusFilter={setStatusFilter}
              processingInfo={processingInfo}
              expandedCow={expandedCow}
              setExpandedCow={setExpandedCow}
              renderCowDetail={(c) => {
                const cTags = cowTagSet(c);
                const cowWeighIns = weighIns.filter(w => cTags.has(w.tag));
                const cowCalving = calvingRecs.filter(r => r.dam_tag === c.tag);
                const cowComments = comments.filter(cm => cm.cattle_id === c.id || cm.cattle_tag === c.tag).slice(0, 20);
                return <CowDetail
                  cow={c}
                  weighIns={cowWeighIns}
                  calving={cowCalving}
                  comments={cowComments}
                  calves={cattle.filter(x => x.dam_tag === c.tag)}
                  dam={cattle.find(x => x.tag === c.dam_tag)}
                  cattleList={cattle}
                  fmt={fmt}
                  HERDS={ALL_HERDS}
                  HERD_LABELS={HERD_LABELS}
                  HERD_COLORS={HERD_COLORS}
                  onEdit={()=>openEdit(c)}
                  onTransfer={(newHerd)=>transferCow(c.id, newHerd)}
                  onDelete={()=>deleteCow(c.id)}
                  onComment={(text)=>addQuickComment(c.id, c.tag, text)}
                  onEditComment={editComment}
                  onDeleteComment={deleteComment}
                  onAddCalving={(data)=>addCalvingRecord(c, data)}
                  onDeleteCalving={(id)=>deleteCalvingRecord(id)}
                  onNavigateToCow={(target)=>navigateToCow(target, c.id)}
                  onNavigateBack={navigateBack}
                  canNavigateBack={cowNavStack.length > 0}
                  backToTag={cowNavStack.length > 0 ? (cattle.find(x => x.id === cowNavStack[cowNavStack.length-1])||{}).tag : null}
                />;
              }}
            />
          </div>
        )}
      </div>

      {/* Add/Edit cow modal */}
      {showAddForm && form && (
        <div onClick={()=>{setShowAddForm(false); setEditId(null); setForm(null);}} style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,.45)', zIndex:500, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'1rem', overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'white', borderRadius:12, width:'100%', maxWidth:640, boxShadow:'0 8px 32px rgba(0,0,0,.2)', marginTop:40}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontSize:15, fontWeight:600, color:'#991b1b'}}>{editId ? 'Edit Cow' : 'Add Cow'}</div>
              <button onClick={()=>{setShowAddForm(false); setEditId(null); setForm(null);}} style={{background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9ca3af'}}>{'\u00d7'}</button>
            </div>
            <div style={{padding:'16px 20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, maxHeight:'70vh', overflowY:'auto'}}>
              <div><label style={lbl}>Tag #</label><input value={form.tag} onChange={e=>setForm({...form, tag:e.target.value})} placeholder="Required (or blank for unweaned calf)" style={inpS}/></div>
              <div><label style={lbl}>Sex</label>
                <select value={form.sex} onChange={e=>setForm({...form, sex:e.target.value})} style={inpS}>
                  <option value='cow'>Cow</option><option value='heifer'>Heifer</option><option value='bull'>Bull</option><option value='steer'>Steer</option>
                </select>
              </div>
              <div><label style={lbl}>Herd *</label>
                <select value={form.herd} onChange={e=>setForm({...form, herd:e.target.value})} style={inpS}>
                  {ALL_HERDS.map(h => <option key={h} value={h}>{HERD_LABELS[h]}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Breed</label>
                <select value={form.breed||''} onChange={e=>setForm({...form, breed:e.target.value})} style={inpS}>
                  <option value=''>{'\u2014 select \u2014'}</option>
                  {breedOpts.filter(function(b){return b.active;}).map(function(b){return React.createElement('option',{key:b.id,value:b.label},b.label);})}
                  {form.breed && !breedOpts.some(function(b){return b.active && b.label===form.breed;}) && (
                    <option value={form.breed}>{form.breed+' (historical)'}</option>
                  )}
                </select>
              </div>
              <div><label style={lbl}>% Wagyu</label><input type="number" min="0" max="100" value={form.pct_wagyu} onChange={e=>setForm({...form, pct_wagyu:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Origin</label>
                <select value={form.origin||''} onChange={function(e){
                    var v=e.target.value;
                    if(v==='__add__'){
                      var name=(window.prompt('New origin name:')||'').trim();
                      if(!name) return;
                      var exists=originOpts.find(function(o){return o.label.toLowerCase()===name.toLowerCase();});
                      if(exists){ setForm({...form, origin:exists.label}); return; }
                      var id='origin-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
                      sb.from('cattle_origins').insert({id:id,label:name,active:true}).then(function(){
                        setOriginOpts([...originOpts,{id:id,label:name,active:true}].sort(function(a,b){return a.label.localeCompare(b.label);}));
                        setForm({...form, origin:name});
                      });
                      return;
                    }
                    setForm({...form, origin:v});
                  }} style={inpS}>
                  <option value=''>{'\u2014 select \u2014'}</option>
                  {originOpts.filter(function(o){return o.active;}).map(function(o){return React.createElement('option',{key:o.id,value:o.label},o.label);})}
                  {form.origin && !originOpts.some(function(o){return o.active && o.label===form.origin;}) && (
                    <option value={form.origin}>{form.origin}</option>
                  )}
                  <option value='__add__'>{'+ Add new origin\u2026'}</option>
                </select>
              </div>
              <div><label style={lbl}>Birth Date</label><input type="date" value={form.birth_date} onChange={e=>setForm({...form, birth_date:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Purchase Date</label><input type="date" value={form.purchase_date} onChange={e=>setForm({...form, purchase_date:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Purchase Amount ($)</label><input type="number" min="0" step="0.01" value={form.purchase_amount} onChange={e=>setForm({...form, purchase_amount:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Dam Tag #</label><input value={form.dam_tag} onChange={e=>setForm({...form, dam_tag:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Sire Tag # / Reg #</label><input value={form.sire_tag} onChange={e=>setForm({...form, sire_tag:e.target.value})} style={inpS}/></div>
              <div><label style={lbl}>Registration #</label><input value={form.registration_num} onChange={e=>setForm({...form, registration_num:e.target.value})} style={inpS}/></div>
              {(form.sex==='cow'||form.sex==='heifer') && (
                <div><label style={lbl}>Breeding Status</label>
                  <select value={form.breeding_status||''} onChange={e=>setForm({...form, breeding_status:e.target.value})} style={inpS}>
                    <option value=''>{'\u2014 not set \u2014'}</option>
                    <option value='OPEN'>Open</option>
                    <option value='PREGNANT'>Pregnant</option>
                    <option value='N/A'>N/A</option>
                  </select>
                </div>
              )}

              {/* Prior Tags — purchase tag + any replacement-tag history */}
              <div style={{gridColumn:'1/-1', borderTop:'1px solid #e5e7eb', paddingTop:12, marginTop:4}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
                  <label style={{...lbl, margin:0, fontSize:12, fontWeight:600, color:'#374151', textTransform:'uppercase', letterSpacing:.5}}>Prior Tags</label>
                  <button type="button" onClick={()=>setForm({...form, old_tags:[...(form.old_tags||[]), {tag:'', changed_at:'', source:'manual'}]})} style={{fontSize:11, color:'#1d4ed8', background:'none', border:'1px dashed #bfdbfe', borderRadius:5, padding:'3px 10px', cursor:'pointer', fontFamily:'inherit'}}>+ Add Prior Tag</button>
                </div>
                <div style={{fontSize:11, color:'#6b7280', marginBottom:8}}>Tags this cow had before her current one. Purchase tag from the selling farm, replacement tags from retags over time. Multiple entries supported.</div>
                {(form.old_tags||[]).length === 0 && <div style={{fontSize:11, color:'#9ca3af', fontStyle:'italic', padding:'4px 0'}}>No prior tags recorded.</div>}
                {(form.old_tags||[]).map(function(t, ti){
                  return (
                    <div key={ti} style={{display:'grid', gridTemplateColumns:'100px 140px 1fr 30px', gap:8, marginBottom:6, alignItems:'center'}}>
                      <input type="text" placeholder="Tag #" value={t.tag||''} onChange={function(e){
                        var next = (form.old_tags||[]).slice();
                        next[ti] = {...next[ti], tag:e.target.value};
                        setForm({...form, old_tags:next});
                      }} style={{...inpS, fontSize:12, padding:'6px 8px'}}/>
                      <input type="date" value={t.changed_at||''} onChange={function(e){
                        var next = (form.old_tags||[]).slice();
                        next[ti] = {...next[ti], changed_at:e.target.value};
                        setForm({...form, old_tags:next});
                      }} style={{...inpS, fontSize:12, padding:'6px 8px'}}/>
                      <select value={t.source||'manual'} onChange={function(e){
                        var next = (form.old_tags||[]).slice();
                        next[ti] = {...next[ti], source:e.target.value};
                        setForm({...form, old_tags:next});
                      }} style={{...inpS, fontSize:12, padding:'6px 8px'}}>
                        <option value='import'>Purchase tag (selling farm)</option>
                        <option value='weigh_in'>Replacement tag (retag)</option>
                        <option value='manual'>Other / manual entry</option>
                      </select>
                      <button type="button" title="Remove" onClick={function(){
                        var next = (form.old_tags||[]).filter(function(_,i){return i!==ti;});
                        setForm({...form, old_tags:next});
                      }} style={{background:'none', border:'1px solid #F09595', borderRadius:5, color:'#b91c1c', cursor:'pointer', fontSize:14, lineHeight:1, padding:'4px 6px', fontFamily:'inherit'}}>{'\u00d7'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{gridColumn:'1/-1', borderTop:'1px solid #e5e7eb', paddingTop:12, marginTop:4, display:'flex', flexDirection:'column', gap:10}}>
                <label style={{display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'#7f1d1d', fontWeight:600, alignSelf:'flex-start'}}>
                  <input type="checkbox" checked={!!form.maternal_issue_flag} onChange={e=>setForm({...form, maternal_issue_flag:e.target.checked})}/>
                  <span>Maternal issue flag</span>
                </label>
                {form.maternal_issue_flag && (
                  <div style={{marginLeft:26}}>
                    <label style={lbl}>Description *</label>
                    <textarea value={form.maternal_issue_desc} onChange={e=>setForm({...form, maternal_issue_desc:e.target.value})} rows={2} style={{...inpS, resize:'vertical'}}/>
                  </div>
                )}
                <label style={{display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'#7f1d1d', fontWeight:600, alignSelf:'flex-start'}}>
                  <input type="checkbox" checked={!!form.breeding_blacklist} onChange={e=>setForm({...form, breeding_blacklist:e.target.checked})}/>
                  <span>Breeding blacklist</span>
                </label>
                <div style={{fontSize:11, color:'#9ca3af', marginLeft:26, marginTop:-4}}>Use the comments timeline to record why.</div>
              </div>

              {(form.herd === 'sold' || form.sale_date) && (
                <React.Fragment>
                  <div><label style={lbl}>Sale Date</label><input type="date" value={form.sale_date} onChange={e=>setForm({...form, sale_date:e.target.value})} style={inpS}/></div>
                  <div><label style={lbl}>Sale Amount ($)</label><input type="number" min="0" step="0.01" value={form.sale_amount} onChange={e=>setForm({...form, sale_amount:e.target.value})} style={inpS}/></div>
                </React.Fragment>
              )}
              {(form.herd === 'deceased' || form.death_date) && (
                <React.Fragment>
                  <div><label style={lbl}>Death Date</label><input type="date" value={form.death_date} onChange={e=>setForm({...form, death_date:e.target.value})} style={inpS}/></div>
                  <div><label style={lbl}>Death Reason</label><input value={form.death_reason} onChange={e=>setForm({...form, death_reason:e.target.value})} style={inpS}/></div>
                </React.Fragment>
              )}

            </div>
            <div style={{padding:'12px 20px', borderTop:'1px solid #e5e7eb', display:'flex', gap:8}}>
              <button onClick={saveCow} disabled={saving} style={{padding:'8px 20px', borderRadius:7, border:'none', background:'#991b1b', color:'white', fontWeight:600, fontSize:13, cursor:saving?'not-allowed':'pointer', fontFamily:'inherit', opacity:saving?.6:1}}>{saving ? 'Saving\u2026' : (editId ? 'Save' : 'Add Cow')}</button>
              {editId && <button onClick={()=>deleteCow(editId)} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #F09595', background:'white', color:'#b91c1c', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Delete</button>}
              <button onClick={()=>{setShowAddForm(false); setEditId(null); setForm(null);}} style={{padding:'8px 16px', borderRadius:7, border:'1px solid #d1d5db', background:'white', color:'#6b7280', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CattleHerdsView;
