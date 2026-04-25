// FuelReconcileView — month-by-month reconciliation. Compares bill gallons
// (from fuel_bills + fuel_bill_lines, grouped by delivery_date month) vs
// supply gallons (from fuel_supplies, grouped by date month).
//
// "Bill gal" is what the supplier actually delivered. "Supply gal" is what
// operators logged at /fueling/supply when fuel arrived. They should match
// closely; variance >5% (configurable) gets a warning chip.

import React from 'react';
import { sb } from '../lib/supabase.js';

const FUEL_TYPES = ['diesel', 'gasoline', 'def'];
const VARIANCE_WARN_PCT = 5;

function monthKey(dateStr) {
  if (!dateStr) return null;
  return String(dateStr).slice(0, 7);  // YYYY-MM
}
function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[parseInt(m, 10) - 1] + ' ' + y;
}
function money(n) {
  if (n == null || n === 0) return '—';
  return '$' + Number(n).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

export default function FuelReconcileView() {
  const [loading, setLoading] = React.useState(true);
  const [missingSchema, setMissingSchema] = React.useState(false);
  const [bills, setBills] = React.useState([]);
  const [billLines, setBillLines] = React.useState([]);
  const [supplies, setSupplies] = React.useState([]);

  async function load() {
    setLoading(true);
    const [billsRes, linesRes, supRes] = await Promise.all([
      sb.from('fuel_bills').select('*').order('delivery_date', {ascending: false}).limit(2000),
      sb.from('fuel_bill_lines').select('*').limit(10000),
      sb.from('fuel_supplies').select('*').order('date', {ascending: false}).limit(10000),
    ]);
    if (billsRes.error && /does not exist|relation/i.test(billsRes.error.message || '')) {
      setMissingSchema(true); setLoading(false); return;
    }
    setBills(billsRes.data || []);
    setBillLines(linesRes.data || []);
    setSupplies(supRes.data || []);
    setLoading(false);
  }
  React.useEffect(() => { load(); }, []);

  if (missingSchema) {
    return <div style={{padding:20, fontSize:13, color:'#b91c1c'}}>fuel_bills table missing. Apply supabase-migrations/026_fuel_bills.sql in the SQL Editor first.</div>;
  }
  if (loading) return <div style={{padding:20, fontSize:13, color:'#6b7280'}}>Loading…</div>;

  // Group everything by month.
  const billsById = Object.fromEntries(bills.map(b => [b.id, b]));
  const months = new Map(); // yyyy-mm → {bill:{diesel,gasoline,def,cost}, sup:{diesel,gasoline,def,cost}, billCount, supCount}

  function ensureMonth(k) {
    if (!months.has(k)) months.set(k, {
      bill: {diesel:0, gasoline:0, def:0, cost:0},
      sup:  {diesel:0, gasoline:0, def:0, cost:0},
      billCount: 0,
      supCount: 0,
    });
    return months.get(k);
  }

  for (const ln of billLines) {
    const bill = billsById[ln.bill_id];
    const k = monthKey(bill && bill.delivery_date);
    if (!k) continue;
    const m = ensureMonth(k);
    const t = ln.fuel_type;
    if (t && m.bill[t] != null) m.bill[t] += Number(ln.net_units) || 0;
    m.bill.cost += Number(ln.line_total) || 0;
  }
  for (const b of bills) {
    const k = monthKey(b.delivery_date);
    if (!k) continue;
    ensureMonth(k).billCount += 1;
  }

  for (const s of supplies) {
    const k = monthKey(s.date);
    if (!k) continue;
    const m = ensureMonth(k);
    const t = s.fuel_type;
    if (t && m.sup[t] != null) m.sup[t] += Number(s.gallons) || 0;
    m.sup.cost += Number(s.total_cost) || 0;
    m.supCount += 1;
  }

  const sorted = Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const card = {background:'white', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 18px', marginBottom:14};
  const th = {fontSize:10, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:.4, padding:'6px 10px', textAlign:'left', background:'#f9fafb', borderBottom:'1px solid #e5e7eb'};
  const td = {fontSize:12, padding:'8px 10px', borderBottom:'1px solid #f3f4f6', color:'#111827'};

  function variancePct(billGal, supGal) {
    if (billGal === 0 && supGal === 0) return null;
    if (billGal === 0) return null;  // bill missing — variance undefined
    return ((supGal - billGal) / billGal) * 100;
  }
  function varColor(pct) {
    if (pct == null) return '#9ca3af';
    if (Math.abs(pct) <= VARIANCE_WARN_PCT) return '#065f46';
    if (Math.abs(pct) <= VARIANCE_WARN_PCT * 2) return '#9a3412';
    return '#b91c1c';
  }

  return (
    <div>
      <div style={{...card, background:'#f0fdf4', borderColor:'#86efac'}}>
        <div style={{fontSize:12, color:'#065f46'}}>
          <strong>How this works:</strong> bills (Home Oil etc.) are grouped by delivery month, supply rows (logged at <code>/fueling/supply</code>) are grouped by entry month. They should match closely. Variance &gt; {VARIANCE_WARN_PCT}% gets a warning. Cost column on the bill side is the all-in (post-tax) total; cost on supply side is what operators typed in.
        </div>
      </div>

      <div style={{...card, padding:0, overflow:'auto'}}>
        {sorted.length === 0 ? (
          <div style={{padding:30, textAlign:'center', color:'#9ca3af', fontSize:13}}>No bills or supplies yet.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:1100}}>
            <thead>
              <tr>
                <th rowSpan={2} style={th}>Month</th>
                <th colSpan={4} style={{...th, borderBottom:'1px solid #d1d5db', textAlign:'center'}}>Bill (delivered)</th>
                <th colSpan={4} style={{...th, borderBottom:'1px solid #d1d5db', textAlign:'center'}}>Supply (logged)</th>
                <th colSpan={3} style={{...th, borderBottom:'1px solid #d1d5db', textAlign:'center'}}>Variance %</th>
              </tr>
              <tr>
                <th style={{...th, textAlign:'right'}}>Diesel</th>
                <th style={{...th, textAlign:'right'}}>Gas</th>
                <th style={{...th, textAlign:'right'}}>DEF</th>
                <th style={{...th, textAlign:'right'}}>Cost</th>
                <th style={{...th, textAlign:'right'}}>Diesel</th>
                <th style={{...th, textAlign:'right'}}>Gas</th>
                <th style={{...th, textAlign:'right'}}>DEF</th>
                <th style={{...th, textAlign:'right'}}>Cost</th>
                <th style={{...th, textAlign:'right'}}>Diesel</th>
                <th style={{...th, textAlign:'right'}}>Gas</th>
                <th style={{...th, textAlign:'right'}}>DEF</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([k, m]) => {
                const vDiesel = variancePct(m.bill.diesel, m.sup.diesel);
                const vGas    = variancePct(m.bill.gasoline, m.sup.gasoline);
                const vDef    = variancePct(m.bill.def, m.sup.def);
                return (
                  <tr key={k}>
                    <td style={{...td, fontWeight:600}}>{monthLabel(k)} <span style={{color:'#9ca3af', fontWeight:400, fontSize:10}}>· {m.billCount} bill{m.billCount===1?'':'s'} / {m.supCount} supply</span></td>
                    <td style={{...td, textAlign:'right', color:m.bill.diesel?'#1e40af':'#9ca3af', fontWeight:m.bill.diesel?600:400}}>{m.bill.diesel ? Math.round(m.bill.diesel).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:m.bill.gasoline?'#a16207':'#9ca3af', fontWeight:m.bill.gasoline?600:400}}>{m.bill.gasoline ? Math.round(m.bill.gasoline).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:m.bill.def?'#92400e':'#9ca3af', fontWeight:m.bill.def?600:400}}>{m.bill.def ? Math.round(m.bill.def).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:'#065f46', fontWeight:600}}>{money(m.bill.cost)}</td>
                    <td style={{...td, textAlign:'right', color:m.sup.diesel?'#1e40af':'#9ca3af', fontWeight:m.sup.diesel?600:400}}>{m.sup.diesel ? Math.round(m.sup.diesel).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:m.sup.gasoline?'#a16207':'#9ca3af', fontWeight:m.sup.gasoline?600:400}}>{m.sup.gasoline ? Math.round(m.sup.gasoline).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:m.sup.def?'#92400e':'#9ca3af', fontWeight:m.sup.def?600:400}}>{m.sup.def ? Math.round(m.sup.def).toLocaleString() : '—'}</td>
                    <td style={{...td, textAlign:'right', color:'#065f46', fontWeight:600}}>{money(m.sup.cost)}</td>
                    <td style={{...td, textAlign:'right', color:varColor(vDiesel), fontWeight:700}}>{vDiesel == null ? '—' : (vDiesel >= 0 ? '+' : '') + vDiesel.toFixed(1) + '%'}</td>
                    <td style={{...td, textAlign:'right', color:varColor(vGas), fontWeight:700}}>{vGas == null ? '—' : (vGas >= 0 ? '+' : '') + vGas.toFixed(1) + '%'}</td>
                    <td style={{...td, textAlign:'right', color:varColor(vDef), fontWeight:700}}>{vDef == null ? '—' : (vDef >= 0 ? '+' : '') + vDef.toFixed(1) + '%'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
