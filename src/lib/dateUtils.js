// Date + format utilities. Verbatim extract from main.jsx.

export function addDays(dateOrISO, n) {
  const d = typeof dateOrISO==="string" ? new Date(dateOrISO+"T12:00:00") : new Date(dateOrISO);
  d.setDate(d.getDate()+n);
  return d;
}
export function toISO(d){ return new Date(d).toISOString().split("T")[0]; }
export function fmt(iso){
  if(!iso) return "—";
  const [y,m,d]=iso.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}
export function fmtS(iso){
  if(!iso) return "—";
  const [y,m,d]=iso.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}
export function todayISO(){ return toISO(new Date()); }
export function thisMonday(){
  const d=new Date();
  d.setDate(d.getDate()-d.getDay());
  return toISO(d);
}

// ── HOLIDAY LOGIC ──────────────────────────────────────────────────────────
