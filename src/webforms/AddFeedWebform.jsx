// Phase 2 Round 5 extraction (verbatim).
import React from 'react';

const AddFeedWebform = ({sb}) => {
  const [configLoaded, setConfigLoaded] = React.useState(false);
  const [wfCfg, setWfCfg] = React.useState(null);
  const [wfSettings, setWfSettings] = React.useState({});
  const [housingBatchMap, setHousingBatchMap] = React.useState({});
  const [broilerGroups, setBroilerGroups] = React.useState([]);
  const [pigGroups, setPigGroups] = React.useState([]);
  const [layerGroupNames, setLayerGroupNames] = React.useState([]);
  const [layerBatchIdMap, setLayerBatchIdMap] = React.useState({});
  const [allTeamMembers, setAllTeamMembers] = React.useState([]);
  const [perFormTM, setPerFormTM] = React.useState({});

  const [program, setProgram] = React.useState('');
  const [date, setDate] = React.useState('');
  const [batchLabel, setBatchLabel] = React.useState('');
  const [feedType, setFeedType] = React.useState('');
  const [feedLbs, setFeedLbs] = React.useState('');
  const [teamMember, setTeamMember] = React.useState(localStorage.getItem('wcf_team')||'');
  const [extraGroups, setExtraGroups] = React.useState([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState(false);
  // Cattle quick-log state (parallel to the poultry/pig fields above)
  const [cattleFeedInputs, setCattleFeedInputs] = React.useState([]);
  const [cattleHerd, setCattleHerd] = React.useState('');
  const [cattleRows, setCattleRows] = React.useState([{feedId:'', qty:'', isCreep:false}]);
  // Sheep quick-log state
  const [sheepFlock, setSheepFlock] = React.useState('');
  const [sheepBales, setSheepBales] = React.useState('');
  const [sheepAlfalfa, setSheepAlfalfa] = React.useState('');

  React.useEffect(function(){
    sb.from('cattle_feed_inputs').select('*').eq('status','active').order('category').order('name').then(function(res){
      if(res && res.data) setCattleFeedInputs(res.data);
    });
  },[]);

  React.useEffect(function(){
    var d=new Date();
    setDate(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
  },[]);

  React.useEffect(function(){
    Promise.all([
      sb.from('webform_config').select('data').eq('key','housing_batch_map').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','broiler_groups').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','active_groups').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','team_members').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','per_form_team_members').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','full_config').maybeSingle(),
      sb.from('webform_config').select('data').eq('key','webform_settings').maybeSingle(),
    ]).then(function(results){
      var hbm=results[0],bg=results[1],ag=results[2],tm=results[3],pftm=results[4],fc=results[5],ws=results[6];
      if(hbm&&hbm.data&&hbm.data.data) setHousingBatchMap(hbm.data.data);
      if(bg&&bg.data&&Array.isArray(bg.data.data)&&bg.data.data.length>0) setBroilerGroups(bg.data.data);
      if(ag&&ag.data&&Array.isArray(ag.data.data)&&ag.data.data.length>0) setPigGroups(ag.data.data);
      if(tm&&tm.data&&Array.isArray(tm.data.data)&&tm.data.data.length>0) setAllTeamMembers(tm.data.data);
      if(pftm&&pftm.data&&pftm.data.data) setPerFormTM(pftm.data.data);
      if(ws&&ws.data&&ws.data.data) setWfSettings(ws.data.data);
      if(fc&&fc.data&&fc.data.data){
        setWfCfg(fc.data.data);
        var lgAll=(fc.data.data.layerGroups||[]).filter(function(g){return g.status==='active';});
        var lg=lgAll.map(function(g){return g.name||g;});
        if(lg.length>0) setLayerGroupNames(lg);
        // Build name→id map for batch_id resolution
        var idMap={};
        lgAll.forEach(function(g){if(g.id&&g.name) idMap[g.name]=g.id;});
        // Also map housing names to batch IDs via housing_batch_map + layerGroups
        if(hbm&&hbm.data&&hbm.data.data){
          Object.entries(hbm.data.data).forEach(function(e){
            var batchName=e[1];
            var batch=lgAll.find(function(g2){return g2.name===batchName;});
            if(batch&&batch.id) idMap[e[0]]=batch.id;
          });
        }
        setLayerBatchIdMap(idMap);
        if((!tm||!tm.data||!tm.data.data||tm.data.data.length===0)&&fc.data.data.teamMembers&&fc.data.data.teamMembers.length>0){
          setAllTeamMembers(fc.data.data.teamMembers);
        }
      }
      setConfigLoaded(true);
    });
  },[]);

  // Admin config helpers
  var afWf=(wfCfg&&wfCfg.webforms||[]).find(function(w){return w.id==='add-feed-webform';})||null;
  function getField(fieldId){
    if(!afWf) return null;
    return (afWf.sections||[]).flatMap(function(s){return s.fields||[];}).find(function(f){return f.id===fieldId;})||null;
  }
  function isEnabled(fieldId){var f=getField(fieldId);return f?f.enabled!==false:true;}
  function isRequired(fieldId){var f=getField(fieldId);return f?f.required===true:false;}
  function getLabel(fieldId,fallback){var f=getField(fieldId);return(f&&f.label)||fallback;}
  function allowAddGroup(){
    if(wfSettings&&wfSettings.allowAddGroup&&'add-feed-webform' in wfSettings.allowAddGroup) return wfSettings.allowAddGroup['add-feed-webform']===true;
    return afWf?afWf.allowAddGroup===true:false;
  }
  var reqStar=function(fieldId){return isRequired(fieldId)?React.createElement('span',{style:{color:'#dc2626',marginLeft:2}},'*'):null;};

  function getBatchOptions(){
    if(program==='broiler') return broilerGroups;
    if(program==='pig') return pigGroups;
    if(program==='layer') return layerGroupNames;
    return [];
  }
  function getTeamMemberList(){
    var perForm=perFormTM['add-feed-webform'];
    if(Array.isArray(perForm)&&perForm.length>0) return perForm;
    if(afWf&&afWf.teamMembers&&afWf.teamMembers.length>0) return afWf.teamMembers;
    return allTeamMembers;
  }

  function buildRecord(bl,ft,fl){
    var id=String(Date.now())+Math.random().toString(36).slice(2,6);
    var now=new Date().toISOString();
    var lbs=parseFloat(fl)||0;
    if(program==='layer') return {id:id,submitted_at:now,date:date,team_member:teamMember||null,batch_label:bl,batch_id:layerBatchIdMap[bl]||null,feed_lbs:lbs,feed_type:ft||null,source:'add_feed_webform'};
    if(program==='broiler') return {id:id,submitted_at:now,date:date,team_member:teamMember||null,batch_label:bl,feed_lbs:lbs,feed_type:ft||null,source:'add_feed_webform'};
    return {id:id,submitted_at:now,date:date,team_member:teamMember||null,batch_label:bl,batch_id:bl.toLowerCase().replace(/[^a-z0-9]+/g,'-'),feed_lbs:lbs,source:'add_feed_webform'};
  }
  function getTable(){
    if(program==='layer') return 'layer_dailys';
    if(program==='broiler') return 'poultry_dailys';
    return 'pig_dailys';
  }

  function handleSubmit(){
    if(!date){setErr('Please enter a date.');return;}
    if(isRequired('team_member')&&!teamMember){setErr(getLabel('team_member','Team Member')+' is required.');return;}
    // Sheep-specific submit path
    if(program==='sheep'){
      if(!sheepFlock){setErr('Please select a flock.');return;}
      var baleNum=sheepBales!==''?parseFloat(sheepBales):null;
      var alfalfaNum=sheepAlfalfa!==''?parseFloat(sheepAlfalfa):null;
      if((baleNum==null||baleNum<=0)&&(alfalfaNum==null||alfalfaNum<=0)){
        setErr('Enter bales of hay, alfalfa lbs, or both.');return;
      }
      setErr('');setSubmitting(true);
      var sRec={
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        submitted_at: new Date().toISOString(),
        date: date,
        team_member: teamMember || null,
        flock: sheepFlock,
        bales_of_hay: baleNum,
        lbs_of_alfalfa: alfalfaNum,
        minerals_given: false,
        minerals_pct_eaten: null,
        fence_voltage_kv: null,
        waterers_working: null,
        mortality_count: 0,
        comments: null,
        source: 'add_feed_webform',
      };
      sb.from('sheep_dailys').insert(sRec).then(function(res){
        setSubmitting(false);
        if(res.error){setErr('Could not save: '+res.error.message);return;}
        if(teamMember) localStorage.setItem('wcf_team',teamMember);
        setDone(true);
      });
      return;
    }
    // Cattle-specific submit path
    if(program==='cattle'){
      if(!cattleHerd){setErr('Please select a herd.');return;}
      var filledRows=(cattleRows||[]).filter(function(r){return r.feedId && r.qty!=='' && r.qty!=null;});
      if(filledRows.length===0){setErr('Please enter at least one feed.');return;}
      var feedsJ=filledRows.map(function(r){
        var fi=cattleFeedInputs.find(function(x){return x.id===r.feedId;});
        if(!fi) return null;
        var qty=parseFloat(r.qty)||0;
        var unitWt=parseFloat(fi.unit_weight_lbs)||1;
        return {
          feed_input_id: fi.id,
          feed_name: fi.name,
          category: fi.category,
          qty: qty,
          unit: fi.unit,
          lbs_as_fed: Math.round(qty*unitWt*100)/100,
          is_creep: !!r.isCreep,
          nutrition_snapshot: {
            moisture_pct: fi.moisture_pct,
            nfc_pct: fi.nfc_pct,
            protein_pct: fi.protein_pct,
          },
        };
      }).filter(Boolean);
      setErr('');setSubmitting(true);
      var cRec={
        id: String(Date.now())+Math.random().toString(36).slice(2,6),
        submitted_at: new Date().toISOString(),
        date: date,
        team_member: teamMember || null,
        herd: cattleHerd,
        feeds: feedsJ,
        minerals: [],
        mortality_count: 0,
        source: 'add_feed_webform',
      };
      sb.from('cattle_dailys').insert(cRec).then(function(res){
        setSubmitting(false);
        if(res.error){setErr('Could not save: '+res.error.message);return;}
        if(teamMember) localStorage.setItem('wcf_team',teamMember);
        setDone(true);
      });
      return;
    }
    // Poultry/pig submit path
    if(!batchLabel){setErr('Please select a batch/group.');return;}
    if(isRequired('feed_lbs')&&(!feedLbs||parseFloat(feedLbs)<=0)){setErr(getLabel('feed_lbs','Feed (lbs)')+' is required.');return;}
    if(program!=='pig'&&isEnabled('feed_type')&&isRequired('feed_type')&&parseFloat(feedLbs)>0&&!feedType){setErr(getLabel('feed_type','Feed Type')+' is required when feed is entered.');return;}
    // Validate extra groups
    for(var i=0;i<extraGroups.length;i++){
      var eg=extraGroups[i];
      if(!eg.batchLabel) continue;
      if(isRequired('feed_lbs')&&(!eg.feedLbs||parseFloat(eg.feedLbs)<=0)){setErr(getLabel('feed_lbs','Feed (lbs)')+' is required for '+eg.batchLabel+'.');return;}
      if(program!=='pig'&&isEnabled('feed_type')&&isRequired('feed_type')&&parseFloat(eg.feedLbs)>0&&!eg.feedType){setErr(getLabel('feed_type','Feed Type')+' is required for '+eg.batchLabel+' when feed is entered.');return;}
    }
    setErr('');setSubmitting(true);
    var table=getTable();
    var recs=[buildRecord(batchLabel,feedType,feedLbs)];
    extraGroups.filter(function(g){return g.batchLabel;}).forEach(function(g){
      recs.push(buildRecord(g.batchLabel,g.feedType,g.feedLbs));
    });
    sb.from(table).insert(recs.length===1?recs[0]:recs).then(function(res){
      setSubmitting(false);
      if(res.error){setErr('Could not save: '+res.error.message);return;}
      if(teamMember) localStorage.setItem('wcf_team',teamMember);
      setDone(true);
    });
  }

  function resetForm(){setBatchLabel('');setFeedType('');setFeedLbs('');setExtraGroups([]);setCattleHerd('');setCattleRows([{feedId:'',qty:'',isCreep:false}]);setSheepFlock('');setSheepBales('');setSheepAlfalfa('');setErr('');setDone(false);}

  var wfBg={minHeight:'100vh',background:'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%)',padding:'1rem',fontFamily:'inherit'};
  var cardS={background:'white',borderRadius:12,padding:'20px',marginBottom:12,boxShadow:'0 1px 3px rgba(0,0,0,.08)'};
  var inpS={fontFamily:'inherit',fontSize:14,padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,width:'100%',outline:'none',background:'white',color:'#111827',boxSizing:'border-box'};
  var lblS={display:'block',fontSize:13,color:'#374151',marginBottom:5,fontWeight:500};
  var logoEl=(
    <div style={{textAlign:'center',marginBottom:20}}>
      <div style={{fontSize:18,fontWeight:800,color:'#085041',letterSpacing:-.3}}>{'\ud83c\udf3e WCF Planner'}</div>
      <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>Quick Feed Log</div>
    </div>
  );

  if(done) return (
    <div style={wfBg}>
      <div style={{maxWidth:480,margin:'0 auto',paddingTop:'2rem',textAlign:'center'}}>
        {logoEl}
        <div style={{fontSize:56,marginBottom:12}}>{'\u2705'}</div>
        <div style={{fontSize:20,fontWeight:700,color:'#111827',marginBottom:8}}>Feed logged!</div>
        <div style={{fontSize:14,color:'#4b5563',marginBottom:28,lineHeight:1.6}}>
          {program==='cattle'
            ? (cattleHerd+' \u2014 '+cattleRows.filter(function(r){return r.feedId&&r.qty;}).length+' feed entr'+(cattleRows.filter(function(r){return r.feedId&&r.qty;}).length===1?'y':'ies'))
            : program==='sheep'
              ? (sheepFlock+' \u2014 '+(sheepBales?sheepBales+' bales':'')+(sheepBales&&sheepAlfalfa?', ':'')+(sheepAlfalfa?sheepAlfalfa+' lb alfalfa':''))
            : (batchLabel+' \u2014 '+feedLbs+' lbs'+(feedType?' ('+feedType+')':''))+(extraGroups.filter(function(g){return g.batchLabel;}).length>0?(' + '+extraGroups.filter(function(g){return g.batchLabel;}).length+' more'):'')
          }
        </div>
        <button onClick={resetForm} style={{width:'100%',padding:14,borderRadius:10,border:'none',background:'#085041',color:'white',fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:'inherit',marginBottom:10}}>
          Log Another
        </button>
        <button onClick={function(){window.location.hash='#webforms';window.location.reload();}} style={{width:'100%',padding:14,borderRadius:10,border:'1px solid #d1d5db',background:'white',color:'#374151',fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
          Done
        </button>
      </div>
    </div>
  );

  // Render a feed group section (batch + feed type + lbs) — used for main and extras
  function renderFeedGroup(bl,ft,fl,onChange,idx){
    var batchOpts=getBatchOptions();
    return React.createElement('div',{key:idx!=null?'eg'+idx:'main'},
      React.createElement('div',{style:cardS},
        idx!=null&&React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}},
          React.createElement('div',{style:{fontSize:13,fontWeight:600,color:'#085041'}},getLabel('batch_label','Batch / Group')+' '+(idx+2)),
          React.createElement('button',{type:'button',onClick:function(){setExtraGroups(function(p){return p.filter(function(_,i){return i!==idx;});});},style:{background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:18}},'\u00d7')
        ),
        idx==null&&React.createElement('label',{style:lblS},getLabel('batch_label',program==='pig'?'Pig Group':program==='broiler'?'Broiler Batch':'Layer Group'),reqStar('batch_label')),
        React.createElement('select',{value:bl,onChange:function(e){onChange('batchLabel',e.target.value);},style:inpS},
          React.createElement('option',{value:''},'Select...'),
          batchOpts.map(function(b){var name=typeof b==='object'?(b.name||b.label||b.value||''):b;return React.createElement('option',{key:name,value:name},name);})
        ),
        program==='layer'&&bl&&housingBatchMap[bl]&&React.createElement('div',{style:{marginTop:6,fontSize:11,color:'#1d4ed8',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,padding:'4px 8px'}},'Active in batch: ',React.createElement('strong',null,housingBatchMap[bl]))
      ),
      program!=='pig'&&isEnabled('feed_type')&&React.createElement('div',{style:cardS},
        React.createElement('label',{style:lblS},getLabel('feed_type','Feed Type'),idx==null&&reqStar('feed_type')),
        React.createElement('div',{style:{display:'flex',borderRadius:8,overflow:'hidden',border:'1px solid #d1d5db'}},
          (program==='layer'?['STARTER','GROWER','LAYER']:['STARTER','GROWER']).map(function(f,fi,arr){
            return React.createElement('button',{key:f,type:'button',onClick:function(){onChange('feedType',ft===f?'':f);},style:{flex:1,padding:'10px 0',border:'none',borderRight:fi<arr.length-1?'1px solid #d1d5db':'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer',background:ft===f?'#085041':'white',color:ft===f?'white':'#6b7280'}},f);
          })
        )
      ),
      isEnabled('feed_lbs')&&React.createElement('div',{style:cardS},
        React.createElement('label',{style:lblS},getLabel('feed_lbs','Feed (lbs)'),idx==null&&reqStar('feed_lbs')),
        React.createElement('input',{type:'number',min:'0',step:'0.1',value:fl,onChange:function(e){onChange('feedLbs',e.target.value);},placeholder:'0',style:inpS})
      )
    );
  }

  return (
    <div style={wfBg}>
      <div style={{maxWidth:480,margin:'0 auto',paddingTop:'1rem'}}>
        {logoEl}

        <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:10,fontSize:12,color:'#085041',padding:'10px 16px',marginBottom:16}}>
          For quick feed logging only. For full daily reports including mortality and care checks, use the Daily Report forms.
        </div>

        <div style={cardS}>
          <label style={lblS}>{getLabel('date','Date')}{reqStar('date')}</label>
          <input type="date" value={date} onChange={function(e){setDate(e.target.value);}} style={inpS}/>
        </div>

        {isEnabled('team_member')&&(
          <div style={cardS}>
            <label style={lblS}>{getLabel('team_member','Team Member')}{reqStar('team_member')}</label>
            <select value={teamMember} onChange={function(e){setTeamMember(e.target.value);}} style={inpS}>
              <option value="">Select...</option>
              {getTeamMemberList().map(function(m){return <option key={m} value={m}>{m}</option>;})}
            </select>
          </div>
        )}

        <div style={cardS}>
          <label style={lblS}>Program</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:6}}>
            {[
              {key:'pig',icon:'\ud83d\udc37',label:'Pig',color:'#1e40af',bg:'#eff6ff'},
              {key:'broiler',icon:'\ud83d\udc14',label:'Broiler',color:'#a16207',bg:'#fef9c3'},
              {key:'layer',icon:'\ud83d\udc13',label:'Layer',color:'#78350f',bg:'#fffbeb'},
              {key:'cattle',icon:'\ud83d\udc04',label:'Cattle',color:'#991b1b',bg:'#fef2f2'},
              {key:'sheep',icon:'\ud83d\udc11',label:'Sheep',color:'#0f766e',bg:'#f0fdfa'},
            ].map(function(p){return (
              <button key={p.key} onClick={function(){setProgram(p.key);setBatchLabel('');setFeedType('');setExtraGroups([]);setCattleHerd('');setCattleRows([{feedId:'',qty:'',isCreep:false}]);setSheepFlock('');setSheepBales('');setSheepAlfalfa('');}} style={{
                padding:'10px 4px',borderRadius:10,cursor:'pointer',fontFamily:'inherit',
                border:program===p.key?'2px solid '+p.color:'2px solid #e5e7eb',
                background:program===p.key?p.bg:'white',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4
              }}>
                <span style={{fontSize:22}}>{p.icon}</span>
                <span style={{fontSize:11,fontWeight:600,color:p.color}}>{p.label}</span>
              </button>
            );})}
          </div>
        </div>

        {program&&program!=='cattle'&&program!=='sheep'&&renderFeedGroup(batchLabel,feedType,feedLbs,function(k,v){
          if(k==='batchLabel') setBatchLabel(v);
          else if(k==='feedType') setFeedType(v);
          else if(k==='feedLbs') setFeedLbs(v);
        },null)}

        {program&&program!=='cattle'&&program!=='sheep'&&extraGroups.map(function(eg,ei){
          return renderFeedGroup(eg.batchLabel||'',eg.feedType||'',eg.feedLbs||'',function(k,v){
            setExtraGroups(function(p){return p.map(function(g,i){if(i!==ei)return g;var n={};for(var x in g)n[x]=g[x];n[k]=v;return n;});});
          },ei);
        })}

        {program&&program!=='cattle'&&program!=='sheep'&&allowAddGroup()&&(
          <button type="button" onClick={function(){setExtraGroups(function(p){return p.concat([{batchLabel:'',feedType:'',feedLbs:''}]);});}} style={{width:'100%',padding:12,borderRadius:10,border:'2px dashed #a7f3d0',background:'transparent',color:'#085041',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',marginBottom:12}}>+ Add Another Group</button>
        )}

        {program==='cattle'&&(
          <React.Fragment>
            {/* Herd selector */}
            <div style={cardS}>
              <label style={lblS}>Herd<span style={{color:'#dc2626',marginLeft:2}}>*</span></label>
              <select value={cattleHerd} onChange={function(e){setCattleHerd(e.target.value);setCattleRows([{feedId:'',qty:'',isCreep:false}]);}} style={inpS}>
                <option value=''>Select herd...</option>
                <option value='mommas'>Mommas</option>
                <option value='backgrounders'>Backgrounders</option>
                <option value='finishers'>Finishers</option>
                <option value='bulls'>Bulls</option>
              </select>
            </div>

            {/* Feed rows — one per feed */}
            {cattleHerd&&(function(){
              var feedsForHerd = cattleFeedInputs.filter(function(f){return (f.herd_scope||[]).includes(cattleHerd);});
              var showCreep = cattleHerd==='mommas';
              return cattleRows.map(function(row,ri){
                var fi = cattleFeedInputs.find(function(x){return x.id===row.feedId;});
                return React.createElement('div',{key:ri,style:cardS},
                  cattleRows.length>1 && React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}},
                    React.createElement('div',{style:{fontSize:13,fontWeight:600,color:'#991b1b'}},'Feed '+(ri+1)),
                    React.createElement('button',{type:'button',onClick:function(){setCattleRows(cattleRows.filter(function(_,i){return i!==ri;}));},style:{background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:18}},'\u00d7')
                  ),
                  React.createElement('label',{style:lblS},'Feed Type'),
                  React.createElement('select',{value:row.feedId,onChange:function(e){setCattleRows(cattleRows.map(function(r,i){return i===ri?Object.assign({},r,{feedId:e.target.value}):r;}));},style:inpS},
                    React.createElement('option',{value:''},'Select feed...'),
                    feedsForHerd.map(function(f){return React.createElement('option',{key:f.id,value:f.id},f.name);})
                  ),
                  React.createElement('div',{style:{marginTop:10}},
                    React.createElement('label',{style:lblS},fi?'Qty ('+fi.unit+')':'Qty'),
                    React.createElement('input',{type:'number',min:'0',step:'0.1',value:row.qty,onChange:function(e){setCattleRows(cattleRows.map(function(r,i){return i===ri?Object.assign({},r,{qty:e.target.value}):r;}));},placeholder:'0',style:inpS})
                  ),
                  showCreep && row.feedId && React.createElement('label',{style:{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#7f1d1d',cursor:'pointer',marginTop:8,userSelect:'none'}},
                    React.createElement('input',{type:'checkbox',checked:!!row.isCreep,onChange:function(e){setCattleRows(cattleRows.map(function(r,i){return i===ri?Object.assign({},r,{isCreep:e.target.checked}):r;}));},style:{cursor:'pointer'}}),
                    'This was creep feed (for calves)'
                  )
                );
              });
            })()}

            {cattleHerd&&(
              <button type="button" onClick={function(){setCattleRows(cattleRows.concat([{feedId:'',qty:'',isCreep:false}]));}} style={{width:'100%',padding:12,borderRadius:10,border:'2px dashed #fca5a5',background:'transparent',color:'#991b1b',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',marginBottom:12}}>+ Add Feed</button>
            )}
          </React.Fragment>
        )}

        {program==='sheep'&&(
          <React.Fragment>
            <div style={cardS}>
              <label style={lblS}>Flock<span style={{color:'#dc2626',marginLeft:2}}>*</span></label>
              <select value={sheepFlock} onChange={function(e){setSheepFlock(e.target.value);}} style={inpS}>
                <option value=''>Select flock...</option>
                <option value='rams'>Rams</option>
                <option value='ewes'>Ewes</option>
                <option value='feeders'>Feeders</option>
              </select>
            </div>
            <div style={cardS}>
              <label style={lblS}>Bales of Hay</label>
              <input type="number" min="0" step="0.25" value={sheepBales} onChange={function(e){setSheepBales(e.target.value);}} placeholder="0" style={inpS}/>
            </div>
            <div style={cardS}>
              <label style={lblS}>Alfalfa (lbs)</label>
              <input type="number" min="0" value={sheepAlfalfa} onChange={function(e){setSheepAlfalfa(e.target.value);}} placeholder="0" style={inpS}/>
            </div>
            <div style={{fontSize:11,color:'#6b7280',textAlign:'center',marginBottom:12,fontStyle:'italic'}}>Enter bales, alfalfa, or both.</div>
          </React.Fragment>
        )}

        {err&&<div style={{color:'#b91c1c',fontSize:13,marginBottom:10,padding:'8px 12px',background:'#fef2f2',borderRadius:8}}>{err}</div>}

        {program&&(
          <button onClick={handleSubmit} disabled={submitting} style={{
            width:'100%',padding:14,border:'none',borderRadius:10,
            background:'#085041',color:'white',fontSize:15,fontWeight:600,
            cursor:submitting?'not-allowed':'pointer',opacity:submitting?.6:1,
            fontFamily:'inherit',marginBottom:16
          }}>
            {submitting?'Submitting\u2026':(1+extraGroups.filter(function(g){return g.batchLabel;}).length)>1?'Log '+(1+extraGroups.filter(function(g){return g.batchLabel;}).length)+' Feed Entries':'Log Feed'}
          </button>
        )}

        <div style={{textAlign:'center',marginTop:12}}>
          <button onClick={function(){window.location.hash='#webforms';window.location.reload();}} style={{background:'none',border:'none',color:'#085041',fontSize:13,cursor:'pointer',fontFamily:'inherit',textDecoration:'underline'}}>
            {'\u2190 Back to Daily Reports'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddFeedWebform;
