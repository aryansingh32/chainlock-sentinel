import { create } from 'zustand'

export type LedgerType = 'REGISTER' | 'DECRYPT' | 'PRINT' | 'REVOKE' | 'BEACON' | 'ALERT' | 'CHECKPOINT'
export type Officer = { id:string; name:string; device:string; status:'ACTIVE'|'REVOKED'; heartbeat:string }
export type DocumentRecord = { id:string; title:string; classification:'SECRET'|'CONFIDENTIAL'; pages:number; pieces:number; locked:number; recipients:string[]; sender:string; received:string; status:string }
export type LedgerBlock = { index:number; time:string; type:LedgerType; actor:string; subject:string; office:string; prevHash:string; hash:string; valid:boolean }
export type AlertRecord = { id:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; title:string; detail:string; time:string; acknowledged:boolean }

const officersSeed: Officer[] = [
 {id:'OFF-001',name:'Mehta',device:'WS-NAVAL-11',status:'ACTIVE',heartbeat:'12s'},
 {id:'OFF-002',name:'Iyer',device:'WS-NAVAL-12',status:'ACTIVE',heartbeat:'08s'},
 {id:'OFF-003',name:'Khan',device:'WS-NAVAL-13',status:'ACTIVE',heartbeat:'MISSING'},
 {id:'OFF-004',name:'Rao',device:'WS-NAVAL-14',status:'ACTIVE',heartbeat:'04s'},
 {id:'OFF-005',name:'Das',device:'WS-NAVAL-15',status:'ACTIVE',heartbeat:'16s'},
]
const documentsSeed: DocumentRecord[] = [
 {id:'DOC-007',title:'Operation Order 7 — Sector Seven',classification:'SECRET',pages:10,pieces:320,locked:640,recipients:['OFF-001','OFF-002','OFF-003','OFF-004','OFF-005'],sender:'HQ WESTERN FLEET',received:'08:02',status:'UNOPENED'},
 {id:'DOC-008',title:'Fleet Readiness Report Q3',classification:'CONFIDENTIAL',pages:18,pieces:320,locked:640,recipients:['OFF-001','OFF-002','OFF-003'],sender:'FLEET READINESS CELL',received:'Yesterday 18:40',status:'OPENED'},
 {id:'DOC-009',title:'Comms Schedule — Western Fleet',classification:'SECRET',pages:6,pieces:320,locked:640,recipients:['OFF-002','OFF-004','OFF-005'],sender:'COMMS COMMAND',received:'Yesterday 16:10',status:'UNOPENED'},
]
function code(input:string){ let h=2166136261; for(const c of input){h^=c.charCodeAt(0);h=Math.imul(h,16777619)} return Math.abs(h).toString(16).padStart(8,'0').repeat(4).slice(0,28)}
const eventSeed:[string,LedgerType,string,string,string][] = [
 ['07:32:10','CHECKPOINT','SECURITY','OFFICE-DELTA','Audit'],['07:41:22','CHECKPOINT','COMMAND','KEY-CEREMONY','Command'],['07:52:19','CHECKPOINT','AUDIT','POLICY-17A','Audit'],['08:00:00','REGISTER','HQ-SENDER','DOC-007','Command'],['08:02:14','REGISTER','HQ-SENDER','DOC-008','Command'],['08:05:32','REGISTER','COMMS','DOC-009','Command'],['08:22:17','DECRYPT','OFF-001','DOC-008','Security'],['08:49:02','CHECKPOINT','LEDGER-3','ROOT-COMMIT','Audit'],['09:14:02','DECRYPT','OFF-004','DOC-007','Security'],['09:41:00','PRINT','OFF-004','DOC-007','Audit'],['10:05:00','DECRYPT','OFF-002','DOC-007','Security'],['10:42:29','DECRYPT','OFF-003','DOC-008','Security'],['11:30:00','DECRYPT','OFF-005','DOC-007','Security'],['12:00:00','CHECKPOINT','LEDGER-1','ROOT-COMMIT','Command'],['14:32:07','ALERT','SENTINEL','DOC-007 → OFF-004','Security'],
]
function makeLedger(){let prev='0000000000000000000000000000'; return eventSeed.map((e,i)=>{const hash=code(`${i+1}${e.join('')}${prev}`); const b={index:i+1,time:e[0],type:e[1],actor:e[2],subject:e[3],office:e[4],prevHash:prev,hash,valid:true}; prev=hash; return b})}
const alertsSeed: AlertRecord[]=[
 {id:'ALT-104',severity:'CRITICAL',title:'Canary fingerprint recovered',detail:'DOC-007 attribution → OFF-004 / WS-NAVAL-14',time:'14:32:07',acknowledged:false},
 {id:'ALT-103',severity:'HIGH',title:'Image match detected',detail:'Page 3 visual similarity 94%',time:'14:19:44',acknowledged:false},
 {id:'ALT-102',severity:'MEDIUM',title:'Device heartbeat missing',detail:'WS-NAVAL-13 / OFF-003',time:'14:04:16',acknowledged:false},
]

type Store={
 officers:Officer[];documents:DocumentRecord[];ledger:LedgerBlock[];alerts:AlertRecord[];ledgerOnline:boolean;tampered:boolean;demoOpen:boolean;meshPulse:number;events:string[];
 appendBlock:(type:LedgerType,actor:string,subject:string,office?:string)=>void; setLedgerOnline:(v:boolean)=>void; toggleDemo:()=>void; revoke:(id:string)=>void; reenrol:(id:string)=>void; tamper:()=>void; restore:()=>void; addAlert:(kind:'canary'|'image'|'heartbeat'|'beacon')=>void; reset:()=>void; markOpened:(id:string)=>void;
}
const initial=()=>({officers:officersSeed.map(x=>({...x})),documents:documentsSeed.map(x=>({...x,recipients:[...x.recipients]})),ledger:makeLedger(),alerts:alertsSeed.map(x=>({...x})),ledgerOnline:true,tampered:false,demoOpen:false,meshPulse:0,events:['14:32:07  Canary attribution locked','14:31:54  Relay mesh nominal','14:31:41  Ledger quorum 3/3']})
export const useChainStore=create<Store>((set,get)=>({
 ...initial(),
 appendBlock:(type,actor,subject,office='Security')=>set(s=>{const prev=s.ledger.at(-1)?.hash??'0'.repeat(28);const index=s.ledger.length+1;const time=new Date().toLocaleTimeString('en-GB',{hour12:false});const hash=code(`${index}${time}${type}${actor}${subject}${prev}`);return{ledger:[...s.ledger,{index,time,type,actor,subject,office,prevHash:prev,hash,valid:true}],events:[`${time}  ${type} ${subject}`,...s.events].slice(0,10)}}),
 setLedgerOnline:(ledgerOnline)=>set({ledgerOnline}), toggleDemo:()=>set(s=>({demoOpen:!s.demoOpen})),
 revoke:(id)=>{set(s=>({officers:s.officers.map(o=>o.id===id?{...o,status:'REVOKED'}:o)}));get().appendBlock('REVOKE','SENTINEL',id,'Command')},
 reenrol:(id)=>set(s=>({officers:s.officers.map(o=>o.id===id?{...o,status:'ACTIVE',heartbeat:'01s'}:o)})),
 tamper:()=>set(s=>({tampered:true,ledger:s.ledger.map(b=>b.index>=5?{...b,valid:false}:b)})),restore:()=>set(s=>({tampered:false,ledger:s.ledger.map(b=>({...b,valid:true}))})),
 addAlert:(kind)=>set(s=>{const now=new Date().toLocaleTimeString('en-GB',{hour12:false});const map={canary:['CRITICAL','Canary fingerprint recovered','DOC-007 attribution → OFF-004'],image:['HIGH','Image match detected','Page 3 similarity 94%'],heartbeat:['MEDIUM','Device heartbeat missing','WS-NAVAL-14 / OFF-004'],beacon:['HIGH','Mesh test beacon received','RN-DECK3 → SOC verified']} as const;const [severity,title,detail]=map[kind];return{alerts:[{id:`ALT-${105+s.alerts.length}`,severity,title,detail,time:now,acknowledged:false},...s.alerts],meshPulse:kind==='beacon'?s.meshPulse+1:s.meshPulse,events:[`${now}  ${title}`,...s.events].slice(0,10)}}),
 reset:()=>set(initial()),markOpened:(id)=>set(s=>({documents:s.documents.map(d=>d.id===id?{...d,status:'OPENED'}:d)})),
}))
