// ═══════════════════════════════════════════════════════════════════
// OVERDRIVE — GAME LOGIC
// All game state, rules, phase flow, AI, and rendering logic.
// Depends on cards.js being loaded first (uses DECKS, CARS, TRACKS, etc).
// ═══════════════════════════════════════════════════════════════════

function getEffectiveCost(p,u){
  var cost=u.buy;
  if(!p.ability)return cost;
  var k=p.ability.k;
  if(k==='nismo_heritage'&&u.nismo)cost=Math.max(1,cost-2);
  if(k==='gazoo_discount'&&(u.cat==='Aero'||u.cat==='Suspension'||u.cat==='Handling'))cost=Math.max(1,cost-1);
  if(k==='precision_engineering'&&u.cat==='Electronics')cost=Math.max(1,cost-1);
  if(k==='go_big'&&u.tier)cost=Math.max(1,cost-2);
  return cost;
}

function getSecondaryBonus(u){
  // Parses upgrade effect text for a SECOND stat bonus not captured in u.stat/u.val
  // e.g. "Gain +1 Power and +1 Reliability" -> primary P+1 tracked, this finds R+1
  if(!u.eff)return null;
  var matches=u.eff.match(/\+(\d+) (Power|Handling|Brakes|Aero|Cooling|Reliability)/gi);
  if(!matches||matches.length<2)return null;
  var statMap={power:'P',handling:'H',brakes:'B',aero:'A',cooling:'C',reliability:'R'};
  for(var i=0;i<matches.length;i++){
    var m=matches[i].match(/\+(\d+) (\w+)/i);
    var statKey=statMap[m[2].toLowerCase()];
    if(statKey&&statKey!==u.stat){
      return{stat:statKey,val:parseInt(m[1])};
    }
  }
  return null;
}

// ── UTILS ───────────────────────────────────────────────────────────
const rnd=()=>Math.random(), d6=()=>Math.ceil(rnd()*6), pick=a=>a[Math.floor(rnd()*a.length)];
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
const $=id=>document.getElementById(id);
const isAI=i=>G.P[i]&&G.P[i].ai!==null;

function log(msg,cls=''){
  const el=$('raceLog');
  if(el.innerHTML.includes('No races'))el.innerHTML='';
  el.innerHTML+='<div class="'+(cls?'l'+cls:'')+'">'+(cls==='h'?'<br>':'')+msg+'</div>';
  el.scrollTop=el.scrollHeight;
}

// ── STATE ───────────────────────────────────────────────────────────
const G={
  np:4, P:[], cal:[],
  race:0, phase:'setup', standings:[],
  aucQ:[], aucI:0, bids:{},
  w:null, hz:null,
  segI:0, segW:{}, dnf:{}, lastSegs:{},
  reck:{},
  sponsDeck:[], sponsFU:[],
  shmDeck:[], shmFU:[], shmListed:[],
  activeGoals:[], MKT:5,
};

// ── INIT ────────────────────────────────────────────────────────────
function init(){
  G.activeGoals=shuffle([...RANDOM_GOALS]).slice(0,2);
  setP(4); shuffleCal();
  renderRulesCars(); renderAbilTabs('gt86'); renderFuelRef();
}

function setP(n){
  G.np=n; G.P=[];
  G.bids={}; // reset bids when player count changes
  const names=['Player 1','Player 2','Player 3','Player 4'];
  for(let i=0;i<n;i++) G.P.push({
    name:names[i], col:PC[i], ai:i===0?null:1,
    carId:null, car:null,
    P:0,H:0,B:0,A:0,C:0,R:0,Rb:0, heat:0,
    creds:10, cp:0, mechs:1, engs:0, workshopSlots:3,
    rc:0, fat:0, reckR:false,
    installed:[], garage:[], wip:[], deck:[], mkt:[],
    ability:null, sponsor:null,
    fuel:'pump98', nitrousUsed:false, nitroCircusUsed:false,
    segW:0, dnfs:0, repairs:0, topTwos:0, wins:0, hsSegs:0,
    maxP:0, maxHeat:0,
  });
  renderSetup();
  if(typeof resetAuction==='function')resetAuction();
}

function renderSetup(){
  $('psetup').innerHTML=G.P.map((p,i)=>
    '<div style="display:flex;gap:7px;align-items:center;margin-bottom:7px;flex-wrap:wrap;">'
    +'<div style="width:11px;height:11px;border-radius:50%;background:'+p.col+'"></div>'
    +'<input type="text" value="'+p.name+'" onchange="G.P['+i+'].name=this.value">'
    +'<select onchange="G.P['+i+'].ai=this.value===\'-1\'?null:+this.value" style="font-size:.7rem;padding:5px;">'
    +'<option value="-1"'+(p.ai===null?' selected':'')+'>👤 Human</option>'
    +AI_P.map((a,ai)=>'<option value="'+ai+'"'+(p.ai===ai?' selected':'')+'">🤖 AI: '+a.label+' — '+a.desc+'</option>').join('')
    +'</select>'
    +(p.ai===null?'<span class="badge bgn">YOU</span>':'<span class="badge bbl">AI</span>')
    +'</div>'
  ).join('');
}

function shuffleCal(){G.cal=shuffle([...TRACKS]).slice(0,8);renderCal();}
function renderCal(){
  $('calDisp').innerHTML=G.cal.map((t,i)=>
    '<div class="cs'+(i===G.race-1?' cur':i<G.race-1?' dn':'')+'">'
    +'<div class="rn">Race '+(i+1)+'</div>'
    +'<div class="rname">'+t.name+'</div>'
    +'<div class="rtype">'+t.ty+'</div>'
    +'<div style="font-size:.5rem;color:#444;margin-top:2px;line-height:1.3;">'+t.desc.replace('Track Special: ','').slice(0,55)+'</div>'
    +'</div>'
  ).join('');
}

// ── AUCTION ─────────────────────────────────────────────────────────
function resetAuction(){
  CARS.forEach(c=>{c.owner=null;c.paid=0;}); // clear first before shuffle
  G.aucQ=shuffle([...CARS]); G.aucI=0; G.bids={};
  G.P.forEach(p=>{p.carId=null;p.car=null;p.creds=10;p.ability=null;p.fuel='pump98';
    p.P=0;p.H=0;p.B=0;p.A=0;p.C=0;p.R=0;p.Rb=0;p.heat=0;
    p.installed=[];p.garage=[];p.wip=[];p.deck=[];p.mkt=[];
    p.rc=0;p.fat=0;p.reckR=false;p.sponsor=null;p.engs=0;p.mechs=1;p.workshopSlots=3;
    p.segW=0;p.dnfs=0;p.repairs=0;p.topTwos=0;p.wins=0;p.cp=0;
    p.trackTypesWon=new Set();p.worstFinishPos=0;p.weatherLossesAvoided=0;p.maxStierCount=0;p.biggestMargin=0;p.maxRC=0;p.achWon=null;
  });
  renderCG(); renderAuc(); chkReady();
}

function renderCG(){
  $('carGrid').innerHTML=CARS.map(c=>{
    const active=G.aucI<G.aucQ.length&&G.aucQ[G.aucI].id===c.id&&c.owner===null;
    return '<div class="ccard'+(c.owner!==null?' claimed':'')+'">'
      +'<div style="display:flex;justify-content:space-between;">'
      +'<div class="cname" style="color:'+c.col+'">'+c.name+'</div>'
      +(c.owner!==null?'<span class="badge bg">CLAIMED</span>':active?'<span class="badge br">BIDDING</span>':'')
      +'</div>'
      +'<div class="csub">'+c.sub+'</div>'
      +'<div class="smini">'+['P','H','B','A','C','R'].map(s=>'<div class="sm"><div class="sl">'+SN[s]+'</div><div class="sv">'+c[s]+'</div></div>').join('')+'</div>'
      +'<div style="font-size:.57rem;color:#555;margin-bottom:3px;line-height:1.5;"><strong style="color:#777;">Str:</strong> '+c.str+'</div>'
      +'<div style="font-size:.57rem;color:#444;margin-bottom:3px;line-height:1.5;"><strong>Weak:</strong> '+c.weak+'</div>'
      +'<div style="font-size:.57rem;color:var(--gd);line-height:1.4;"><strong>Car Achievement:</strong> '+c.ach+'</div>'
      +(c.owner!==null&&G.P[c.owner]?'<div style="margin-top:6px;font-size:.65rem;color:'+G.P[c.owner].col+';">'+G.P[c.owner].name+' — '+c.paid+' Credits</div>':c.owner!==null?'<div style="margin-top:6px;font-size:.65rem;color:#888;">Claimed</div>':'')
      +'</div>';
  }).join('');
}

function renderAuc(){
  const el=$('aucArea');
  while(G.aucI<G.aucQ.length&&G.aucQ[G.aucI].owner!==null)G.aucI++;
  if(G.aucI>=G.aucQ.length||G.P.every(p=>p.carId!==null)||CARS.every(c=>c.owner!==null)){
    el.innerHTML='<div class="good">✓ All cars auctioned!</div>'; chkReady(); return;
  }
  const car=G.aucQ[G.aucI];
  // AI auto-bids
  G.P.forEach((p,i)=>{
    if(!isAI(i)||p.carId!==null)return;
    const ai=AI_P[p.ai];
    const cur=G.bids[car.id]?G.bids[car.id].amt:0;
    const want=(ai.prio==='P'&&['mustang','z370'].includes(car.id))
      ||(ai.prio==='H'&&['mx5','gt86','auditt'].includes(car.id))
      ||(ai.prio==='C'&&['auditt','z370'].includes(car.id))
      ||(ai.prio==='B'&&['auditt','z370'].includes(car.id));
    const max=want?Math.min(Math.floor(p.creds*.6)+2,p.creds):Math.min(cur+1,p.creds);
    if(max>cur)G.bids[car.id]={amt:max,p:i};
  });
  const b=G.bids[car.id]; const ca=b?b.amt:0; const cp=b?b.p:-1;
  const deckInfo=`${(DECKS[car.id]||[]).filter(c=>!c.tier).length} Minor/Major + ${(DECKS[car.id]||[]).filter(c=>c.tier).length} S-Tier cards`;

  let h='<div style="background:#1a1300;border:2px solid var(--gd);border-radius:6px;padding:13px;margin-bottom:12px;">'
    +'<div style="font-size:.95rem;font-weight:700;color:var(--gd);margin-bottom:5px;">🏎 Auctioning: <span style="color:'+car.col+'">'+car.name+'</span></div>'
    +'<div style="font-size:.7rem;color:#bbb;margin-bottom:3px;">'+car.sub+' — P:'+car.P+' H:'+car.H+' B:'+car.B+' A:'+car.A+' C:'+car.C+' R:'+car.R+' | Deck: '+deckInfo+'</div>'
    +'<div style="font-size:.62rem;color:var(--gd);margin-bottom:8px;">★ Achievement: '+car.ach+'</div>'
    +'<div style="background:#0f0f0f;border:1px solid #5a3a00;border-radius:4px;padding:8px;margin-bottom:8px;">'
    +'<div style="font-size:.68rem;color:#888;">Current highest bid:</div>'
    +'<div style="font-size:1.1rem;font-weight:700;color:var(--gd);">'+(ca>0?ca+' Cr — '+G.P[cp].name:'No bids — opens at 1 Cr')+'</div>'
    +'</div>';

  G.P.forEach((p,i)=>{
    if(p.carId!==null){h+='<div style="display:flex;gap:8px;align-items:center;padding:4px 0;opacity:.35;font-size:.7rem;"><span style="color:'+p.col+';font-weight:700;">'+p.name+'</span><span>Has '+p.car.name+'</span></div>';return;}
    const min=ca+1||1; const can=p.creds>=min;
    h+='<div style="display:flex;gap:7px;align-items:center;padding:6px 0;border-bottom:1px solid #1a1000;flex-wrap:wrap;">'
      +'<div style="color:'+p.col+';font-weight:700;width:85px;">'+p.name+(isAI(i)?' [AI]':'')+'</div>'
      +'<div style="color:var(--gd);font-size:.7rem;width:60px;">'+p.creds+' Cr</div>';
    if(isAI(i)){
      h+=G.bids[car.id]&&G.bids[car.id].p===i?'<span class="badge bg">AI bid: '+G.bids[car.id].amt+' Cr</span>':'<span style="font-size:.65rem;color:#444;">AI passing</span>';
    }else if(can){
      h+='<input type="number" id="bid'+i+'" min="'+min+'" max="'+p.creds+'" value="'+Math.min(min,p.creds)+'">'
        +'<button class="btn" style="font-size:.62rem;padding:4px 9px;" onclick="placeBid('+i+',\''+car.id+'\')">Bid</button>';
    }else{
      h+='<span style="font-size:.65rem;color:#555;">Can\'t afford min bid ('+min+' Cr)</span>';
    }
    h+='</div>';
  });
  h+='<div style="margin-top:9px;display:flex;gap:7px;">'
    +'<button class="btn ok" onclick="closeAuc(\''+car.id+'\')" '+(ca===0?'disabled':'')+'>✓ Close — '+(ca>0?G.P[cp].name+' wins '+ca+' Cr':'No winner yet')+'</button>'
    +'<button class="btn sec" onclick="skipAuc(\''+car.id+'\')">Skip car</button>'
    +'</div></div>';
  el.innerHTML=h;
}

function placeBid(pi,cid){
  const p=G.P[pi]; const amt=+$('bid'+pi).value;
  const cur=G.bids[cid]?G.bids[cid].amt:0;
  if(isNaN(amt)||amt<=cur||amt>p.creds){alert('Invalid: must be > '+cur+' and ≤ '+p.creds);return;}
  G.bids[cid]={amt,p:pi};
  log(p.name+' bids '+amt+' Cr on '+CARS.find(c=>c.id===cid).name,'m');
  renderAuc(); renderCG();
}

function closeAuc(cid){
  const b=G.bids[cid]; if(!b)return;
  const car=CARS.find(c=>c.id===cid);
  const p=G.P[b.p];
  if(!p){alert('Error: bidder no longer exists. Reset auction.');return;}
  car.owner=b.p; car.paid=b.amt;
  p.carId=cid; p.car=car; p.creds-=b.amt;
  p.P=car.P;p.H=car.H;p.B=car.B;p.A=car.A;p.C=car.C;p.R=car.R;p.Rb=car.R;
  p.deck=shuffle([...(DECKS[cid]||[])]);
  p.mkt=p.deck.splice(0,G.MKT);
  log('🏎 '+p.name+' wins '+car.name+' for '+b.amt+' Cr ('+p.creds+' Cr left)','m');
  if(!isAI(b.p))showAbilSelect(b.p);
  else{const ab=ABILITIES[cid]||[];if(ab.length)p.ability=ab[0];}
  G.aucI++; renderCG(); renderAuc(); chkReady();
}

function skipAuc(cid){log(CARS.find(c=>c.id===cid).name+' — no winner','i');G.aucI++;renderAuc();renderCG();chkReady();}

function showAbilSelect(pi){
  const p=G.P[pi]; const ab=ABILITIES[p.carId]||[];
  let h='<div class="abil-picker" style="background:#1a1500;border:2px solid var(--gd);border-radius:6px;padding:13px;margin-bottom:11px;">'
    +'<div style="font-size:.88rem;font-weight:700;color:var(--gd);margin-bottom:5px;">'+p.name+' — Choose Your Ability Card</div>'
    +'<div class="info" style="margin-bottom:8px;">Active the entire Championship. Cannot be changed after selection. Choose based on your car, build plan, and the calendar.</div>';
  ab.forEach((a,i)=>{
    h+='<div style="background:#1a1a1a;border:1px solid #444;border-radius:5px;padding:9px;margin-bottom:5px;cursor:pointer;" onclick="pickAbil('+pi+','+i+')">'
      +'<div style="font-weight:700;color:var(--gd);margin-bottom:3px;font-size:.82rem;">'+a.n+'</div>'
      +'<div style="font-size:.72rem;color:#ddd;margin-bottom:2px;line-height:1.5;">'+a.e+'</div>'
      +'<div style="font-size:.62rem;color:#666;font-style:italic;">'+a.d+'</div>'
      +'</div>';
  });
  h+='</div>';
  // Remove any existing overlay first
  var existOv=document.getElementById('abilOverlay');
  if(existOv)existOv.remove();
  var ov=document.createElement('div');
  ov.id='abilOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
  // h already contains the styled picker div — just wrap in a scroll container
  ov.innerHTML='<div style="max-width:520px;width:100%;">'+h+'</div>';
  document.body.appendChild(ov);
}

function pickAbil(pi,ai){
  var p=G.P[pi];
  if(!p)return;
  p.ability=(ABILITIES[p.carId]||[])[ai];
  if(!p.ability)return;
  log(p.name+' chose Ability: '+p.ability.n,'m');
  // Remove overlay
  var ov=document.getElementById('abilOverlay');
  if(ov)ov.remove();
  var panels=document.querySelectorAll('.abil-picker');
  panels.forEach(function(d){d.remove();});
  // Defer re-render slightly so DOM settles
  setTimeout(function(){chkReady(); renderCG(); renderAuc();},30);
}

function chkReady(){
  const ok=G.P.every(p=>p.carId!==null);
  $('startBtn').disabled=!ok;
  const msg=$('startMsg');
  if(ok){
    msg.className='good';
    msg.innerHTML='✓ Ready!<br>'+G.P.map(p=>'<span style="color:'+p.col+'"><strong>'+p.name+'</strong></span>: '
      +p.car.name+' (paid '+p.car.paid+' Cr, '+p.creds+' Cr left)'
      +(p.ability?' | Ability: <strong>'+p.ability.n+'</strong>':' | <span style="color:var(--red)">No ability chosen</span>')).join('<br>');
  }else{msg.className='warn';msg.innerHTML='Complete the auction for all players to start.';}
}

// ── START ───────────────────────────────────────────────────────────
function startGame(){
  G.race=1;
  G.standings=G.P.map((_,i)=>i);
  G.lastSegs={}; G.P.forEach((_,i)=>G.lastSegs[i]=0);
  G.sponsDeck=shuffle([...SPONSORS]); G.sponsFU=G.sponsDeck.splice(0,3);
  G.shmDeck=shuffle([...SHM_DECK]); G.shmFU=[]; G.shmListed=[];
  G.activeGoals=shuffle([...RANDOM_GOALS]).slice(0,2);
  ST('race'); newRace();
}

function newRace(){
  const t=G.cal[G.race-1];
  // Snapshot state BEFORE this race's events, used by the summary screen after the race ends
  G.P.forEach(p=>{p._snapCp=p.cp;p._snapInstalled=p.installed.length;p._snapCreds=p.creds;p._snapStats={P:p.P,H:p.H,B:p.B,A:p.A,C:p.C,R:p.Rb};});
  G.snapStandings=[...G.standings];
  G.w=pick(WEATHERS); G.hz=pick(HAZARDS);
  G.segI=0; G.reck={}; G.nitrousSeg={}; G.reckSealed={}; G.reckRevealed=false;
  G.segW={}; G.dnf={}; G.raceScores={};
  G.P.forEach((_,i)=>{G.segW[i]=0;G.dnf[i]=false;G.raceScores[i]=0;});
  G.segW_thisRace_seg1Winner=null; // tracks who won Segment 1 this race, for Momentum Driver
  G.P.forEach(p=>{p._driverFeedbackUsed=false;p._oversteerUsed=false;p._dataLoggingUsed=false;p._haltechUsedThisRace=false;});
  // Torque Monster (370Z): checked once at race start, locked in for the whole race
  G.P.forEach(p=>{if(p.ability&&p.ability.k==='torque_monster')p._torqueMonsterActive=(p.heat>=p.C);});
  // Perfect Balance (GT86): checked once at race start
  G.P.forEach(p=>{if(p.ability&&p.ability.k==='perfect_balance'&&Math.abs(p.P-p.H)<=2){p.R=Math.min(p.Rb+1,p.R+1);}});
  // Snapshot Reliability at race start (after Workshop repairs, before any Segment damage) — Sandown Raceway special needs this
  G.P.forEach(p=>{p._raceStartR=p.R;});
  // NOTE: p.reckR is intentionally NOT reset here — doIncome() for THIS new race
  // needs to read reckR from the race that just ended, to award the Clean Finish bonus.
  // It gets reset inside doIncome() itself, right after being read.
  // SHM refresh: draw 5 new cards
  G.shmFU=[]; G.shmListed=[];
  if(G.shmDeck.length<5)G.shmDeck=shuffle([...SHM_DECK]);
  G.shmFU=G.shmDeck.splice(0,Math.min(5,G.shmDeck.length));
  G.phase='income';
  log('=== RACE '+G.race+'/8: '+t.name.toUpperCase()+' ===','h');
  log('  Weather: '+G.w.name+' — '+G.w.desc,'i');
  log('  Hazard: '+G.hz.name+' — '+G.hz.desc,'i');
  if(G.race===8)log('  ★★ FINALE — Position CP doubled! ★★','h');
  renderCal(); rr();
}

// ── RENDER DISPATCH ─────────────────────────────────────────────────
function rr(){
  const t=G.cal[G.race-1];
  $('rLabel').textContent='Race '+G.race+'/8';
  $('phLabel').textContent=(G.phase==='seg'||G.phase==='segresult')?'Segment '+(G.segI+1)+'/3':G.phase;
  $('phLabel').style.display='inline-block';
  const phs=['income','fuel','market','workshop','seg','end','summary','gameover'];
  const lbs=['Income','Fuel','Market','Workshop','Segments','End','Summary','Final'];
  const ci=(G.phase==='seg'||G.phase==='segresult')?4:phs.indexOf(G.phase);
  $('phStrip').innerHTML=phs.map((p,i)=>'<div class="pp'+(i===ci?' on':i<ci?' dn':'')+'">'+( i===4&&(G.phase==='seg'||G.phase==='segresult')?'Seg '+(G.segI+1)+'/3':lbs[i])+'</div>').join('');
  $('rHdr').innerHTML='<div class="ct">Race '+G.race+'/8 — '+t.name+'</div>'
    +'<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">'
    +'<span class="badge bg">☁ '+G.w.name+'</span><span class="badge br">⚠ '+G.hz.name+'</span>'
    +(G.race===8?'<span class="badge bgn">FINALE — CP×2</span>':'')+'</div>'
    +'<div style="font-size:.68rem;color:#888;margin-bottom:2px;">'+t.desc+'</div>'
    +'<div style="font-size:.65rem;color:#777;">'+G.w.desc+' | '+G.hz.desc+'</div>'
    +'<div style="font-size:.62rem;color:#555;margin-top:2px;">Segs: '+t.sg.map((s,i)=>'S'+(i+1)+': '+SN[s[0]]+' '+s[1]+'|'+SN[s[2]]+' '+s[3]).join('  ')+'</div>';
  const el=$('phContent');
  if(G.phase==='income')  phIncome(el);
  else if(G.phase==='fuel')phFuel(el);
  else if(G.phase==='market')phMarket(el);
  else if(G.phase==='workshop')phWorkshop(el);
  else if(G.phase==='seg')phSeg(el);
  else if(G.phase==='segresult')phSegResult(el);
  else if(G.phase==='end')phEnd(el);
  else if(G.phase==='summary')phSummary(el);
  else if(G.phase==='gameover')phGameOver(el);
  renderBoards(); renderStandings(); renderGoals(); renderSponsors();
}

// ── PH1 INCOME ──────────────────────────────────────────────────────
function phIncome(el){
  const r1=G.race===1;
  const ord=r1?G.P.map((_,i)=>i).reverse():[...G.standings].reverse();
  let h='<div class="card"><div class="ct">Phase 1 — Income</div>'
    +'<div class="info">Market order this round: '+ord.map(i=>'<strong style="color:'+G.P[i].col+'">'+G.P[i].name+'</strong>').join(' → ')+'</div>';

  h+='<div class="info" style="background:#0a1408;border-color:#1a3a1a;line-height:1.8;">'
    +'<strong style="color:#6ce06c;">Where this Credit income comes from:</strong><br>'
    +'<strong>Participation:</strong> every player gets a flat 5 Credits, every race, regardless of result.<br>'
    +(r1?'<strong>Race 1:</strong> no position/segment/clean bonuses yet — there\'s no previous race to score from.<br>'
        :'<strong>Position pay:</strong> 1st=+2 Cr, 2nd=+1 Cr, 3rd=+0 Cr, 4th=+0 Cr, based on how you finished the PREVIOUS race.<br>')
    +'<strong>Segment win pay:</strong> +1 Credit for each individual Segment you won last race.<br>'
    +'<strong>Clean Finish bonus:</strong> +1 Credit, ANY finishing position, if you made zero Reckless declarations across all 3 Segments of the previous race.<br>'
    +'<strong>Sponsor bonuses:</strong> vary by sponsor — shown per-player below if applicable.'
    +'</div>';

  h+='<div style="margin:8px 0;">';
  G.standings.forEach((pi,pos)=>{
    const p=G.P[pi];
    const participation=5;
    const posPay=r1?0:[2,1,0,0][Math.min(pos,3)];
    const segs=G.lastSegs[pi]||0;
    const clean=!p.reckR&&!r1?1:0;
    let spb=0;
    if(p.sponsor&&p.sponsor.ong==='clean_race'&&!p.reckR&&!G.dnf[pi])spb+=2;
    if(p.sponsor&&p.sponsor.name==='GoPro'&&pos===0)spb+=1;
    const total=participation+posPay+segs+clean+spb;
    h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1a1a1a;flex-wrap:wrap;">'
      +'<div style="width:9px;height:9px;border-radius:50%;background:'+p.col+'"></div>'
      +'<div style="flex:1;"><strong style="color:'+p.col+'">'+p.name+'</strong>'
      +(p.car?'<span style="color:#555;font-size:.65rem;"> '+p.car.name+'</span>':'')
      +(p.ability?'<span style="color:#444;font-size:.58rem;"> | '+p.ability.n+'</span>':'')+'</div>'
      +'<div style="font-size:.72rem;"><span style="color:var(--gd)" title="Flat amount every player gets every race">+'+participation+' Cr (participation)</span>'
      +(posPay?' <span style="color:var(--gd)" title="Pay for finishing position '+(pos+1)+' last race">+'+posPay+' Cr (position)</span>':'')
      +(segs?' <span style="color:#aaa" title="'+segs+' Segment win(s) last race, 1 Credit each">+'+segs+' Cr (Segments)</span>':'')
      +(clean?' <span style="color:#6ce06c" title="Zero Reckless declarations last race, any finishing position">+'+clean+' Cr (Clean Finish)</span>':'')
      +(spb?' <span style="color:var(--gd)">+'+spb+' Cr (sponsor)</span>':'')
      +' <span style="color:#555">→ '+(p.creds+total)+' Cr total</span></div></div>';
  });
  h+='</div><button class="btn" onclick="doIncome()">✓ Collect Income</button></div>';
  el.innerHTML=h;
}
function doIncome(){
  const r1=G.race===1;
  G.standings.forEach((pi,pos)=>{
    const p=G.P[pi];
    const participation=5; // flat Credits every player gets, every race, regardless of result
    const posPay=r1?0:[2,1,0,0][Math.min(pos,3)]; // position pay: 1st=2, 2nd=1, 3rd=0, 4th=0
    const segs=G.lastSegs[pi]||0; // 1 Credit per Segment won last race
    const wasReckless=p.reckR; // from the race that JUST ended
    const clean=!wasReckless&&!r1?1:0; // 1 Credit Clean Finish bonus, ANY position, if zero Reckless last race
    const total=participation+posPay+segs+clean;
    p.creds+=total;
    log(p.name+': +'+participation+' Cr (participation)'+(posPay?' +'+posPay+' Cr (position)':'')+(segs?' +'+segs+' Cr (Segments won)':'')+(clean?' +'+clean+' Cr (Clean Finish)':wasReckless?' (no Clean Finish — went Reckless last race)':'')+' = +'+total+' Cr → '+p.creds+' Cr','m');
    p.reckR=false; // NOW reset, after income has been calculated
  });
  G.phase='market'; rr();
}

// ── PH2 FUEL ────────────────────────────────────────────────────────
function getFuelUnlocks(p){
  const hasFlex=p.installed.some(u=>u.x==='unlock_e85'||u.tag==='Flex Fuel Kit');
  const hasECU=p.installed.some(u=>u.x==='unlock_fuels'||u.tag==='ECU Upgrade'||u.tag==='ECU/Tune');
  const hasHdr=p.installed.some(u=>u.tag==='Headers'||u.tag==='Exhaust System');
  const hasFuelSys=p.installed.some(u=>u.x==='unlock_methanol'||u.tag==='Reinforced Fuel System'||u.tag==='Fuel System');
  const hasNitKit=p.installed.some(u=>u.x==='unlock_nitrous'||u.tag==='Nitrous Kit');
  return {pump98:true,e85:hasFlex,leaded:hasECU&&hasHdr,methanol:hasECU&&hasFuelSys,nitrous:hasNitKit&&hasECU};
}

function aiPickFuel(p){
  const unlocked=getFuelUnlocks(p);
  // AI picks the best Power-boosting fuel it has unlocked and can afford to switch into
  const priority=['methanol','leaded','e85']; // nitrous needs a per-Segment declaration AI doesn't make, skip it for fuel selection
  for(const fid of priority){
    if(unlocked[fid]){
      const f=FUELS.find(x=>x.id===fid);
      if(p.fuel!==fid&&f.cost>0&&p.creds<f.cost)continue; // can't afford the unlock cost
      if(p.fuel!==fid){p.creds-=f.cost;log('[AI] '+p.name+': Fuel → '+f.name+' ('+f.cost+' Cr unlock)','k');}
      p.fuel=fid;
      return;
    }
  }
  p.fuel='pump98';
}

function phFuel(el){
  G.P.forEach((p,i)=>{if(isAI(i))aiPickFuel(p);});
  let h='<div class="card"><div class="ct">Phase 2 — Fuel Station</div>'
    +'<div class="info">Choose your fuel for this Race. Prerequisites must be INSTALLED on your car. Once unlocked (one-time cost), a fuel is free to use every Race.</div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">';
  G.P.forEach((p,pi2)=>h+='<div class="badge bg" style="font-size:.65rem;">'+p.name+': '+p.creds+' Credits</div>');
  h+='</div>';
  G.P.forEach((p,i)=>{
    const unlocked=getFuelUnlocks(p);
    h+='<div class="mplayer'+(isAI(i)?'':' human')+'" style="margin-bottom:8px;">'
      +'<div class="mhdr"><div style="width:9px;height:9px;border-radius:50%;background:'+p.col+'"></div>'
      +'<strong style="color:'+p.col+'">'+p.name+'</strong>'
      +(p.car?'<span class="badge bg">'+p.car.name+'</span>':'')
      +'<span class="badge bgn">'+FUELS.find(f=>f.id===p.fuel).name+'</span>'
      +(isAI(i)?'<span class="badge bbl">AI — picked automatically</span>':'')+'</div>';
    if(!isAI(i)){
      h+='<div class="fgrid">';
      FUELS.forEach(f=>{
        const ok=unlocked[f.id]; const sel=p.fuel===f.id;
        const missing=f.req.filter(r=>!p.installed.some(u=>u.tag===r||u.n.includes(r)));
        h+='<div class="fcard'+(ok?' avail':' locked')+(sel?' sel':'')+'" '+(ok?'onclick="pickFuel('+i+',\''+f.id+'\')"':'')+' >'
          +(sel?'<div style="font-size:.55rem;background:var(--gn);color:#fff;padding:1px 5px;border-radius:3px;display:inline-block;margin-bottom:4px;">SELECTED ✓</div>':'')
          +'<div class="fname" style="color:'+(ok?'#fff':'#555')+'">'+f.name+'</div>'
          +'<div style="font-size:.67rem;color:#bbb;margin-bottom:4px;line-height:1.4;">'+f.eff+'</div>'
          +'<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px;">'+f.tags.map(t=>'<span class="badge bg" style="font-size:.5rem;">'+t+'</span>').join('')+'</div>'
          +'<div style="font-size:.6rem;color:var(--gd);">'+(f.cost?'Unlock cost: '+f.cost+' Cr (one-time, then free)':'Always free')+'</div>'
          +'<div style="font-size:.58rem;color:'+(ok?'#666':'var(--red)')+'">'+f.reqText+'</div>'
          +(!ok&&missing.length?'<div style="font-size:.56rem;color:var(--red);margin-top:3px;">🔒 Need: '+missing.join(', ')+'</div>':'')
          +'</div>';
      });
      h+='</div>';
    }
    h+='</div>';
  });
  h+='<button class="btn" onclick="startRacePh()">✓ Confirm Fuel — Start Race!</button></div>';
  el.innerHTML=h;
}
function pickFuel(pi,fid){
  const p=G.P[pi]; const f=FUELS.find(x=>x.id===fid);
  if(f.cost>0&&p.fuel!==fid){if(p.creds<f.cost){alert('Need '+f.cost+' Cr');return;}p.creds-=f.cost;}
  p.fuel=fid; log(p.name+': Fuel → '+f.name,'m'); rr();
}

// ── PH3 MARKET ──────────────────────────────────────────────────────
function phMarket(el){
  // AI acts first
  G.P.forEach((p,i)=>{if(isAI(i))aiMarket(i);});
  const ord=G.race===1?[...G.P.map((_,i)=>i)].reverse():[...G.standings].reverse();
  let h='<div class="card"><div class="ct">Phase 3 — Market Phase</div>'
    +'<div class="info">Order: '+ord.map(i=>'<strong style="color:'+G.P[i].col+'">'+G.P[i].name+'</strong>').join(' → ')
    +' | 5 cards revealed this round from each player\'s personal deck. Unsold cards shuffled back at end. SHM below is open to all players.</div>';

  // All players (AI summary + human full controls)
  G.P.forEach((p,i)=>{
    h+='<div class="mplayer'+(isAI(i)?'':' human')+'">';
    h+='<div class="mhdr">'
      +'<div style="width:9px;height:9px;border-radius:50%;background:'+p.col+'"></div>'
      +'<strong style="color:'+p.col+'">'+p.name+'</strong>'
      +(p.car?'<span class="badge" style="background:#1a1a1a;color:var(--gd);border:1px solid #444;font-size:.55rem;">'+p.car.name+' | P'+p.P+' H'+p.H+' B'+p.B+' A'+p.A+' C'+p.C+' R'+p.R+'</span>':'')
      +'<span class="badge bg">'+p.creds+' Cr</span>'
      +'<span class="badge bbl">'+p.mechs+' Mechanic ('+(p.mechs*2)+' Workshop Capacity/round)</span>'
      +(p.engs?'<span style="font-size:.58rem;color:#cc99ff;"> '+p.engs+' Eng</span>':'')
      +(p.ability?'<span style="font-size:.58rem;color:#888;"> ★ '+p.ability.n+'</span>':'')
      +(p.sponsor?'<span style="font-size:.58rem;color:var(--gd);"> ♦ '+p.sponsor.name+'</span>':'')
      +(p.fuel!=='pump98'?'<span class="badge bgn">⛽ '+FUELS.find(f=>f.id===p.fuel).name+'</span>':'')
      +(p.heat>p.C?'<span class="badge br">⚠ OVERHEATING</span>':'')
      +(isAI(i)?'<span class="badge bbl">AI — done</span>':'')
      +'</div>';
    if(isAI(i)){
      h+='<div style="font-size:.65rem;color:#555;">Installed ('+p.installed.length+'): '+(p.installed.slice(0,5).map(u=>u.n).join(', ')+(p.installed.length>5?' +more':'')||'none')+'</div>'
       +'<div style="font-size:.6rem;color:#444;">Workshop: '+(p.garage.map(u=>u.n).join(', ')||'empty')+'</div>';
    }else{
      // Staff buttons
      h+='<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px;">';
      if(p.mechs<3)h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="hireMech('+i+')" '+(p.creds<5?'disabled':'')+'>+ Mechanic (5 Cr) → +'+(p.mechs===1?2:2)+' WC/round (total '+(p.mechs+1)*2+' WC)</button>';
      if(p.workshopSlots<5)h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="expandWorkshop('+i+')" '+(p.creds<8?'disabled':'')+'>Expand Workshop (8 Cr) → '+(p.workshopSlots+1)+' slots</button>';
      if(p.engs<1)h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="hireEng('+i+')" '+(p.creds<10?'disabled title="Need 10 Credits"':'')+'>+ Engineer (10 Cr) → S-Tier unlock + Free Deck Browse</button>';
      if(!p.sponsor&&G.sponsFU.length)h+='<button class="btn gd" style="font-size:.6rem;padding:4px 8px;" onclick="showSponsors('+i+')">Claim Sponsor</button>';
      h+='</div>';
      // Market cards
      const avail=p.mkt.filter(u=>!p.garage.some(g=>g.n===u.n)&&!p.installed.some(g=>g.n===u.n));
      h+='<div style="font-size:.68rem;color:var(--gd);font-weight:700;margin-bottom:5px;">Your Market ('+avail.length+' of '+G.MKT+' cards | '+p.deck.length+' face-down in deck):</div>';
      if(avail.length){
        h+='<div class="ugrid">'+avail.map(u=>mkCard(u,i,'buyCard')).join('')+'</div>';
      }else{
        h+='<div style="font-size:.7rem;color:#444;">No cards available — all purchased or deck empty.</div>';
      }
      // Engineer deck search / scout
      h+='<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">';
      if(p.engs>0)h+='<button class="btn" style="font-size:.6rem;padding:4px 9px;background:var(--bl);" onclick="showDeckSearch('+i+',\'mEx'+i+'\')">🔍 Engineer Deck Search ('+p.deck.length+' cards)</button>';
      if(p.creds>=1)h+='<button class="btn sec" style="font-size:.6rem;padding:4px 9px;" onclick="scoutDeck('+i+')">Scout Deck (1 Cr) — preview &amp; reorder top 3</button>';
      if(!p.sponsor&&G.sponsFU.length)h+='<button class="btn gd" style="font-size:.6rem;padding:4px 9px;" onclick="showSponsors('+i+')">Claim Sponsor</button>';
      h+='</div>';
      h+='<div id="mEx'+i+'"></div>';
      if(p.garage.length)h+='<div style="font-size:.6rem;color:#444;margin-top:5px;">Workshop (purchased, not yet installed): '+p.garage.map(u=>u.n).join(', ')+'</div>';
    }
    h+='</div>';
  });
  // SHM
  h+=renderSHM();
  h+='<button class="btn" style="margin-top:10px;" onclick="doMarket()">✓ Market Done — Continue to Workshop</button></div>';
  el.innerHTML=h;
}

function mkCard(u,pi,fn,extraClass,extraFee){
  extraClass=extraClass||''; extraFee=extraFee||0;
  var p=G.P[pi];
  var effCost=p?getEffectiveCost(p,u):u.buy; var totalDisplayCost=effCost+extraFee; var can=!p||totalDisplayCost<=p.creds;
  var tagConflict=p&&p.installed.find(function(x){return x.tag&&x.tag===u.tag&&u.tag;});
  var engReq=u.tier&&p&&!p.engs;
  var tierLabel=u.tier?'<span class="tier-stier">S-TIER</span>':u.wc>=2?'<span class="tier-major">MAJOR</span>':'<span class="tier-minor">MINOR</span>';
  var pills=[];
  if(u.nismo)pills.push('<span class="pill pill-sp" style="color:#dd88ff;border-color:#6a006a;">NISMO</span>');
  if(u.stat&&u.val)pills.push('<span class="pill pill-pos">+'+u.val+' '+SN[u.stat]+'</span>');
  var secB=getSecondaryBonus(u); if(secB)pills.push('<span class="pill pill-pos">+'+secB.val+' '+SN[secB.stat]+'</span>');
  if(u.heat)pills.push('<span class="pill pill-heat">+'+u.heat+' Heat</span>');
  if(u.x==='unlock_e85')pills.push('<span class="pill pill-sp" style="color:#90ee90;">&#9981; Unlocks E85 Fuel</span>');
  if(u.x==='unlock_fuels')pills.push('<span class="pill pill-sp" style="color:#90ee90;">&#9981; Unlocks All Advanced Fuels</span>');
  if(u.x==='unlock_methanol')pills.push('<span class="pill pill-sp" style="color:#aaddff;">&#9981; Required for Methanol</span>');
  if(u.x==='unlock_leaded')pills.push('<span class="pill pill-sp" style="color:#ffcc88;">&#9981; Unlocks Leaded Fuel</span>');
  if(u.x==='unlock_nitrous')pills.push('<span class="pill pill-sp" style="color:#dd88ff;">&#9981; Required for Nitrous N2O</span>');
  if(u.x==='nitrous')pills.push('<span class="pill pill-sp" style="color:#dd88ff;">&#9981; NITROUS: +4 Power for 1 Segment</span>');
  if(u.x==='reduce_ot')pills.push('<span class="pill pill-pos">Overtemp -1</span>');
  if(u.x==='all_segs')pills.push('<span class="pill pill-pos">+'+u.val+'P all Segs</span>');
  if(u.x==='hs_power')pills.push('<span class="pill pill-sp">+P Hi-Speed</span>');
  if(u.x==='seg1_power'||u.x==='seg1_power2')pills.push('<span class="pill pill-pos">+P Seg 1</span>');
  if(u.x==='seg12_power')pills.push('<span class="pill pill-pos">+P Segs 1-2</span>');
  if(u.x==='cr_seg_win')pills.push('<span class="pill pill-pos">+1Cr/Seg win</span>');
  if(u.x==='ignore_brake')pills.push('<span class="pill pill-pos" title="Cancels the Brake Fade hazard (-1 Brakes in Segment 3) AND certain track-special brake penalties, if either occurs this race">Ignore Brake Fade hazard</span>');
  if(u.x==='ignore_handling')pills.push('<span class="pill pill-pos">Ignore H pen.</span>');
  if(u.x==='ignore_wet')pills.push('<span class="pill pill-pos">Ignore Wet</span>');
  if(u.x==='ignore_crosswind')pills.push('<span class="pill pill-pos">Ignore Crosswind</span>');
  if(u.x==='reroll_heat')pills.push('<span class="pill pill-pos">Reroll Heat</span>');
  if(u.x==='seg3_rel')pills.push('<span class="pill pill-pos">+R Seg 3</span>');
  if(u.x==='seg3_brakes')pills.push('<span class="pill pill-pos">+B Seg 3</span>');
  if(u.x==='reduce_fi_heat')pills.push('<span class="pill pill-pos">FI -1 Heat</span>');
  if(u.x==='fi_bonus')pills.push('<span class="pill pill-sp">FI +1P</span>');
  if(u.x==='engine_swap')pills.push('<span class="pill pill-neg">Removes Engine upgrades</span>');
  if(u.x==='level2')pills.push('<span class="pill pill-sp">Has Level 2</span>');
  var ci=storeCard(u);
  var cls='ucard'+(u.tier?' stier':'')+(!can||engReq?' locked':'')+(extraClass?' '+extraClass:'');
  var onclick=(can&&!engReq)?(' onclick="'+fn+'('+pi+','+ci+')"'):'';
  var html='<div class="'+cls+'"'+onclick+'>';
  html+='<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">'+tierLabel;
  html+='<span class="utag" style="margin-bottom:0;">'+u.cat+(u.tag&&u.tag!==u.cat?' - '+u.tag:'')+'</span></div>';
  html+='<div class="uname">'+u.n+'</div>';
  html+='<div class="ueff">'+u.eff+'</div>';
  html+='<div class="udesc">'+u.desc+'</div>';
  html+='<div class="upills">'+pills.join('')+'</div>';
  if(tagConflict)html+='<div style="background:#1a0d00;border:1px solid #ff8800;border-radius:3px;padding:3px 6px;font-size:.58rem;color:#ff8800;margin-bottom:3px;"><strong>Swaps out:</strong> '+tagConflict.n+' (same physical component slot: "'+u.tag+'") — click to install this upgrade and remove the old one</div>';
  if(engReq)html+='<div style="font-size:.58rem;color:var(--red);">Requires Engineer</div>';
  if(!can)html+='<div style="font-size:.58rem;color:var(--red);">Need '+u.buy+' Cr</div>';
  var discLabel='';
  if(effCost<u.buy&&p&&p.ability){
    var dk=p.ability.k;
    if(dk==='nismo_heritage')discLabel='NISMO -'+(u.buy-effCost);
    else if(dk==='gazoo_discount')discLabel='Gazoo -'+(u.buy-effCost);
    else if(dk==='precision_engineering')discLabel='Precision -'+(u.buy-effCost);
    else if(dk==='go_big')discLabel='Go Big -'+(u.buy-effCost);
    else discLabel='Discount -'+(u.buy-effCost);
  }
  var priceDisplay=(effCost<u.buy?'<s style="color:#666;">'+u.buy+'</s> '+effCost:''+effCost)+(extraFee?' +'+extraFee:'')+' Cr';
  html+='<div class="ufoot"><span class="ucost">'+priceDisplay+(discLabel?' <span style="color:#dd88ff;font-size:.5rem;">'+discLabel+'</span>':'')+(extraFee?' <span style="color:#6cb4ee;font-size:.5rem;">+'+extraFee+' search fee</span>':'')+'</span><span class="uwc">'+u.wc+' WC</span></div>';
  html+='</div>';
  return html;
}

function renderSHM(){
  let h='<div class="card" style="margin-top:10px;border-color:#5a3a00;"><div class="ct" style="color:var(--gd);">Second-Hand Market — Open Auction (5 cards + listed items)</div>';
  h+='<div class="info">Any player bids on any card. Open bidding — state your bid aloud, highest wins. SHM buyer pays the bank. Workshop-listed items: seller receives payment directly.</div>';
  if(G.shmFU.length){
    h+='<div class="ugrid">'+G.shmFU.map((u,si)=>{
      const uu={...u,buy:u.buy};
      return '<div class="ucard shm">'
        +'<div class="utag">SECOND-HAND</div>'
        +'<div class="uname">'+u.n+'</div>'
        +'<div class="ueff">'+u.eff+'</div>'
        +'<div class="udesc">'+u.desc+'</div>'
        +'<div class="ufoot"><span class="ucost">'+u.buy+' Cr face value</span><span class="uwc">'+u.wc+' WC</span></div>'
        +'<div style="margin-top:6px;"><div style="font-size:.62rem;color:#888;margin-bottom:4px;">Who wins this card?</div>'
        +'<div style="display:flex;gap:4px;flex-wrap:wrap;">'
        +G.P.map((_,pi)=>'<button class="btn sec" style="font-size:.57rem;padding:3px 6px;" onclick="shmWin('+si+','+pi+')">'+G.P[pi].name+'</button>').join('')
        +'</div></div></div>';
    }).join('')+'</div>';
  }else{
    h+='<div style="font-size:.7rem;color:#555;">No SHM cards this round</div>';
  }
  if(G.shmListed.length){
    h+='<div style="font-size:.68rem;color:var(--gd);font-weight:700;margin-top:8px;margin-bottom:5px;">Player-Listed Workshop Items:</div>';
    G.shmListed.forEach((item,li)=>{
      const seller=G.P[item.pi];
      h+='<div style="background:#1a1a1a;border:1px solid #444;border-radius:4px;padding:8px;margin-bottom:5px;">'
        +'<div><strong>'+item.u.n+'</strong> <span style="color:#888;font-size:.65rem;">listed by '+seller.name+'</span></div>'
        +'<div style="font-size:.67rem;color:#ddd;margin-top:2px;">'+item.u.eff+'</div>'
        +'<div style="font-size:.6rem;color:var(--gd);">Opening: 1 Cr | Seller receives payment</div>'
        +'<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">'
        +G.P.filter((_,bi)=>bi!==item.pi).map((buyer,_)=>{
          const bi=G.P.indexOf(buyer);
          return '<button class="btn sec" style="font-size:.57rem;padding:3px 6px;" onclick="shmListedWin('+li+','+bi+')">'+buyer.name+' wins</button>';
        }).join('')
        +'<button class="btn sec" style="font-size:.57rem;padding:3px 6px;" onclick="shmReturnListed('+li+')">No sale — return</button>'
        +'</div></div>';
    });
  }
  // List item button for human players
  h+='<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">';
  G.P.forEach((p,i)=>{
    if(isAI(i))return;
    const alr=G.shmListed.find(x=>x.pi===i);
    if(!alr&&p.garage.length){
      h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="showListItem('+i+')">'+p.name+': List Workshop item for auction</button>';
    }
  });
  h+='</div></div>';
  return h;
}

function shmWin(si,pi){
  const u=G.shmFU[si]; const p=G.P[pi];
  // Show inline bid input
  const containerId='shmBid_'+si+'_'+pi;
  let existing=$('shmBidArea');
  if(!existing){const d=document.createElement('div');d.id='shmBidArea';$('phContent').appendChild(d);}
  $('shmBidArea').innerHTML='<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a1a;border:2px solid var(--gd);border-radius:8px;padding:20px;z-index:999;min-width:300px;">'
    +'<div style="font-weight:700;color:var(--gd);margin-bottom:8px;">'+p.name+' wins: '+u.n+'</div>'
    +'<div style="font-size:.7rem;color:#bbb;margin-bottom:10px;">'+u.eff+'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;">'
    +'<input type="number" id="shmBidAmt" min="1" max="'+p.creds+'" value="1" style="width:80px;">'
    +'<span style="font-size:.7rem;color:#888;">Cr (max: '+p.creds+' Cr)</span>'
    +'</div>'
    +'<div style="display:flex;gap:7px;margin-top:10px;">'
    +'<button class="btn ok" onclick="confirmShmWin('+si+','+pi+')">Confirm Purchase</button>'
    +'<button class="btn sec" onclick="clearSHM()">Cancel</button>'
    +'</div></div>';
}
function confirmShmWin(si,pi){
  const u=G.shmFU[si]; const p=G.P[pi];
  const bid=parseInt($('shmBidAmt').value);
  if(isNaN(bid)||bid<1){alert('Enter a valid bid');return;}
  if(bid>p.creds){alert('Not enough Credits! You have '+p.creds+' Cr');return;}
  p.creds-=bid; p.garage.push({...u}); G.shmFU.splice(si,1);
  $('shmBidArea').innerHTML='';
  log(p.name+' won "'+u.n+'" from SHM for '+bid+' Cr → Workshop','k');
  rr();
}

function shmListedWin(li,bi){
  const item=G.shmListed[li]; const buyer=G.P[bi]; const seller=G.P[item.pi];
  if(!$('shmBidArea')){const d=document.createElement('div');d.id='shmBidArea';$('phContent').appendChild(d);}
  $('shmBidArea').innerHTML='<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a1a;border:2px solid var(--gd);border-radius:8px;padding:20px;z-index:999;min-width:300px;">'
    +'<div style="font-weight:700;color:var(--gd);margin-bottom:5px;">'+buyer.name+' buys from '+seller.name+'</div>'
    +'<div style="font-weight:700;margin-bottom:3px;">'+item.u.n+'</div>'
    +'<div style="font-size:.7rem;color:#bbb;margin-bottom:10px;">'+item.u.eff+'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;">'
    +'<input type="number" id="shmListBidAmt" min="1" max="'+buyer.creds+'" value="1" style="width:80px;">'
    +'<span style="font-size:.7rem;color:#888;">Cr (buyer has: '+buyer.creds+' Cr)</span>'
    +'</div>'
    +'<div style="display:flex;gap:7px;margin-top:10px;">'
    +'<button class="btn ok" onclick="confirmListedWin('+li+','+bi+')">Confirm</button>'
    +'<button class="btn sec" onclick="clearSHM()">Cancel</button>'
    +'</div></div>';
}
function confirmListedWin(li,bi){
  const item=G.shmListed[li]; const buyer=G.P[bi]; const seller=G.P[item.pi];
  if(bi===item.pi){alert('You cannot buy your own listed item.');return;}
  const bid=parseInt($('shmListBidAmt').value);
  if(isNaN(bid)||bid<1)return;
  if(bid>buyer.creds){alert('Not enough Credits');return;}
  buyer.creds-=bid; seller.creds+=bid; buyer.garage.push({...item.u});
  G.shmListed.splice(li,1);
  $('shmBidArea').innerHTML='';
  log(buyer.name+' bought "'+item.u.n+'" from '+seller.name+' for '+bid+' Cr → Workshop','k');
  log(seller.name+' received '+bid+' Cr','k');
  rr();
}

function shmReturnListed(li){
  const item=G.shmListed[li]; G.P[item.pi].garage.push({...item.u});
  log(G.P[item.pi].name+': "'+item.u.n+'" returned to Workshop (no sale)','i');
  G.shmListed.splice(li,1); rr();
}

function showListItem(pi){
  const p=G.P[pi];
  if(!p.garage.length){alert('Workshop is empty — nothing to list.');return;}
  // Show inline picker
  if(!$('shmBidArea')){const d=document.createElement('div');d.id='shmBidArea';$('phContent').appendChild(d);}
  let h='<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a1a;border:2px solid var(--gd);border-radius:8px;padding:20px;z-index:999;min-width:320px;">'
    +'<div style="font-weight:700;color:var(--gd);margin-bottom:8px;">'+p.name+' — List Workshop item for auction</div>'
    +'<div style="font-size:.7rem;color:#bbb;margin-bottom:8px;">Seller receives payment when it sells. Returns to your Workshop if unsold.</div>';
  p.garage.forEach((u,gi)=>{
    h+='<div style="background:#111;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:5px;cursor:pointer;" onclick="confirmListItem('+pi+','+gi+')">'
      +'<div style="font-weight:700;font-size:.78rem;">'+u.n+'</div>'
      +'<div style="font-size:.65rem;color:#bbb;">'+u.eff+'</div>'
      +'<div style="font-size:.6rem;color:var(--gd);">'+u.buy+' Cr face value | '+u.wc+' WC</div>'
      +'<div style="font-size:.58rem;color:#6ce06c;margin-top:3px;">Click to list →</div>'
      +'</div>';
  });
  h+='<button class="btn sec" style="font-size:.65rem;margin-top:5px;" onclick="clearSHM()">Cancel</button></div>';
  $('shmBidArea').innerHTML=h;
}
function confirmListItem(pi,gi){
  const p=G.P[pi]; const u=p.garage[gi];
  p.garage.splice(gi,1);
  G.shmListed.push({pi,u});
  $('shmBidArea').innerHTML='';
  log(p.name+' listed "'+u.n+'" in the Second-Hand Market','k');
  rr();
}

function showDeckSearch(pi,containerId){
  const p=G.P[pi];
  const used=new Set([...p.installed,...p.garage,...p.mkt].map(u=>u.n));
  const srch=p.deck.filter(u=>!used.has(u.n));
  let h='<div style="background:#050f1a;border:2px solid var(--bl);border-radius:5px;padding:11px;margin-top:7px;">'
    +'<div style="color:#6cb4ee;font-weight:700;margin-bottom:5px;">🔍 Engineer Deck Search ('+p.name+') — '+srch.length+' cards</div>'
    +'<div style="font-size:.7rem;color:#9ab8e0;margin-bottom:7px;">Browse all face-down cards. Pay Buy cost → card goes to Workshop. Take nothing = free.</div>'
    +'<div class="ugrid">'+srch.map(u=>mkCard(u,pi,'dsBuy','',1)).join('')+'</div>'
    +'<button class="btn sec" style="font-size:.62rem;margin-top:7px;" onclick="$(\''+containerId+'\').innerHTML=\'\'">Close</button></div>';
  $(containerId).innerHTML=h;
}

function dsBuy(pi,ci){
  const p=G.P[pi];
  const u=getCard(ci);
  if(!u)return;
  const idx=p.deck.findIndex(d=>d.n===u.n);
  if(idx===-1)return;
  const effCost=getEffectiveCost(p,u);
  const totalCost=effCost+1; // discounted card price + 1 Cr engineer search fee
  if(totalCost>p.creds){alert('Need '+totalCost+' Cr ('+effCost+' Cr card'+(effCost<u.buy?' — discount applied':'')+' + 1 Cr engineer search fee)');return;}
  p.creds-=totalCost;
  if(p.garage.length>=p.workshopSlots){alert('Workshop full! Max '+p.workshopSlots+' items. Expand your Workshop or install/sell first.');p.creds+=totalCost;return;}
  p.garage.push({...u}); p.deck.splice(idx,1);
  log(p.name+' Engineer Search: grabbed '+u.n+' ('+effCost+' Cr'+(effCost<u.buy?' after discount':'')+' + 1 Cr search fee = '+totalCost+' Cr total) → Workshop','k');
  const ex=$('mEx'+pi); if(ex)ex.innerHTML=''; rr();
}

function scoutDeck(pi){
  const p=G.P[pi];
  if(p.creds<1){alert('Need 1 Cr');return;}
  p.creds-=1; const top3=p.deck.slice(0,3);
  if(!top3.length){alert('Deck is empty');return;}
  let h='<div style="background:#0a1a00;border:2px solid var(--gn);border-radius:5px;padding:10px;margin-top:7px;">'
    +'<div style="color:#6ce06c;font-weight:700;margin-bottom:4px;">Scout Result — Top 3 Face-Down Cards</div>'
    +'<div style="font-size:.68rem;color:#9ab8e0;margin-bottom:7px;">Click a card to move it to the TOP of your deck — it will appear first in next round\'s market reveal.</div>'
    +'<div style="display:flex;gap:7px;flex-wrap:wrap;">';
  top3.forEach((u,ti)=>{
    h+='<div style="background:#1a1a1a;border:1px solid var(--gn);border-radius:4px;padding:8px;min-width:145px;cursor:pointer;" onclick="scoutMove('+pi+','+ti+')">'
      +'<div style="font-size:.58rem;color:var(--mt);">Position '+(ti+1)+'</div>'
      +'<div style="font-weight:700;font-size:.75rem;margin:2px 0;">'+u.n+'</div>'
      +'<div style="font-size:.65rem;color:#ddd;">'+u.eff+'</div>'
      +'<div style="font-size:.6rem;color:var(--gd);margin-top:3px;">'+u.buy+' Cr | '+u.wc+' WC</div>'
      +'<div style="font-size:.55rem;color:#6ce06c;margin-top:4px;">Click → move to top</div>'
      +'</div>';
  });
  h+='</div><button class="btn sec" style="font-size:.62rem;margin-top:7px;" onclick="$(\'mEx'+pi+'\').innerHTML=\'\'">Done</button></div>';
  $('mEx'+pi).innerHTML=h;
}
function scoutMove(pi,idx){
  const p=G.P[pi]; if(idx===0){$('mEx'+pi).innerHTML='';return;}
  const c=p.deck.splice(idx,1)[0]; p.deck.unshift(c);
  log(p.name+' Scout: moved "'+c.n+'" to top of deck','k');
  $('mEx'+pi).innerHTML=''; rr();
}

function showSponsors(pi){
  const p=G.P[pi];
  let h='<div style="background:#1a1300;border:2px solid var(--gd);border-radius:5px;padding:10px;margin-top:7px;">'
    +'<div style="color:var(--gd);font-weight:700;margin-bottom:5px;">Available Sponsors</div>';
  G.sponsFU.forEach((sp,si)=>{
    const can=p.creds>=sp.fee;
    h+='<div style="background:#1a1a1a;border:1px solid '+(can?'#5a3a00':'#2a2a2a')+';border-radius:4px;padding:9px;margin-bottom:5px;'+(can?'cursor:pointer':'opacity:.5')+'" '+(can?'onclick="claimSP('+pi+','+si+')"':'')+' >'
      +'<div style="display:flex;justify-content:space-between;"><strong style="color:var(--gd);">'+sp.name+'</strong><span class="badge bg">'+sp.fee+' Cr</span></div>'
      +'<div style="font-size:.65rem;color:#888;margin-top:1px;">Category: '+sp.cat+'</div>'
      +'<div style="font-size:.7rem;color:#ddd;margin-top:4px;line-height:1.5;"><strong style="color:#fff;">Ongoing bonus:</strong> '+sp.bonus+'</div>'
      +'<div style="font-size:.68rem;color:var(--gd);margin-top:3px;"><strong>End-game +'+sp.endCp+' CP if:</strong> '+sp.endCond+'</div>'
      +(!can?'<div style="font-size:.58rem;color:var(--red);">Need '+sp.fee+' Cr</div>':'')
      +'</div>';
  });
  h+='<button class="btn sec" style="font-size:.62rem;margin-top:6px;" onclick="$(\'mEx'+pi+'\').innerHTML=\'\'">Cancel</button></div>';
  $('mEx'+pi).innerHTML=h;
}
function claimSP(pi,si){
  const p=G.P[pi]; const sp=G.sponsFU[si];
  if(sp.fee>p.creds){alert('Need '+sp.fee+' Cr');return;}
  p.creds-=sp.fee; p.sponsor=sp;
  G.sponsFU.splice(si,1);
  if(G.sponsDeck.length)G.sponsFU.push(G.sponsDeck.shift());
  if(sp.ong==='cooling_bonus'){p.C+=1;log(p.name+' Castrol: +1 Cooling permanently. C='+p.C,'k');}
  log(p.name+': Claimed Sponsor "'+sp.name+'" ('+sp.fee+' Cr). '+sp.bonus,'k');
  $('mEx'+pi).innerHTML=''; rr();
}

function buyCard(pi,ci){
  const p=G.P[pi];
  const u=getCard(ci);
  if(!u){alert('Card error - refresh');return;}
  const idx=p.mkt.findIndex(m=>m.n===u.n);
  if(idx===-1){alert('Card not in your market');return;}
  var effCost=getEffectiveCost(p,u); if(effCost>p.creds){alert('Need '+effCost+' Cr');return;}
  if(p.garage.length>=p.workshopSlots){alert('Workshop full! Max '+p.workshopSlots+' items. Expand your Workshop (8 Cr) or install/sell existing items first.');return;}
  p.creds-=effCost; p.garage.push({...u}); p.mkt.splice(idx,1);
  log(p.name+': Bought '+u.n+' ('+effCost+' Cr'+(effCost<u.buy?', NISMO discount applied':'')+') added to Workshop. '+p.creds+' Cr left. Workshop: '+p.garage.length+'/'+p.workshopSlots+' slots.','k');
  rr();
}


function expandWorkshop(pi){
  var p=G.P[pi];
  if(p.workshopSlots>=5){alert('Workshop already at maximum (5 slots).');return;}
  if(p.creds<8){alert('Need 8 Credits to expand Workshop.');return;}
  p.creds-=8; p.workshopSlots++;
  log(p.name+': Expanded Workshop to '+p.workshopSlots+' slots (8 Credits)','k');
  rr();
}

function hireMech(i){
  const p=G.P[i];
  if(p.creds<5){alert('Need 5 Cr');return;}
  p.creds-=5; p.mechs++;
  log(p.name+': Hired Mechanic #'+p.mechs+' (5 Cr). Now '+(p.mechs*2)+' WC per round.','k'); rr();
}
function hireEng(i){
  const p=G.P[i];
  if(p.creds<10){alert('Need 10 Credits to hire an Engineer');return;}
  p.creds-=10; p.engs++;
  log(p.name+': Hired Engineer (10 Credits). S-Tier upgrades unlocked. Can browse deck for free, +1 Credit fee to grab any specific card.','k'); rr();
}

function doMarket(){
  // Shuffle unsold market cards back into deck, then draw fresh 5
  G.P.forEach(p=>{
    if(p.mkt.length)p.deck=shuffle([...p.deck,...p.mkt]);
    p.mkt=[];
    var marketSize=(p.ability&&p.ability.k==='data_analyst')?G.MKT+1:G.MKT;
    // If the deck has run dry (all cards seen/bought), refill from the full car deck,
    // excluding anything currently installed or sitting unbought in the Workshop —
    // this lets cards the player saw but didn't buy resurface later in the Championship
    if(p.deck.length<marketSize&&p.carId&&DECKS[p.carId]){
      const taken=new Set([...p.installed,...p.garage].map(u=>u.n));
      const fresh=shuffle(DECKS[p.carId].filter(u=>!taken.has(u.n)));
      const haveNames=new Set(p.deck.map(u=>u.n));
      fresh.forEach(u=>{if(!haveNames.has(u.n)){p.deck.push({...u});haveNames.add(u.n);}});
      if(fresh.length)log(p.name+': Personal deck replenished — cards seen earlier can now reappear in the Market.','i');
    }
    p.mkt=p.deck.splice(0,Math.min(marketSize,p.deck.length));
  });
  G.phase='workshop'; rr();
}

function aiMarket(i){
  const p=G.P[i]; const ai=AI_P[p.ai];
  if(ai.hire==='early'&&p.mechs===1&&p.creds>=5&&G.race<=3){p.creds-=5;p.mechs++;log('[AI] '+p.name+': Hired Mechanic #2 (5 Cr)','k');}
  else if(ai.hire==='mid'&&p.mechs===1&&p.creds>=5&&G.race<=5){p.creds-=5;p.mechs++;log('[AI] '+p.name+': Hired Mechanic #2 (5 Cr)','k');}
  if(!p.engs&&p.creds>=10&&G.race>=3&&ai.hire!=='late'){p.creds-=10;p.engs++;log('[AI] '+p.name+': Hired Engineer (10 Cr)','k');}
  if(!p.sponsor&&G.sponsFU.length){const sp=G.sponsFU.find(s=>s.fee<=p.creds);if(sp){const si=G.sponsFU.indexOf(sp);p.creds-=sp.fee;p.sponsor=sp;G.sponsFU.splice(si,1);if(G.sponsDeck.length)G.sponsFU.push(G.sponsDeck.shift());if(sp.ong==='cooling_bonus')p.C+=1;log('[AI] '+p.name+': Claimed Sponsor "'+sp.name+'"','k');}}
  // Refresh market
  if(p.mkt.length)p.deck=shuffle([...p.deck,...p.mkt]);
  var marketSize=(p.ability&&p.ability.k==='data_analyst')?G.MKT+1:G.MKT;
  p.mkt=p.deck.splice(0,Math.min(marketSize,p.deck.length));
  const used=new Set([...p.installed,...p.garage].map(u=>u.n));
  // With an Engineer, AI now considers S-Tier cards too (it paid 10 Cr to unlock them — use that investment)
  const opts=p.mkt.filter(u=>!used.has(u.n)&&getEffectiveCost(p,u)<=p.creds&&(!u.tier||p.engs)&&p.garage.length<p.workshopSlots);
  if(opts.length){
    let pk=null;
    if(p.heat>=p.C){const c=opts.filter(u=>u.stat==='C');if(c.length)pk=c.sort((a,b)=>b.val-a.val)[0];}
    if(!pk&&p.R<=2){const r=opts.filter(u=>u.stat==='R');if(r.length)pk=r.sort((a,b)=>b.val-a.val)[0];}
    // After Race 2, if AI has no alternative fuel unlocked yet, prioritize grabbing a fuel-unlock card
    if(!pk&&G.race>=3){
      const fu=getFuelUnlocks(p);
      const noAltFuel=!fu.e85&&!fu.leaded&&!fu.methanol;
      if(noAltFuel){const fuelCards=opts.filter(u=>u.x&&u.x.indexOf('unlock_')===0);if(fuelCards.length)pk=fuelCards[0];}
    }
    // Prefer a strong S-Tier upgrade in the AI's priority stat if it can afford one and has room
    if(!pk&&p.engs){const st=opts.filter(u=>u.tier&&u.stat===ai.prio);if(st.length)pk=st.sort((a,b)=>b.val-a.val)[0];}
    if(!pk){const pr=opts.filter(u=>u.stat===ai.prio);if(pr.length)pk=pr.sort((a,b)=>b.val-a.val)[0];}
    if(!pk)pk=opts.sort((a,b)=>a.buy-b.buy)[0];
    if(pk){
      const effCost=getEffectiveCost(p,pk);
      p.creds-=effCost;p.garage.push({...pk});p.mkt.splice(p.mkt.indexOf(pk),1);
      log('[AI] '+p.name+': Bought "'+pk.n+'"'+(pk.tier?' [S-TIER]':'')+' ('+effCost+' Cr)','k');
    }
  }
  // Occasionally use Engineer Deck Search to grab a specific high-value card instead of relying on the random Market
  if(p.engs&&p.creds>=4&&p.garage.length<p.workshopSlots&&rnd()<0.35){
    const dsUsed=new Set([...p.installed,...p.garage,...p.mkt].map(u=>u.n));
    const dsOpts=p.deck.filter(u=>!dsUsed.has(u.n)&&(!u.tier||p.engs)&&(getEffectiveCost(p,u)+1)<=p.creds);
    const dsPr=dsOpts.filter(u=>u.stat===ai.prio).sort((a,b)=>b.val-a.val);
    if(dsPr.length){
      const pick=dsPr[0]; const idx=p.deck.findIndex(u=>u.n===pick.n);
      const effCost=getEffectiveCost(p,pick); const totalCost=effCost+1;
      p.creds-=totalCost;p.garage.push({...pick});p.deck.splice(idx,1);
      log('[AI] '+p.name+': Engineer Search grabbed "'+pick.n+'"'+(pick.tier?' [S-TIER]':'')+' ('+totalCost+' Cr incl. search fee)','k');
    }
  }
}

// ── PH4 WORKSHOP ─────────────────────────────────────────────────────
function phWorkshop(el){
  G.P.forEach(p=>p._wuUsed=0);
  G.P.forEach((p,i)=>{if(isAI(i))aiWorkshop(i);});
  let h='<div class="card"><div class="ct">Phase 4 — Workshop Phase</div>'
    +'<div class="info">'
    +'<strong>How it works:</strong> Spend Workshop Capacity to install cards from your Workshop. 1 Mechanic = 2 Workshop Capacity per round.<br>'
    +'<strong>Minor upgrade = 1 Workshop Capacity. Major = 2. S-Tier = 3.</strong> Can\'t pay full cost this round? Installation starts and continues next round — card is inactive until complete.<br>'
    +'<strong style="color:#6cb4ee;">Reliability upgrades</strong> permanently raise your MAXIMUM Reliability (install +1 Reliability: car becomes 6/6 instead of 5/5). Damage lowers your CURRENT Reliability below this new max — repairing restores up to the new max, the upgrade is never lost.<br>'
    +'Repair: +1 Reliability costs 2 Credits + 1 Workshop Capacity. Full Service: 5 Credits + 2 Workshop Capacity, restores to your current maximum.<br>'
    +'<strong>Workshop holds 3 items by default.</strong> Expand to 5 max for 8 Credits per slot (available in the Market phase).'
    +'</div>';
  G.P.forEach((p,i)=>{
    const wu=p.mechs*2;
    h+='<div class="mplayer'+(isAI(i)?'':' human')+'">'
      +'<div class="mhdr">'
      +'<div style="width:9px;height:9px;border-radius:50%;background:'+p.col+'"></div>'
      +'<strong style="color:'+p.col+'">'+p.name+'</strong>'
      +(p.car?'<span class="badge" style="background:#1a1a1a;color:var(--gd);border:1px solid #444;font-size:.55rem;">'+p.car.name+' P'+p.P+' H'+p.H+' B'+p.B+' A'+p.A+' C'+p.C+' R'+p.R+'</span>':'')
      +'<span class="badge bbl">'+wu+' WC this round</span>'
      +(p.heat>p.C?'<span class="badge br">⚠ OVERHEATING Heat='+p.heat+' Cool='+p.C+'</span>':'<span style="font-size:.58rem;color:#555;">Heat: '+p.heat+'/'+p.C+'</span>')
      +(isAI(i)?'<span class="badge bbl">AI — done</span>':'')
      +'</div>';
    if(isAI(i)){
      h+='<div style="font-size:.65rem;color:#555;">Installed ('+p.installed.length+'): '+(p.installed.map(u=>u.n).join(', ')||'none')+'</div>';
    }else{
      // WIP (in-progress installations)
      if(p.wip&&p.wip.length){
        h+='<div style="font-size:.68rem;color:#6cb4ee;font-weight:700;margin-bottom:5px;margin-top:3px;">🔧 In Progress (paying WC over multiple rounds):</div>';
        p.wip.forEach((wip,wi)=>{
          const rem=wip.wc_total-wip.wc_paid; const canFinish=rem<=wu;
          h+='<div class="wip-container">'
            +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
            +'<span class="tier-stier" style="font-size:.5rem;">INSTALLING</span>'
            +'<strong style="font-size:.78rem;">'+wip.card.n+'</strong>'
            +'<span style="font-size:.65rem;color:#6cb4ee;">'+wip.wc_paid+'/'+wip.wc_total+' WC</span>'
            +'</div>'
            +'<div style="font-size:.65rem;color:#bbb;margin-bottom:5px;">'+wip.card.eff+'</div>'
            +'<div class="wip-progress">'+Array.from({length:wip.wc_total},(_,bi)=>'<div class="'+(bi<wip.wc_paid?'wip-slot-fill':'wip-slot-empty')+'"></div>').join('')+'</div>'
            +'<div style="font-size:.63rem;color:#888;margin-bottom:5px;">Needs '+rem+' more WC this round. You have '+wu+' WC available.</div>'
            +(canFinish
              ?'<button class="btn ok" style="font-size:.6rem;padding:3px 8px;margin-top:5px;" onclick="finishWIP('+i+','+wi+')">Complete install (uses '+rem+' WC)</button>'
              :'<button class="btn sec" style="font-size:.6rem;padding:3px 8px;margin-top:5px;" onclick="progressWIP('+i+','+wi+')">Pay '+wu+' WC this round (progress)</button>')
            +'</div>';
        });
      }
      // Workshop cards to install
      if(p.garage.length){
        h+='<div style="font-size:.68rem;color:var(--gd);font-weight:700;margin-bottom:5px;margin-top:5px;">Workshop — Click to install:</div>'
          +'<div class="ugrid">';
        p.garage.forEach((u,gi)=>{
          const tagConflict=p.installed.find(x=>x.tag&&x.tag===u.tag);
          const engReq=u.tier&&!p.engs;
          const pills=[];
          if(u.nismo)pills.push('<span class="pill pill-sp" style="color:#dd88ff;border-color:#6a006a;">NISMO</span>');
  if(u.stat&&u.val)pills.push('<span class="pill pill-pos">+'+u.val+' '+SN[u.stat]+'</span>');
  var secB=getSecondaryBonus(u); if(secB)pills.push('<span class="pill pill-pos">+'+secB.val+' '+SN[secB.stat]+'</span>');
          if(u.heat)pills.push('<span class="pill pill-heat">+'+u.heat+' Heat</span>');
          h+='<div class="ucard'+(u.tier?' stier':'')+(engReq?' locked':'')+'"'+(engReq?'':' onclick="installCard('+i+','+gi+')"')+'>'
            +(u.tier?'<div class="stlabel">S-TIER</div>':'')
            +'<div class="utag">'+u.cat+'</div>'
            +'<div class="uname">'+u.n+'</div>'
            +'<div class="ueff">'+u.eff+'</div>'
            +'<div class="upills">'+pills.join('')+'</div>'
            +(tagConflict?'<div style="font-size:.58rem;color:#ff8800;">Replaces: '+tagConflict.n+'</div>':'')
            +(engReq?'<div style="font-size:.58rem;color:var(--red);">⚠ Requires Engineer</div>':'')
            +'<div class="ufoot"><span class="ucost">'+u.wc+' WC</span><span class="uwc">'+wu+' WC available</span></div>'
            +'</div>';
        });
        h+='</div>';
      }else{
        h+='<div style="font-size:.7rem;color:#333;margin-bottom:5px;">Workshop empty — nothing to install.</div>';
      }
      // Actions
      var relC=p.R<=1?'var(--red)':p.R<=3?'#ff8800':'#6ce06c';
      h+='<div style="background:#0a0a0a;border:1px solid #222;border-radius:4px;padding:8px;margin:6px 0;font-size:.67rem;line-height:1.9;">';
      h+='<strong style="color:'+relC+';">Reliability: '+p.R+' / '+p.Rb+'</strong> — drops on Reckless damage (roll 1-2), overheat, or hazard.<br>';
      h+='<strong style="color:var(--red);">Reliability 0 = DNF: -1 Championship Point, -1 Credit, no race position points this race.</strong><br>';
      h+='<strong style="color:#6ce06c;">Position CP: 1st=3, 2nd=2, 3rd=1, 4th=0 (doubled on Race 8 Finale). Plus +1 CP per Segment win, +1 CP Clean Run (any position, zero Reckless this race). Credits: 5 participation + 2/1/0/0 position + 1/Segment + 1 Clean Finish.</strong>';
      h+='</div>';
      h+='<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">';
      if(p.R<p.Rb){
        h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="repairCar('+i+',1)" '+(p.creds<2?'disabled':'')+'>Repair +1R (1WC + 2 Cr)</button>';
        h+='<button class="btn sec" style="font-size:.6rem;padding:4px 8px;" onclick="repairCar('+i+',2)" '+(p.creds<5?'disabled':'')+'>Full Service (2WC + 5 Cr, reset to '+p.Rb+'R)</button>';
      }
      if(p.engs>0)h+='<button class="btn" style="font-size:.6rem;padding:4px 9px;background:var(--bl);" onclick="showDeckSearch('+i+',\'wEx'+i+'\')">🔍 Deck Search (Workshop)</button>';
      h+='</div>';
      h+='<div id="wEx'+i+'"></div>';
      h+='<div style="font-size:.6rem;color:#444;margin-top:5px;">Installed ('+p.installed.length+'): '+(p.installed.map(u=>u.n+(u.tier?' ★':'')).join(', ')||'None')+'</div>';
    }
    h+='</div>';
  });
  h+='<button class="btn ok" style="margin-top:10px;" onclick="goFuel()">✓ Workshop Done — Choose Fuel!</button></div>';
  el.innerHTML=h;
}

function installCard(pi,gi){
  const p=G.P[pi]; const u=p.garage[gi]; const wu=p.mechs*2;
  // Capacity check — cannot spend more than what's LEFT this round (not total)
  const wusedThisRound=p._wuUsed||0;
  const wuLeft=wu-wusedThisRound;
  if(wuLeft<=0){alert('No Workshop Capacity left this round! You\'ve already used all '+wu+' ('+p.mechs+' Mechanic x 2). This card will start next round.\n\nClick again to begin a multi-round install.');
    // Start WIP instead of blocking entirely — matches the "continues next round" rule
    if(!p.wip)p.wip=[];
    p.wip.push({card:{...u},wc_paid:0,wc_total:u.wc});
    p.garage.splice(gi,1);
    log(p.name+': No Workshop Capacity left this round. Started installing "'+u.n+'" (0/'+u.wc+' Workshop Capacity paid). Will continue next Workshop phase.','n');
    rr(); return;
  }
  // Check tag conflict
  const ci=p.installed.findIndex(x=>x.tag&&x.tag===u.tag);
  if(ci!==-1){
    if(!confirm('Installing "'+u.n+'" will REMOVE "'+p.installed[ci].n+'" (same tag: "'+u.tag+'")\n\nContinue?'))return;
    const old=p.installed.splice(ci,1)[0];
    if(old.stat)p[old.stat]-=old.val;
    if(old.stat==='R')p.Rb=Math.max(1,p.Rb-old.val);
    var oldSec=getSecondaryBonus(old); if(oldSec){p[oldSec.stat]-=oldSec.val; if(oldSec.stat==='R')p.Rb=Math.max(1,p.Rb-oldSec.val);}
    p.heat-=(old.heat||0);
    log(p.name+': Removed "'+old.n+'"'+(oldSec?' (also -'+oldSec.val+' '+SN[oldSec.stat]+')':''),'n');
  }
  if(u.wc<=wuLeft){
    // Complete immediately — fits within what's left this round
    if(u.stat)p[u.stat]+=u.val;
    if(u.stat==='R')p.Rb+=u.val; // Reliability upgrades raise the BASE max too, so repairs don't erase the bonus
    var sec=getSecondaryBonus(u); if(sec){p[sec.stat]+=sec.val; if(sec.stat==='R')p.Rb+=sec.val;}
    var extraHeat=(p.ability&&p.ability.k==='go_big'&&u.tier)?1:0;
    if(extraHeat)log(p.name+': Go Big or Go Home — +1 extra Heat from S-Tier install','x');
    var boostReduce=(p.ability&&p.ability.k==='boost_confidence'&&u.tag==='Forced Induction'&&u.heat>0)?1:0;
    if(boostReduce)log(p.name+': Boost Confidence — 1 less Heat from Forced Induction install','x');
    var haltechReduce=(p.sponsor&&p.sponsor.ong==='haltech_heat'&&!p._haltechUsedThisRace&&(u.heat||0)>0)?1:0;
    if(haltechReduce){p._haltechUsedThisRace=true;log(p.name+': Haltech ECU sponsor — 1 less Heat from this install (once per race)','k');}
    p.heat+=Math.max(0,(u.heat||0)+extraHeat-boostReduce-haltechReduce);
    // Lightweight Philosophy (MX-5): install a Coilovers/Sway Bars/Chassis Brace card -> +1 Credit
    if(p.ability&&p.ability.k==='lightweight_philosophy'&&['Coilovers','Sway Bars','Chassis Brace'].includes(u.tag)){
      p.creds+=1; log(p.name+': Lightweight Philosophy +1 Credit ('+u.tag+' installed)','k');
    }
    if(p.P>p.maxP)p.maxP=p.P;
    if(p.heat>p.maxHeat)p.maxHeat=p.heat;
    p.installed.push({...u}); p.garage.splice(gi,1);
    p._wuUsed=(p._wuUsed||0)+u.wc;
    log(p.name+': INSTALLED '+u.n+(sec?' (also +'+sec.val+' '+SN[sec.stat]+')':'')+'. Used '+u.wc+'/'+wuLeft+' remaining Workshop Capacity this round. Power:'+p.P+' Handling:'+p.H+' Brakes:'+p.B+' Aero:'+p.A+' Cooling:'+p.C+' Reliability:'+p.R+' Heat:'+p.heat,'n');
  }else{
    // Doesn't fit in what's left this round — pay what we can, start WIP
    if(!p.wip)p.wip=[];
    p.wip.push({card:{...u},wc_paid:wuLeft,wc_total:u.wc});
    p._wuUsed=(p._wuUsed||0)+wuLeft;
    p.garage.splice(gi,1);
    log(p.name+': Started installing "'+u.n+'" ('+wuLeft+'/'+u.wc+' Workshop Capacity paid — that\'s all you have left this round). Will continue next Workshop phase.','n');
  }
  rr();
}

function finishWIP(pi,wi){
  const p=G.P[pi]; const wip=p.wip[wi]; const u=wip.card;
  const ci=p.installed.findIndex(x=>x.tag&&x.tag===u.tag);
  if(ci!==-1){const old=p.installed.splice(ci,1)[0];if(old.stat)p[old.stat]-=old.val;var os2=getSecondaryBonus(old);if(os2)p[os2.stat]-=os2.val;p.heat-=(old.heat||0);}
  if(u.stat)p[u.stat]+=u.val;
  if(u.stat==='R')p.Rb+=u.val;
  var sec=getSecondaryBonus(u); if(sec){p[sec.stat]+=sec.val; if(sec.stat==='R')p.Rb+=sec.val;}
  p.heat+=(u.heat||0);
  if(p.P>p.maxP)p.maxP=p.P; if(p.heat>p.maxHeat)p.maxHeat=p.heat;
  p.installed.push({...u}); p.wip.splice(wi,1);
  log(p.name+': INSTALLATION COMPLETE — "'+u.n+'"'+(sec?' (also +'+sec.val+' '+SN[sec.stat]+')':'')+'. P'+p.P+' H'+p.H+' B'+p.B+' A'+p.A+' C'+p.C+' R'+p.R+' Heat='+p.heat,'n');
  rr();
}

function progressWIP(pi,wi){
  const p=G.P[pi]; const wu=p.mechs*2;
  p.wip[wi].wc_paid+=wu;
  log(p.name+': Progress on "'+p.wip[wi].card.n+'" ('+p.wip[wi].wc_paid+'/'+p.wip[wi].wc_total+' WC)','n');
  rr();
}

function repairCar(pi,mode){
  const p=G.P[pi];
  const cost=mode===1?2:5; const gain=mode===1?1:p.Rb-p.R;
  const mc=p.sponsor&&p.sponsor.name==='Motul'?Math.max(1,cost-1):cost;
  if(p.creds<mc){alert('Need '+mc+' Credits');return;}
  if(mode===1&&p.R>=p.Rb){alert('Reliability already at max ('+p.Rb+')');return;}
  var oldR=p.R;
  p.R=Math.min(p.Rb,p.R+gain); p.creds-=mc; p.repairs++;
  log(p.name+': Repaired! Reliability '+oldR+' → '+p.R+'/'+p.Rb+' ('+mc+' Credits)','n'); rr();
}

function aiWorkshop(i){
  const p=G.P[i]; let wu=p.mechs*2;
  if(!p.wip)p.wip=[];
  // Finish any WIP
  [...p.wip].forEach((wip,wi)=>{
    if(wu<=0)return;
    const rem=wip.wc_total-wip.wc_paid;
    if(rem<=wu){
      const u=wip.card;
      const ci=p.installed.findIndex(x=>x.tag&&x.tag===u.tag);
      if(ci!==-1){const old=p.installed.splice(ci,1)[0];if(old.stat)p[old.stat]-=old.val;p.heat-=(old.heat||0);}
      if(u.stat)p[u.stat]+=u.val;p.heat+=(u.heat||0);
      if(p.P>p.maxP)p.maxP=p.P;
      p.installed.push({...u});p.wip.splice(wi,1);wu-=rem;
      log('[AI] '+p.name+': COMPLETED install "'+u.n+'"','n');
    }else{wip.wc_paid+=wu;wu=0;}
  });
  if(p.R<=2&&wu>=1&&p.creds>=2){p.R=Math.min(p.Rb,p.R+1);p.creds-=2;wu--;p.repairs++;log('[AI] '+p.name+': Repair +1R','n');}
  [...p.garage].sort((a,b)=>(b.val||0)-(a.val||0)).forEach(u=>{
    if(wu<=0)return;
    if(u.tier&&!p.engs)return;
    const ci=p.installed.findIndex(x=>x.tag&&x.tag===u.tag);
    if(ci!==-1){if((u.val||0)<=(p.installed[ci].val||0))return;const old=p.installed.splice(ci,1)[0];if(old.stat)p[old.stat]-=old.val;p.heat-=(old.heat||0);}
    if(u.wc<=wu){
      if(u.stat)p[u.stat]+=u.val;p.heat+=(u.heat||0);if(p.P>p.maxP)p.maxP=p.P;
      p.installed.push({...u});p.garage.splice(p.garage.indexOf(u),1);wu-=u.wc;
      log('[AI] '+p.name+': INSTALLED "'+u.n+'". P'+p.P+' H'+p.H+' B'+p.B+' A'+p.A+' C'+p.C+' R'+p.R+' Heat='+p.heat,'n');
    }else{
      p.wip.push({card:{...u},wc_paid:wu,wc_total:u.wc});
      p.garage.splice(p.garage.indexOf(u),1);wu=0;
      log('[AI] '+p.name+': Started installing "'+u.n+'" ('+p.wip[p.wip.length-1].wc_paid+'/'+u.wc+' WC)','n');
    }
  });
}

// ── RACE PHASE ───────────────────────────────────────────────────────
function goFuel(){G.phase='fuel';rr();}
function startRacePh(){
  const t=G.cal[G.race-1]; const w=G.w; const hz=G.hz;
  if(t.sp==='hot'||t.sp==='perth'){G.P.forEach(p=>{p.heat++;if(p.heat>p.maxHeat)p.maxHeat=p.heat;});log('Track special '+t.name+': All cars +1 Heat','x');}
  if(t.sp==='darwin'){G.P.forEach(p=>{const before=p.C;p.C=Math.max(1,p.C-1);p._darwinReduced=before-p.C;});log('Track special '+t.name+': All cars Cooling -1 this Race','x');}
  if(w.heat){G.P.forEach(p=>{p.heat+=w.heat;if(p.heat>p.maxHeat)p.maxHeat=p.heat;});log('Weather "'+w.name+'": +'+w.heat+' Heat','x');}
  if(w.rel_hit){G.P.forEach(p=>p.R+=w.rel_hit);log('Weather "'+w.name+'": '+w.rel_hit+'R all','x');}
  if(hz.techfail){G.P.forEach((p,i)=>{const r=d6();if(r===1){p.R--;log(p.name+': Tech Failure D6=1 → -1R. R='+p.R,'x');}});}
  if(hz.debris){G.P.forEach((p,i)=>{const r=d6();if(r<=2){p.B--;log(p.name+': Debris D6='+r+' → -1 Brakes this Race','x');}});}
  if(hz.mech){const hi=G.P.reduce((a,b,ii)=>G.P[ii].heat>G.P[a].heat?ii:a,0);doOHCheck(hi,'Mech Inspection extra check',0);}
  G.P.forEach((p,i)=>{if(p.sponsor&&p.sponsor.ong==='rel_bonus'){p.R=Math.min(p.Rb+2,p.R+1);log(p.name+' Pirelli: +1R','k');}});
  // Fuel pre-race effects
  G.P.forEach((p,i)=>{
    if(p.fuel==='leaded'){p.R--;log(p.name+' Leaded: -1R at race start. R='+p.R,'x');}
    if(p.fuel==='methanol'){p.R-=2;p.heat=Math.max(0,p.heat-1);log(p.name+' Methanol: -2R +heat -1. R='+p.R,'x');}
  });
  const coolPen=(G.cal[G.race-1].sp==='darwin'||G.w.cool_pen)?1:0;
  G.P.forEach((_,i)=>doOHCheck(i,'Pre-Race Overheat Check',coolPen));
  G.segI=0; G.phase='seg'; aiSetReck(); rr();
}

function doOHCheck(i,label,cp){
  const p=G.P[i]; if(G.dnf[i])return;
  const otp=p.sponsor&&p.sponsor.ong==='overtemp_pen'?-1:0;
  const hasReroll=p.installed.some(u=>u.x==='reroll_heat')||(p.ability&&p.ability.k==='data_logging'&&!p._dataLoggingUsed);
  const eff=p.C-cp; // Effective cooling this check
  if(p.heat<=eff){
    log(p.name+' Overheat Check: Heat '+p.heat+' vs Cooling '+eff+' — OK, no check needed.','i');
    return;
  }
  // Heat exceeds cooling — must check!
  const ot=Math.max(1,p.heat-eff+otp);
  p.R--; // Always lose 1 Reliability when overheating
  let roll=d6();
  const firstRoll=roll;
  if(hasReroll&&roll<ot){
    roll=d6();
    var srcLabel=(p.ability&&p.ability.k==='data_logging'&&!p._dataLoggingUsed)?'Data Logging ability':'Data Logger / AIM Solo card';
    if(p.ability&&p.ability.k==='data_logging')p._dataLoggingUsed=true;
    log(p.name+': '+srcLabel+' reroll activated! First roll: '+firstRoll+', reroll: '+roll,'k');
  }
  const fail=roll<ot;
  if(fail)p.R-=2;
  log(p.name+' OVERHEAT CHECK ('+label+'): Heat='+p.heat+' Cooling='+eff
    +' | Overtemp threshold='+ot+' | Roll: '+roll
    +(fail?' → CRITICAL FAILURE! -1R (auto) -2R more = -3R total. Reliability='+p.R
         :' → Passed roll (needed '+ot+' or higher). -1R auto. Reliability='+p.R),fail?'d':'x');
  if(p.R<=0){doDNF(i);return;}
  // Endurance Mindset (370Z): survived an Overheat Check without DNF -> +1 Credit
  if(p.ability&&p.ability.k==='endurance_mindset'){p.creds+=1;log(p.name+': Endurance Mindset +1 Credit (survived Overheat Check)','k');}
}

function doDNF(i){
  const t=G.cal[G.race-1]; if(G.dnf[i])return;
  G.dnf[i]=true; G.P[i].dnfs++; G.P[i].cp--; G.P[i].creds=Math.max(0,G.P[i].creds-1);
  if(t.sp==='adelaide')G.P[i].cp--;
  // Sandown Raceway: DNF mercy rule — if you started the race with Reliability 3+, you still earn 1 CP despite retiring
  let sandownMercy=false;
  if(t.sp==='endurance'&&(G.P[i]._raceStartR||0)>=3){G.P[i].cp+=1;sandownMercy=true;}
  log('☠ '+G.P[i].name+' DNF! -1 CP'+(t.sp==='adelaide'?' -1 EXTRA CP (Adelaide)':'')+(sandownMercy?' +1 CP (Sandown mercy rule — started with Reliability '+G.P[i]._raceStartR+')':''),'d');
}

function aiSetReck(){
  G.reckSealed={}; G.reckRevealed=false; G.reck={};
  G.P.forEach((p,i)=>{
    if(!isAI(i)||G.dnf[i])return;
    const ai=AI_P[p.ai]; let ch=ai.rc;
    if(p.fat>=2||p.R<=1)ch=0; if(p.rc>=4)ch*=.5;
    G.reckSealed[i]=rnd()<ch; // sealed, not revealed — hidden from display until revealReck()
  });
}

// ── SEGMENT ──────────────────────────────────────────────────────────
function getDems(t,w,hz,si){
  const seg=t.sg[si]; const sn=si+1;
  let da=seg[1],db=seg[3];
  if(t.sp==='longest'){da++;db++;}
  if(t.sp==='rough'&&(seg[0]==='B'||seg[2]==='B')){if(seg[0]==='B')da++;if(seg[2]==='B')db++;}
  if(t.sp==='mallala'&&sn===1&&seg[2]==='B')db++;
  if(t.sp==='wakefield'&&seg[2]==='B')db++; // Wakefield Park: Brakes Demand +1 every Segment
  if(hz.dem_s3&&sn===3){da++;db++;}
  // Hampton Downs NZ: Rain weather cards add +2 Handling Demand instead of the usual +1
  const hdAmount=(t.sp==='hampton'&&w.hd_all)?2:w.hd_all;
  if(hdAmount&&seg[0]==='H')da+=hdAmount;
  if(hdAmount&&seg[2]==='H')db+=hdAmount;
  if(w.pd_all&&seg[0]==='P')da+=w.pd_all;
  if(w.bd_all&&seg[2]==='B')db+=w.bd_all;
  if(w.hd_seg1&&sn===1&&seg[0]==='H')da++;
  if(hz.brake_s3&&sn===3&&seg[2]==='B')db++;
  if(hz.pow_s2&&sn===2&&seg[0]==='P')da++;
  if(hz.hand_s3&&sn===3&&seg[0]==='H')da++;
  return{da,db};
}

function getScore(p,i,seg,da,db,sn,t,w,hz,addB,addA){
  var extras=[]; // tracks every named bonus source for transparent display: {label, val, src}
  // Quattro Grip (Audi TT): completely ignores Wet Track and Crosswind Demand penalties
  if(p.ability&&p.ability.k==='quattro_grip'){
    if((w.hd_all||w.aero_3rd)&&seg[0]==='H'){if(da>seg[1]){extras.push({label:'Quattro Grip (ability): ignored Handling Demand penalty',val:da-seg[1],src:'ability'});da=seg[1];}}
    if((w.hd_all||w.aero_3rd)&&seg[2]==='H'){if(db>seg[3]){extras.push({label:'Quattro Grip (ability): ignored Handling Demand penalty',val:db-seg[3],src:'ability'});db=seg[3];}}
  }
  let a=p[seg[0]]-da, b=p[seg[2]]-db;
  // Fuel bonuses
  const isFI=p.installed.some(u=>u.tag==='Forced Induction'||u.tag==='Turbocharger'||u.tag==='Supercharger');
  if(p.fuel==='e85'&&seg[0]==='P'){var fb=isFI?2:1;a+=fb;extras.push({label:'E85 Ethanol fuel',val:fb,src:'fuel'});}
  if(p.fuel==='leaded'&&seg[0]==='P'){var fb2=isFI?2:1;a+=fb2;extras.push({label:'Leaded Race Fuel',val:fb2,src:'fuel'});}
  if(p.fuel==='methanol'&&seg[0]==='P'){a+=3;extras.push({label:'Methanol fuel',val:3,src:'fuel'});}
  // Nitrous — one segment boost, declared before segment
  if(p.fuel==='nitrous'&&!p.nitrousUsed&&G.nitrousSeg&&G.nitrousSeg[i]===sn){
    if(seg[0]==='P'){a+=4;extras.push({label:'Nitrous (N2O) activated',val:4,src:'fuel'});}
    else log(p.name+': Nitrous activated but this segment primary stat is '+SN[seg[0]]+' not Power — nitrous gives no bonus here (wasted!). Consider using it in a Power segment.','x');
  }
  // Sponsor
  if(p.sponsor){
    if(p.sponsor.ong==='power_bonus'&&seg[0]==='P'){a+=1;extras.push({label:p.sponsor.name+' (sponsor)',val:1,src:'sponsor'});}
    if(p.sponsor.ong==='handling_s1'&&sn===1&&seg[0]==='H'){a+=1;extras.push({label:p.sponsor.name+' (sponsor)',val:1,src:'sponsor'});}
  }
  // Ability effects — keyed lookup, fires every Segment unless Fatigued (fat>0 dulls ability focus)
  if(p.ability&&p.fat===0){
    const k=p.ability.k; const an=p.ability.n;
    if(k==='momentum_driver'&&G.segW_thisRace_seg1Winner===i&&sn===2&&seg[0]==='H'){a+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='torque_monster'&&p._torqueMonsterActive&&seg[0]==='P'){a+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='track_weapon'&&sn===3&&seg[2]==='B'){b+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='launch_control'&&sn===1&&seg[0]==='P'){a+=2;extras.push({label:an+' (ability)',val:2,src:'ability'});}
    if(k==='corner_exit'&&p.H>p.P&&sn===2&&seg[0]==='P'){a+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='late_braker'&&sn===3&&seg[2]==='B'){b+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='american_muscle'&&p.heat>p.C&&seg[0]==='P'){a+=1;extras.push({label:an+' (ability)',val:1,src:'ability'});}
    if(k==='straight_line'&&t.ty.includes('High')&&seg[0]==='P'){a+=2;extras.push({label:an+' (ability)',val:2,src:'ability'});}
    if(k==='driver_feedback'&&!p._driverFeedbackUsed&&b<0){extras.push({label:an+' (ability): negative Handling margin zeroed',val:-b,src:'ability'});b=0;p._driverFeedbackUsed=true;}
    if(k==='oversteer_control'&&!p._oversteerUsed&&b<0){extras.push({label:an+' (ability): negative Handling margin zeroed',val:-b,src:'ability'});b=0;p._oversteerUsed=true;}
  }
  // Card specials
  var da_ignore=false;
  p.installed.forEach(u=>{
    if(u.x==='all_segs'&&seg[0]==='P'){a+=u.val;extras.push({label:u.n+' (card)',val:u.val,src:'card'});}
    if(u.x==='hs_power'&&t.ty.includes('High')&&seg[0]==='P'){a+=u.val;extras.push({label:u.n+' (card)',val:u.val,src:'card'});}
    if(u.x==='seg1_power'&&sn===1&&seg[0]==='P'){a+=1;extras.push({label:u.n+' (card)',val:1,src:'card'});}
    if(u.x==='seg1_power2'&&sn===1&&seg[0]==='P'){a+=2;extras.push({label:u.n+' (card)',val:2,src:'card'});}
    if(u.x==='seg12_power'&&(sn===1||sn===2)&&seg[0]==='P'){a+=u.val;extras.push({label:u.n+' (card)',val:u.val,src:'card'});}
    if(u.x==='seg3_brakes'&&sn===3&&seg[2]==='B'){b+=1;extras.push({label:u.n+' (card)',val:1,src:'card'});}
    if(u.x==='ignore_wet'&&(w.hd_all||w.pd_all)&&seg[0]==='H')da_ignore=true;
    if(u.x==='ignore_crosswind'&&w.aero_3rd)addA=false;
    if(u.x==='ignore_brake'){
      if(hz.brake_s3&&sn===3&&seg[2]==='B'){b+=1;extras.push({label:u.n+' (card): ignored Brake Fade hazard',val:1,src:'card'});}
      if(t.sp==='rough'&&seg[2]==='B'){b+=1;extras.push({label:u.n+' (card): ignored track brake penalty',val:1,src:'card'});}
    }
  });
  if(da_ignore){a+=w.hd_all||0;extras.push({label:'Ignore Wet card: ignored Handling penalty',val:w.hd_all||0,src:'card'});}
  const r=G.reck[i]||false;
  let s=a+b+(r?2:0)-p.fat;
  if(addB)s+=(p.B-db);
  if(addA)s+=p.A;
  if(w.score_all)s+=w.score_all;
  if(w.p_seg1&&sn===1&&seg[0]==='P')s+=1;
  if(w.bonus_s1&&sn===1)s+=1;
  return{s,a,b,extras};
}

function phSeg(el){
  const t=G.cal[G.race-1]; const w=G.w; const hz=G.hz;
  const sn=G.segI+1; const seg=t.sg[G.segI];
  const{da,db}=getDems(t,w,hz,G.segI);
  const addB=t.sp==='highlands';
  const addA=!!(w.aero_3rd||t.sp==='crosswind');
  const noAwd=!!(hz.seg1_no&&sn===1); const noCp=!!(hz.seg2_ncp&&sn===2);

  let h='<div class="card"><div class="ct">Segment '+sn+' of 3 — '+t.name+' | Race '+G.race+'</div>'
    +'<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:7px;">'
    +'<strong>'+SN[seg[0]]+' (Demand: '+da+')</strong><span style="color:#555;"> + </span><strong>'+SN[seg[2]]+' (Demand: '+db+')</strong>'
    +(addB?'<span class="badge bbl">+Brakes (Elevation)</span>':'')
    +(addA?'<span class="badge bbl">+Aero as 3rd stat</span>':'')
    +(noAwd?'<span class="badge br">NO CP or Credits (Safety Car)</span>':'')
    +(noCp?'<span class="badge br">NO CP — Credits still paid (Yellow)</span>':'')
    +'</div>'
    +'<div class="info" style="margin-bottom:7px;">'+t.desc+'<br>'+w.desc+' | '+hz.desc+'</div>'
    +'<div style="font-size:.62rem;color:#666;margin-bottom:8px;">Winning this Segment = +1 Championship Point + 1 Credit, awarded immediately. Your Segment score also adds to your Race Total, which decides final Race position (1st/2nd/3rd/4th) at the end of all 3 Segments.</div>'
    +'<div style="font-size:.58rem;color:#555;margin-bottom:8px;">Bonus colour key: <span style="color:#dd88ff;">■ Ability</span> &nbsp; <span style="color:var(--gd);">■ Sponsor</span> &nbsp; <span style="color:#6ce06c;">■ Card</span> &nbsp; <span style="color:#6cb4ee;">■ Fuel</span></div>';

  // Human reckless panels
  const humans=G.P.filter((_,i)=>!isAI(i)&&!G.dnf[i]);
  // Nitrous declaration
  if(!G.nitrousSeg)G.nitrousSeg={};
  const nitrousPlayers=G.P.filter((p,i)=>!isAI(i)&&!G.dnf[i]&&p.fuel==='nitrous'&&!p.nitrousUsed);
  if(nitrousPlayers.length){
    h+='<div style="background:#14080a;border:2px solid #9900cc;border-radius:5px;padding:10px;margin-bottom:8px;">';
    h+='<div style="color:#cc66ff;font-weight:700;margin-bottom:5px;">Nitrous (N2O) — Declare Use?</div>';
    h+='<div style="font-size:.67rem;color:#bbb;margin-bottom:7px;">Using Nitrous gives +4 Power this Segment only. After: +2 Heat + -1 Reliability. Once per Race.</div>';
    nitrousPlayers.forEach((p,_)=>{
      const pi=G.P.indexOf(p);
      const using=G.nitrousSeg[pi]===sn;
      h+='<div style="display:flex;gap:8px;align-items:center;padding:4px 0;">'+
        '<span style="color:'+p.col+';font-weight:700;width:90px;">'+p.name+'</span>'+
        '<button style="background:'+(using?'#9900cc':'#1a0a1a')+';border:2px solid #9900cc;color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:.65rem;" onclick="toggleNitrous('+pi+','+sn+')">'+(using?'NITROUS ON (+4P this seg)':'Activate Nitrous?')+'</button></div>';
    });
    h+='</div>';
  }
  // ── SEALED RECKLESS DECLARATION ──────────────────────────────────────────
  if(!G.reckSealed)G.reckSealed={};
  if(humans.length){
    const allDeclared=humans.every(p=>G.P.indexOf(p) in G.reckSealed); // AI already sealed by aiSetReck()
    const revealed=G.reckRevealed||false;
    h+='<div class="rpan">';
    h+='<div style="color:var(--or);font-weight:700;margin-bottom:4px;font-size:.85rem;">⚡ Reckless Drive — Sealed Declaration</div>';
    h+='<div style="font-size:.68rem;color:#bbb;margin-bottom:8px;line-height:1.7;">';
    h+='<strong style="color:#fff;">Each player secretly declares Reckless or Clean — then all reveal simultaneously.</strong><br>';
    h+='Reckless = +2 Segment Score, but: <strong>Damage roll</strong> (1 die, 1-2 = -1 Reliability) + <strong>Consequence roll</strong> (2 dice, sum vs Reckless Counter — lower = +1 Fatigue).<br>';
    h+='Your Fatigue tokens reset each race. Your Reckless Counter does NOT — it grows all Championship.<br>';
    h+='<strong style="color:var(--red);">Reliability 0 = DNF: -1 CP, -1 Credit, no race points.</strong>';
    h+='</div>';
    if(!revealed){
      // Show sealed declare buttons (each player sees only their own)
      humans.forEach(p=>{
        const pi=G.P.indexOf(p);
        const declared=pi in G.reckSealed;
        h+='<div class="pdr">';
        h+='<div style="color:'+p.col+';font-weight:700;width:110px;">'+p.name+'</div>';
        if(!declared){
          h+='<button class="rbtn" onclick="sealReck('+pi+',false)">Declare Clean</button>';
          h+='<button class="rbtn" style="margin-left:5px;" onclick="sealReck('+pi+',true)">Declare Reckless!</button>';
        }else{
          // Show sealed status without revealing choice
          h+='<div style="background:#1a1a00;border:1px solid #5a5a00;border-radius:4px;padding:4px 12px;font-size:.65rem;color:#cc0;">✓ Decision sealed (hidden until reveal)</div>';
        }
        // Show RC bar
        h+='</div>';
        h+='<div style="font-size:.6rem;color:#888;margin:2px 0 5px 110px;">';
        h+='Reckless Counter: <strong style="color:'+(p.rc>=8?'var(--red)':p.rc>=4?'#ff8800':'#aaa')+';">'+p.rc+'</strong>';
        h+=' | Fatigue: <strong style="color:'+(p.fat>0?'var(--red)':'#555')+';">'+p.fat+'</strong>';
        h+=' | Reliability: <strong style="color:'+(p.R<=2?'var(--red)':'#aaa')+';">'+p.R+'/'+p.Rb+'</strong>';
        h+='</div>';
        h+='<div style="display:flex;gap:2px;margin:2px 0 6px 110px;">'+Array.from({length:Math.max(12,p.rc+2)},function(_,ri){return '<div style="width:9px;height:6px;border-radius:1px;background:'+(ri<p.rc?(ri>=8?'#cc0000':ri>=4?'#ff8800':'#cc6600'):'#1a1a1a')+'"></div>';}).join('')+'</div>';
      });
      if(allDeclared){
        h+='<div style="margin-top:8px;">';
        h+='<div style="font-size:.7rem;color:#cc0;margin-bottom:6px;">✓ All players have declared. Ready to reveal!</div>';
        h+='<button class="btn" style="background:#7a5000;" onclick="revealReck()">🎭 Reveal All Decisions Simultaneously</button>';
        h+='</div>';
      }else{
        h+='<div style="font-size:.65rem;color:#555;margin-top:6px;">Waiting for '+(humans.length-(Object.keys(G.reckSealed).length))+' more player(s) to declare...</div>';
      }
    }else{
      // Show revealed state
      h+='<div style="font-size:.72rem;color:#cc0;font-weight:700;margin-bottom:8px;">🎭 REVEALED!</div>';
      humans.forEach(p=>{
        const pi=G.P.indexOf(p);
        const isReck=G.reck[pi]||false;
        h+='<div class="pdr">';
        h+='<div style="color:'+p.col+';font-weight:700;width:110px;">'+p.name+'</div>';
        h+='<div class="rbtn'+(isReck?' on':'')+'">'+( isReck?'🔥 RECKLESS!':'✓ Clean Drive')+'</div>';
        h+='<div style="font-size:.62rem;color:#888;margin-left:8px;">RC='+p.rc+' Fat='+p.fat+' Rel='+p.R+'</div>';
        h+='</div>';
      });
    }
    h+='</div>';
  }

  // Score cards
  // Score cards
  h+='<div class="sgrid">';
  G.P.forEach((p,i)=>{
    if(G.dnf[i]){h+='<div class="spr dnf"><div style="color:'+p.col+';font-weight:700;">'+p.name+'</div><div style="color:#333;font-size:.7rem;margin-top:4px;">DNF</div></div>';return;}
    const{s,a,b,extras}=getScore(p,i,seg,da,db,sn,t,w,hz,addB,addA);
    const r=G.reck[i];
    h+='<div class="spr"><div style="color:'+p.col+';font-weight:700;font-size:.8rem;margin-bottom:2px;">'+p.name+(isAI(i)?'<span style="font-size:.55rem;color:#6cb4ee;"> [AI'+(G.reckRevealed&&r?'/R':'')+']</span>':'')+'</div>'
      +(p.car?'<div style="font-size:.55rem;color:#444;margin-bottom:2px;">'+p.car.name+'</div>':'')
      +'<div style="font-size:.62rem;color:#888;">'+SN[seg[0]]+' '+p[seg[0]]+' − '+da+' = '+a+'</div>'
      +'<div style="font-size:.62rem;color:#888;">'+SN[seg[2]]+' '+p[seg[2]]+' − '+db+' = '+b+'</div>'
      +(addB?'<div style="font-size:.62rem;color:#6cb4ee;">Brakes '+p.B+' − '+db+' = '+(p.B-db)+'</div>':'')
      +(addA?'<div style="font-size:.62rem;color:#6cb4ee;">Aero +'+p.A+'</div>':'')
      +(r?'<div style="font-size:.62rem;color:var(--or);">Reckless +2</div>':'')
      +(p.fat?'<div style="font-size:.62rem;color:var(--red);">Fatigue −'+p.fat+'</div>':'')
      +(p.fuel!=='pump98'?'<div style="font-size:.55rem;color:#888;">⛽ '+FUELS.find(f=>f.id===p.fuel).name+'</div>':'')
      +(extras.length?extras.map(ex=>'<div style="font-size:.58rem;color:'+(ex.src==='ability'?'#dd88ff':ex.src==='sponsor'?'var(--gd)':ex.src==='card'?'#6ce06c':'#6cb4ee')+';">+'+ex.val+' '+ex.label+'</div>').join(''):'')
      +'<div class="sbig'+(s<0?' neg':'')+'" style="margin-top:3px;">'+s+'</div>'
      +'</div>';
  });
  h+='</div>'
    +'<div style="font-size:.68rem;color:#555;margin-bottom:7px;">Negative scores are normal early on — only the difference between players matters.</div>'
    +'<div style="margin-top:8px;">'
    +(humans.length&&!G.reckRevealed?'<div style="font-size:.68rem;color:var(--red);margin-bottom:6px;">⚠ All players must declare AND reveal Reckless decisions before resolving.</div>':'')
    +'<button class="btn ok" '+(humans.length&&!G.reckRevealed?'disabled':'')+' onclick="resolveSeg()">✓ Resolve Segment '+sn+'</button>'
    +'</div></div>';
  el.innerHTML=h;
}

function togR(i){G.reck[i]=!G.reck[i];rr();}
function sealReck(pi,goReck){
  if(!G.reckSealed)G.reckSealed={};
  G.reckSealed[pi]=goReck;
  rr();
}
function revealReck(){
  if(!G.reckSealed)return;
  // Copy sealed decisions to G.reck for resolution
  Object.keys(G.reckSealed).forEach(function(pi){G.reck[+pi]=G.reckSealed[+pi];});
  G.reckRevealed=true;
  rr();
}
function toggleNitrous(pi,sn){if(!G.nitrousSeg)G.nitrousSeg={};G.nitrousSeg[pi]=(G.nitrousSeg[pi]===sn?null:sn);rr();}

function resolveSeg(){
  const t=G.cal[G.race-1]; const w=G.w; const hz=G.hz;
  const sn=G.segI+1; const seg=t.sg[G.segI];
  const{da,db}=getDems(t,w,hz,G.segI);
  const addB=t.sp==='highlands'; const addA=!!(w.aero_3rd||t.sp==='crosswind');
  const noAwd=!!(hz.seg1_no&&sn===1); const noCp=!!(hz.seg2_ncp&&sn===2);

  log('— Seg '+sn+': '+SN[seg[0]]+' '+da+' | '+SN[seg[2]]+' '+db+(noAwd?' [NO AWARDS]':noCp?' [NO CP]':''),'s');

  // Reckless resolution
  G.P.forEach((p,i)=>{
    if(G.dnf[i]||!G.reck[i])return;
    const skip=p.sponsor&&p.sponsor.ong==='nitro_circus'&&!p.nitroCircusUsed;
    const driftPedigree=p.ability&&p.ability.k==='drift_pedigree';
    const dmgThreshold=driftPedigree?1:2; // Drift Pedigree: only a roll of 1 causes damage (half the usual risk)
    if(!skip){const roll=d6();if(roll<=dmgThreshold){p.R--;log(p.name+(isAI(i)?' [AI]':'')+': Reckless Drive — damage roll: '+roll+' (needed '+(dmgThreshold+1)+'+ to be safe'+(driftPedigree?', Drift Pedigree halves the risk':'')+') → DAMAGE! -1 Reliability. Reliability now: '+p.R,'r');}
      else log(p.name+(isAI(i)?' [AI]':'')+': Reckless Drive — damage roll: '+roll+' (needed '+(dmgThreshold+1)+'+ to be safe'+(driftPedigree?', Drift Pedigree halves the risk':'')+') → Safe! Reckless Counter now: '+(p.rc+1),'r');
    }else{log(p.name+': Reckless — Nitro Circus sponsor negates the damage roll this time.','r');p.nitroCircusUsed=true;}
    p.rc++;p.reckR=true;
    var r1=d6(),r2=d6(),rsum=r1+r2;
    if(rsum<p.rc){p.fat++;log('Consequence roll: '+r1+'+'+r2+'='+rsum+' vs Counter '+p.rc+' — LOWER! +1 Fatigue (-1/Segment). Total: '+p.fat,'x');}
    else log(p.name+': Consequence roll: '+r1+'+'+r2+'='+rsum+' vs Counter '+p.rc+' — OK, no penalty.','r');
    if(p.R<=0)doDNF(i);
  });

  // Apply nitrous effects for players who used it this segment
  G.P.forEach((p,i)=>{
    if(p.fuel==='nitrous'&&!p.nitrousUsed&&G.nitrousSeg&&G.nitrousSeg[i]===sn){
      p.nitrousUsed=true; p.heat+=2; p.R--;
      if(p.heat>p.maxHeat)p.maxHeat=p.heat;
      log(p.name+': NITROUS used in Segment '+sn+'! +4 Power this segment. Now: +2 Heat (Heat='+p.heat+'), -1 Reliability (Reliability='+p.R+').','x');
      if(p.R<=0)doDNF(i);
    }
  });
  // Calculate scores
  const sc=G.P.map((p,i)=>{
    if(G.dnf[i])return null;
    const{s,a,b,extras}=getScore(p,i,seg,da,db,sn,t,w,hz,addB,addA);
    if(!G.raceScores)G.raceScores={};
    G.raceScores[i]=(G.raceScores[i]||0)+s; // accumulate toward race total
    var extraStr=extras.length?(' ['+extras.map(ex=>'+'+ex.val+' '+ex.label).join(', ')+']'):'';
    log(p.name+(isAI(i)?' [AI]':'')+': '+SN[seg[0]]+p[seg[0]]+'-'+da+'='+a+'  '+SN[seg[2]]+p[seg[2]]+'-'+db+'='+b+(G.reck[i]?' +2R':'')+(p.fat?' -'+p.fat+'F':'')+extraStr+' = '+s+' (race total: '+G.raceScores[i]+')','i');
    return{s,i,extras};
  }).filter(Boolean);

  let wins=[]; // function-scoped so it's accessible when building G.segResult below
  if(sc.length){
    let best=Math.max(...sc.map(x=>x.s));
    wins=sc.filter(x=>x.s===best);
    // Tiebreaks
    if(wins.length>1){const mR=Math.max(...wins.map(x=>G.P[x.i].R));wins=wins.filter(x=>G.P[x.i].R===mR);}
    if(wins.length>1){const mH=Math.min(...wins.map(x=>G.P[x.i].heat));wins=wins.filter(x=>G.P[x.i].heat===mH);}
    if(sn===1)G.segW_thisRace_seg1Winner=wins[0]?wins[0].i:null; // record Segment 1 winner for Momentum Driver
    wins.forEach(({i})=>{
      G.segW[i]++; G.lastSegs[i]=(G.lastSegs[i]||0)+1; G.P[i].segW++;
      if(seg[0]==='P'&&t.ty.includes('High'))G.P[i].hsSegs++;
      // Track the base track-type category (strip star rating) for GT86's Track Master achievement
      const baseType=t.ty.replace(/\s*★+\s*$/,'').trim();
      G.P[i].trackTypesWon.add(baseType);
      // Track the biggest single-Segment win margin for Mustang's The Knockout achievement
      const others=sc.filter(x=>x.i!==i); const secondBest=others.length?Math.max(...others.map(x=>x.s)):best;
      const margin=best-secondBest;
      if(margin>G.P[i].biggestMargin)G.P[i].biggestMargin=margin;
      const cr=hz.pace?0:1;
      if(!noAwd&&!noCp){G.P[i].cp++;G.P[i].creds+=cr;}
      else if(noCp)G.P[i].creds+=cr;
      const rb=G.reck[i]&&!noAwd?1:0; if(rb)G.P[i].creds++;
      // Sponsor bonuses
      if(G.P[i].sponsor){
        if(G.P[i].sponsor.name==='Red Bull Racing AU'&&!noAwd)G.P[i].creds++;
        if(G.P[i].sponsor.name==='Monster Energy'&&G.reck[i]&&!noAwd)G.P[i].creds+=2;
      }
      // Note: Cool Factor ability removed in favour of Gazoo Racing Discount (see ABILITIES gt86)
      log('★ Segment '+sn+' WIN: '+G.P[i].name+' (score '+best+')'+(noAwd?' — Safety Car: no CP or Credits this Segment':noCp?' — Yellow Flag: +1 Credit only, no CP':' → +1 Championship Point (Segment win) +1 Credit'+(rb?' +1 Credit (Reckless win bonus)':'')),'w');
      if(margin>=8)log('💥 '+G.P[i].name+' KNOCKOUT MARGIN! Won by '+margin+' points — a Mustang GT achievement-tier performance.','w');
    });
    // Hazard effects post-segment
    if(hz.oil&&sn===1){const mH=Math.min(...sc.map(x=>G.P[x.i].H));sc.filter(x=>G.P[x.i].H===mH).forEach(x=>{G.P[x.i].R--;log(G.P[x.i].name+': Oil on Track → -1R','x');if(G.P[x.i].R<=0)doDNF(x.i);});}
    if(hz.gravel&&sn===1&&best>=4){wins.forEach(({i})=>{G.P[i].R--;log(G.P[i].name+': Gravel Trap → -1R','x');if(G.P[i].R<=0)doDNF(i);});}
    if(hz.kerb){const mB=Math.min(...sc.map(x=>G.P[x.i].B));sc.filter(x=>G.P[x.i].B===mB).forEach(x=>{G.P[x.i].R--;log(G.P[x.i].name+': Kerb Strike → -1R','x');if(G.P[x.i].R<=0)doDNF(x.i);});}
    if(t.sp==='mountain'){sc.forEach(({s,i})=>{if(best-s>=3){G.P[i].R--;log(G.P[i].name+': The Mountain lost by '+(best-s)+' → -1R','x');if(G.P[i].R<=0)doDNF(i);}});}
    if(t.sp==='winton'&&sn===3){G.P.forEach((_,i)=>{if(G.segW[i]===3){G.P[i].cp+=2;log('★★ '+G.P[i].name+': WINTON SWEEP +2 BONUS CP!','w');}});}
    if(t.sp==='albert'&&sn===3){/* handled in end phase */}
    // Audi TT Weatherproof achievement: did TT lose a Segment while penalty Weather was active this race?
    const penaltyWeather=!!(w.hd_all||w.pd_all||w.bd_all||(w.score_all&&w.score_all<0)||w.rel_hit||w.cool_pen);
    if(penaltyWeather){
      G.P.forEach((p,i)=>{
        if(p.carId==='auditt'&&!G.dnf[i]&&!wins.some(x=>x.i===i)){p._ttWeatherLossThisChamp=true;}
      });
    }
  }

  // Store this Segment's results for the results screen, then pause there
  G.segResult={sn:sn,seg:seg,da:da,db:db,best:(sc.length?Math.max(...sc.map(x=>x.s)):null),
    sc:sc.map(x=>({i:x.i,s:x.s,extras:x.extras||[]})), winners:wins.map(w=>w.i),
    noAwd:noAwd, noCp:noCp};
  G.phase='segresult';
  rr();
}


// ── SEGMENT RESULT (pause screen between Segments) ──────────────────────
function phSegResult(el){
  const t=G.cal[G.race-1]; const r=G.segResult;
  if(!r){G.phase='seg';rr();return;}
  const seg=r.seg; const sn=r.sn;
  let h='<div class="card"><div class="ct">Segment '+sn+' Result — '+t.name+'</div>';
  h+='<div class="info" style="margin-bottom:8px;">'
    +(r.noAwd?'Safety Car was active — no Championship Points or Credits awarded this Segment.':
      r.noCp?'Yellow Flag was active — Credits paid, but no Championship Points this Segment.':
      'Winner gets +1 Championship Point + 1 Credit, awarded immediately.')
    +'</div>';

  const sorted=[...r.sc].sort((a,b)=>b.s-a.s);
  h+='<div class="sgrid">';
  sorted.forEach(({i,s,extras})=>{
    const p=G.P[i]; const isWinner=r.winners.includes(i);
    h+='<div class="spr'+(isWinner?' win':'')+'">'
      +'<div style="color:'+p.col+';font-weight:700;font-size:.8rem;margin-bottom:2px;">'+(isWinner?'🏆 ':'')+p.name+(isAI(i)?' [AI]':'')+'</div>'
      +(p.car?'<div style="font-size:.55rem;color:#444;">'+p.car.name+'</div>':'')
      +(extras&&extras.length?extras.map(ex=>'<div style="font-size:.55rem;color:'+(ex.src==='ability'?'#dd88ff':ex.src==='sponsor'?'var(--gd)':ex.src==='card'?'#6ce06c':'#6cb4ee')+';">+'+ex.val+' '+ex.label+'</div>').join(''):'')
      +'<div class="sbig'+(s<0?' neg':'')+'">'+s+'</div>'
      +(isWinner?'<div style="font-size:.6rem;color:var(--gd);margin-top:3px;">Segment Winner!</div>':'')
      +'<div style="font-size:.58rem;color:#666;margin-top:2px;">Race total: '+(G.raceScores[i]||0)+'</div>'
      +'</div>';
  });
  // DNF'd players shown separately
  G.P.forEach((p,i)=>{
    if(G.dnf[i])h+='<div class="spr dnf"><div style="color:'+p.col+';font-weight:700;">'+p.name+'</div><div style="color:#333;font-size:.7rem;margin-top:4px;">DNF</div></div>';
  });
  h+='</div>';

  if(r.winners.length){
    const wNames=r.winners.map(i=>G.P[i].name).join(', ');
    h+='<div class="good" style="margin-top:8px;">★ '+wNames+' won Segment '+sn+(r.noAwd?' (no awards — Safety Car)':r.noCp?' (+1 Credit only — Yellow Flag)':' — +1 Championship Point +1 Credit')+'</div>';
  }

  h+='<button class="btn ok" style="margin-top:10px;" onclick="continueToNextSeg()">'
    +(sn<3?'✓ Continue to Segment '+(sn+1):'✓ Continue to End of Race')+'</button></div>';
  el.innerHTML=h;
}

function continueToNextSeg(){
  G.segI++; G.reck={};
  if(G.segI>=3)G.phase='end';
  else aiSetReck();
  G.phase=(G.segI>=3)?'end':'seg';
  rr();
}

// ── BETWEEN-RACE SUMMARY ────────────────────────────────────────────
function phSummary(el){
  const prevRace=G.race; // the race that just finished
  let h='<div class="card"><div class="ct">Race '+prevRace+' Summary</div>'
    +'<div class="info">Here\'s what changed before heading into Race '+(prevRace+1)+'.</div>';

  // Standings movement
  h+='<div style="font-size:.72rem;color:var(--gd);font-weight:700;margin:8px 0 5px;">Championship Standings Movement</div>';
  G.standings.forEach((pi,newPos)=>{
    const p=G.P[pi];
    const oldPos=G.snapStandings?G.snapStandings.indexOf(pi):newPos;
    const moved=oldPos-newPos; // positive = moved up
    let moveStr='';
    if(G.snapStandings&&G.snapStandings.length){
      if(moved>0)moveStr='<span style="color:#6ce06c;">▲ up '+moved+'</span>';
      else if(moved<0)moveStr='<span style="color:var(--red);">▼ down '+(-moved)+'</span>';
      else moveStr='<span style="color:#666;">— no change</span>';
    }
    h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1a1a1a;">'
      +'<div style="font-size:.8rem;width:24px;">'+MED[Math.min(newPos,3)]+'</div>'
      +'<div style="color:'+p.col+';font-weight:700;flex:1;">'+p.name+'</div>'
      +'<div style="font-size:.65rem;">'+moveStr+'</div>'
      +'<div style="color:var(--gd);font-weight:700;width:60px;text-align:right;">'+p.cp+' CP</div>'
      +'</div>';
  });

  // Per-player changes
  h+='<div style="font-size:.72rem;color:var(--gd);font-weight:700;margin:12px 0 5px;">What Changed</div>';
  G.P.forEach((p,pi)=>{
    const snap=p._snapStats||{P:p.P,H:p.H,B:p.B,A:p.A,C:p.C,R:p.Rb};
    const statChanges=['P','H','B','A','C'].map(s=>{
      const key=s==='C'?'C':s; const oldVal=snap[s]; const newVal=p[s];
      return oldVal!==newVal?(SN[s]+' '+oldVal+'→'+newVal+(newVal>oldVal?' (+'+(newVal-oldVal)+')':' ('+(newVal-oldVal)+')')):null;
    }).filter(Boolean);
    const relChange=snap.R!==p.Rb?'Max Reliability '+snap.R+'→'+p.Rb:null;
    const newCards=p.installed.length-(p._snapInstalled||0);
    const credChange=p.creds-(p._snapCreds||0);
    const cpChange=p.cp-(p._snapCp||0);
    const hasChanges=statChanges.length||relChange||newCards>0;
    if(!hasChanges&&credChange===0)return;
    h+='<div style="background:#111;border-radius:5px;padding:8px 10px;margin-bottom:6px;">'
      +'<div style="color:'+p.col+';font-weight:700;font-size:.75rem;margin-bottom:4px;">'+p.name+(isAI(pi)?' [AI]':'')+'</div>';
    if(newCards>0){
      const recentCards=p.installed.slice(-newCards);
      h+='<div style="font-size:.65rem;color:#6ce06c;margin-bottom:3px;">+'+newCards+' new upgrade(s) active: '+recentCards.map(u=>u.n).join(', ')+'</div>';
    }
    if(statChanges.length)h+='<div style="font-size:.65rem;color:#6cb4ee;margin-bottom:3px;">Stats: '+statChanges.join(', ')+'</div>';
    if(relChange)h+='<div style="font-size:.65rem;color:#6cb4ee;margin-bottom:3px;">'+relChange+'</div>';
    h+='<div style="font-size:.65rem;color:#888;">Credits: '+(credChange>=0?'+':'')+credChange+' (now '+p.creds+') | CP this race: +'+cpChange+'</div>';
    h+='</div>';
  });

  h+='<button class="btn ok" style="margin-top:10px;" onclick="continueToNextRace()">✓ Continue to Race '+(prevRace+1)+'</button></div>';
  el.innerHTML=h;
}

// ── END PHASE ────────────────────────────────────────────────────────
function phEnd(el){
  const t=G.cal[G.race-1]; const fin=G.race===8;
  const rank=[...G.P.map((_,i)=>i)].sort((a,b)=>{
    if(G.dnf[a]!==G.dnf[b])return G.dnf[a]?1:-1; // DNF always ranks last
    if(G.segW[b]!==G.segW[a])return G.segW[b]-G.segW[a]; // PRIMARY: whoever won the most individual Segments wins the race
    const sa=G.raceScores[a]||0, sb=G.raceScores[b]||0;
    if(sb!==sa)return sb-sa; // tiebreak 1: total cumulative score across all 3 Segments
    if(G.P[b].R!==G.P[a].R)return G.P[b].R-G.P[a].R; // tiebreak 2: higher Reliability remaining
    return G.P[a].rc-G.P[b].rc; // tiebreak 3: lower Reckless Counter (cleaner driving)
  });
  const pcp=fin?[6,4,2,0]:[3,2,1,0];
  let h='<div class="card"><div class="ct">End of Race '+G.race+(fin?' — FINALE':'')+'</div>';

  // ── HOW RANKING WORKS — explicit explanation ──
  h+='<div class="info" style="line-height:1.8;">'
    +'<strong style="color:#fff;">How final Race position is decided:</strong><br>'
    +'<strong>1st sort key:</strong> Most individual Segments won (out of 3). Whoever wins the most Segments wins the Race.<br>'
    +'<strong>1st tiebreak:</strong> If two players won the same number of Segments, whoever has the higher total cumulative Segment Score (Seg 1 + Seg 2 + Seg 3 added together) ranks higher.<br>'
    +'<strong>2nd tiebreak:</strong> Still tied? Higher remaining Reliability wins.<br>'
    +'<strong>3rd tiebreak:</strong> Still tied? Lower Reckless Counter wins (cleaner Championship driving record).<br>'
    +'<strong style="color:var(--red);">DNF players always rank last</strong>, regardless of Segments won or score earned before retiring.'
    +'</div>';

  h+='<div class="info" style="background:#0a1408;border-color:#1a3a1a;line-height:1.8;">'
    +'<strong style="color:#6ce06c;">Championship Points (CP) — how you earn them this race:</strong><br>'
    +'<strong>Position CP (awarded now):</strong> '+(fin?'FINALE — doubled! 1st=6 CP, 2nd=4 CP, 3rd=2 CP, 4th=0 CP.':'1st=3 CP, 2nd=2 CP, 3rd=1 CP, 4th=0 CP.')+'<br>'
    +'<strong>Segment CP (already awarded during the race):</strong> +1 CP for each individual Segment you won — these were added live as each Segment resolved, check the Log tab to see exactly when.<br>'
    +'<strong>Clean Run CP (awarded now):</strong> +1 CP if you made zero Reckless declarations across all 3 Segments this race — ANY finishing position qualifies.<br>'
    +'<strong>DNF penalty:</strong> -1 CP if you retired this race (already applied when the DNF happened).'
    +(t.sp==='albert'?'<br><strong style="color:var(--gd);">Albert Park Track Special:</strong> +1 bonus CP for the outright race winner.':'')
    +(t.sp==='winton'?'<br><strong style="color:var(--gd);">Winton Track Special:</strong> +2 bonus CP for sweeping all 3 Segments.':'')
    +(G.race===4?'<br><strong style="color:var(--gd);">Race 4 Milestone:</strong> +2 CP to last place (Underdog Bonus), +1 CP to whoever has won the most Segments so far (Specialist Bonus).':'')
    +'</div>';

  rank.forEach((pi,pos)=>{
    const p=G.P[pi]; const dnf=G.dnf[pi];
    const cp=dnf?0:pcp[Math.min(pos,3)];
    const pres=t.sp==='albert'&&pos===0&&!dnf;
    const raceTotal=G.raceScores[pi]||0;
    h+='<div style="background:#111;border-radius:5px;padding:8px 10px;margin-bottom:6px;">'
      +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      +'<div style="font-size:.95rem;">'+MED[Math.min(pos,3)]+'</div>'
      +'<div style="color:'+p.col+';font-weight:700;min-width:85px;">'+p.name+(isAI(pi)?' [AI]':'')+'</div>'
      +(p.car?'<span style="font-size:.65rem;color:#666;">'+p.car.name+'</span>':'')
      +'<div style="color:var(--gd);font-weight:700;">+'+cp+' CP'+(pres?' +1 Albert':'')+(dnf?' (DNF — no position CP)':'')+'</div>'
      +'<div style="font-size:.65rem;color:#555;margin-left:auto;">New Championship total: '+(p.cp+cp+(pres?1:0))+' CP</div>'
      +'</div>'
      +'<div style="font-size:.62rem;color:#888;margin-top:4px;padding-left:28px;">'
      +'Race score total: <strong style="color:#aaa;">'+raceTotal+'</strong> (sum of all 3 Segments) | '
      +'Segments won: <strong style="color:#aaa;">'+G.segW[pi]+'/3</strong> (already worth '+G.segW[pi]+' CP, added during the race) | '
      +'Reliability: <strong style="color:#aaa;">'+p.R+'/'+p.Rb+'</strong>'
      +'</div>'
      +'</div>';
  });
  h+='<button class="btn ok" style="margin-top:10px;" onclick="applyEnd('+JSON.stringify(rank)+')">✓ Apply'+(fin?' — Final Scoring':' — Race '+(G.race+1))+'</button></div>';
  el.innerHTML=h;
}

function applyEnd(rank){
  const t=G.cal[G.race-1]; const fin=G.race===8;
  const pcp=fin?[6,4,2,0]:[3,2,1,0]; // 1st/2nd/3rd/4th, doubled on Race 8 Finale
  // Track worst finish position for 370Z's Iron Man achievement — runs for everyone, DNF included
  rank.forEach((pi,pos)=>{
    const p=G.P[pi];
    const effectivePos=G.dnf[pi]?99:pos; // DNF counts as worse than any finish, breaking the streak
    if(effectivePos>p.worstFinishPos)p.worstFinishPos=effectivePos;
  });
  rank.forEach((pi,pos)=>{
    const p=G.P[pi]; if(G.dnf[pi])return;
    p.cp+=pcp[Math.min(pos,3)];
    if(!p.reckR){p.cp++;log(p.name+': +1 CP (Clean Run — zero Reckless declarations this race)','w');} // Clean Run bonus: ANY position, +1 CP, no Reckless this race
    if(t.sp==='albert'&&pos===0){p.cp++;p.wins++;}
    if(pos===0&&!G.dnf[pi])p.wins++;
    if(pos<2&&!G.dnf[pi])p.topTwos++;
    // Crowd Favourite (Mustang): outright race win -> +3 extra Credits
    if(pos===0&&p.ability&&p.ability.k==='crowd_favourite'){p.creds+=3;log(p.name+': Crowd Favourite +3 Credits (won the race)','k');}
    // Clinical Efficiency (Audi TT): won EXACTLY 1 Segment this race -> +2 Credits
    if(p.ability&&p.ability.k==='clinical_efficiency'&&G.segW[pi]===1){p.creds+=2;log(p.name+': Clinical Efficiency +2 Credits (won exactly 1 Segment)','k');}
  });
  // Reset DNF reliability
  G.P.forEach((p,i)=>{if(G.dnf[i])p.R=p.Rb;});
  // Restore Cooling reduced by Hidden Valley's track special — use the exact amount that was actually
  // subtracted (could be less than 1 if the car was already at the Cooling floor) to prevent drift
  if(t.sp==='darwin')G.P.forEach(p=>{p.C+=(p._darwinReduced||0);p._darwinReduced=0;});
  // Remove temp weather heat (t and w already declared above)
  if(G.w.heat)G.P.forEach(p=>p.heat=Math.max(0,p.heat-G.w.heat));
  if(t.sp==='hot'||t.sp==='perth')G.P.forEach(p=>p.heat=Math.max(0,p.heat-1));
  // Fatigue decay
  G.P.forEach((p,i)=>{
    if(p.fat>0){const pos=rank.indexOf(i);const clean=pos<2&&!p.reckR&&!G.dnf[i];p.fat=Math.max(0,p.fat-(clean?2:1));}
    p.nitrousUsed=false; p.nitroCircusUsed=false; // reckR reset happens in next doIncome(), not here
  });
  // Milestone Race 4
  if(G.race===4){
    const last=rank[rank.length-1]; G.P[last].cp+=2;
    log('★ MILESTONE: '+G.P[last].name+' (last) +2 CP Underdog Bonus!','w');
    const ms=G.P.map((_,i)=>i).sort((a,b)=>G.P[b].segW-G.P[a].segW)[0];
    G.P[ms].cp+=1; log('★ MILESTONE: '+G.P[ms].name+' (most Segs) +1 CP Specialist!','w');
  }
  if(G.sponsDeck.length)G.sponsFU.push(G.sponsDeck.shift());
  G.standings=[...rank];
  if(fin){G.phase='gameover';rr();return;}
  G.phase='summary'; rr();
}

function continueToNextRace(){
  G.race++; newRace();
}

// ── GAME OVER ─────────────────────────────────────────────────────────
function phGameOver(el){
  const mP=Math.max(...G.P.map(p=>p.P)), mH=Math.max(...G.P.map(p=>p.H));
  const mA=Math.max(...G.P.map(p=>p.A)), mB=Math.max(...G.P.map(p=>p.B));
  const mC=Math.max(...G.P.map(p=>p.C));
  const mHt=Math.max(...G.P.filter(p=>p.dnfs===0).map(p=>p.maxHeat),0);
  const mI=Math.max(...G.P.map(p=>p.installed.length));
  const mCr=Math.max(...G.P.map(p=>p.creds));
  G.P.forEach((p,i)=>{
    p._bon=[];
    if(p.rc<=4){p.cp+=2;p._bon.push('Clean Driver +2 CP (Reckless Counter stayed at '+p.rc+', 4 or below all Championship)');}
    if(p.P===mP){p.cp+=2;p._bon.push('Power Champion +2 CP (highest final Power stat: '+p.P+')');}
    if(p.H===mH){p.cp+=2;p._bon.push('Handling Champion +2 CP (highest final Handling stat: '+p.H+')');}
    if(p.dnfs===0){p.cp+=2;p._bon.push('Reliability Master +2 CP (completed all 8 races with zero DNFs)');}
    if(p.ability&&p.ability.k==='spec_racer'&&!p.installed.some(u=>u.tier)){p.cp+=2;p._bon.push('Spec Racer +2 CP (zero S-Tier upgrades all Championship)');}
    if(p.car){let d=0;['P','H','B','A','C'].forEach(s=>{if(p[s]>p.car[s]+2)d++;});if(d>=4){p.cp+=2;p._bon.push('Diversified Builder +2CP ('+d+' stats +2 above base)');}}
    G.activeGoals.forEach(g=>{
      let e=false;
      if(g.n==='Aero Specialist'&&p.A===mA)e=true;
      if(g.n==='Brake Authority'&&p.B===mB)e=true;
      if(g.n==='Cooling Expert'&&p.C===mC)e=true;
      if(g.n==='Risk Taker'&&p.maxHeat===mHt&&p.dnfs===0)e=true;
      if(g.n==='Budget Builder'&&p.creds===mCr)e=true;
      if(g.n==='Workshop Master'&&p.installed.length===mI)e=true;
      if(e){p.cp+=g.cp;p._bon.push(g.n+' +'+g.cp+'CP');}
    });
    if(p.sponsor){
      const sp=p.sponsor; let e=false;
      if(sp.name==='Red Bull Racing AU'&&p.segW>=10)e=true;
      if(sp.name==='Shell V-Power'&&p.P>=10)e=true;
      if(sp.name==='Michelin Motorsport'&&p.H>=10)e=true;
      if(sp.name==='Brembo'&&p.B>=8)e=true;
      if(sp.name==='HKS Performance'&&p.P>=9)e=true;
      if(sp.name==='Bilstein Suspension'&&p.H>=9)e=true;
      if(sp.name==='Toyota Gazoo Racing'&&p.dnfs===0)e=true;
      if(sp.name==='Castrol EDGE'&&p.dnfs===0)e=true;
      if(sp.name==='Motul'&&p.repairs>=3)e=true;
      if(sp.name==='Pirelli'&&p.topTwos>=5)e=true;
      if(sp.name==='Monster Energy'&&p.rc>=8&&p.dnfs===0)e=true;
      if(sp.name==='Nitro Circus'&&p.rc>=6&&p.dnfs===0)e=true;
      if(sp.name==='GoPro'&&p.wins>=3)e=true;
      if(sp.name==='Garrett Turbo'&&p.installed.filter(u=>u.tag==='Turbocharger'||u.tag==='Supercharger').length>=2)e=true;
      if(sp.name==='PWR Cooling'&&p.C>=7)e=true;
      if(sp.name==='APR Performance'&&p.A>=6)e=true;
      if(sp.name==='Cusco Japan'&&p.installed.filter(u=>u.cat==='Drivetrain'||u.cat==='Transmission').length>=2)e=true;
      if(sp.name==='Haltech + Link ECU'&&p.installed.filter(u=>u.cat==='Electronics').length>=2)e=true;
      if(sp.name==='Haltech ECU'&&p.dnfs===0)e=true;
      if(sp.name==='Bridgestone'&&p.rc<=4)e=true;
      if(e){p.cp+=sp.endCp;p._bon.push(sp.name+' Sponsor +'+sp.endCp+'CP');}
    }
    // ── CAR ACHIEVEMENTS — alternate win conditions, not just bonus CP ──
    // Each is a genuinely different kind of challenge matched to that car's identity.
    // If achieved, the car WINS the Championship outright, overriding normal CP ranking
    // (ties between multiple achieved players still fall back to CP as the tiebreak).
    const cid=p.carId;
    if(cid==='gt86'){
      // Track Master: win at least 1 Segment on every distinct base track-type category across the Championship
      const allTypes=new Set(G.cal.map(t=>t.ty.replace(/\s*★+\s*$/,'').trim()));
      const wonAllTypes=[...allTypes].every(ty=>p.trackTypesWon.has(ty));
      if(wonAllTypes&&p.trackTypesWon.size>=4){
        p.achWon='Track Master — won at least one Segment on every track type this Championship faced ('+p.trackTypesWon.size+' types)';
        p._bon.push('🏆 GT86 TRACK MASTER — CHAMPIONSHIP WIN (adapted to every circuit type)');
      }
    }
    if(cid==='z370'){
      // Iron Man: finished every single race 3rd or better (or didn't race), zero DNFs, all 8 races
      if(p.dnfs===0&&p.worstFinishPos<=2&&G.race>=8){
        p.achWon='Iron Man — never finished worse than 3rd in any of the 8 races, zero DNFs';
        p._bon.push('🏆 370Z IRON MAN — CHAMPIONSHIP WIN (flawless consistency)');
      }
    }
    if(cid==='auditt'){
      // Weatherproof: never lost a Segment while penalty Weather was active, all Championship
      if(!p._ttWeatherLossThisChamp&&p.dnfs===0){
        p.achWon='Weatherproof — never lost a Segment under penalty Weather conditions all Championship';
        p._bon.push('🏆 AUDI TT WEATHERPROOF — CHAMPIONSHIP WIN (immune to the elements)');
      }
    }
    if(cid==='mx5'){
      // True to Form: zero S-Tier upgrades installed, ever, AND 8+ Segment wins on raw skill
      const stierCount=p.installed.filter(u=>u.tier).length;
      if(stierCount===0&&p.segW>=8){
        p.achWon='True to Form — zero S-Tier upgrades all Championship, '+p.segW+' Segment wins on raw skill';
        p._bon.push('🏆 MX-5 TRUE TO FORM — CHAMPIONSHIP WIN (skill over horsepower)');
      }
    }
    if(cid==='mustang'){
      // The Knockout: at least one Segment win by a margin of 8+ points over 2nd place
      if(p.biggestMargin>=8){
        p.achWon='The Knockout — won a Segment by '+p.biggestMargin+' points, a margin no other car could answer';
        p._bon.push('🏆 MUSTANG THE KNOCKOUT — CHAMPIONSHIP WIN (one decisive blow)');
      }
    }
  });
  // If any player(s) hit their car's alternate win condition, they win outright — CP only breaks ties between them
  const achievers=G.P.map((_,i)=>i).filter(i=>G.P[i].achWon);
  if(achievers.length){
    achievers.sort((a,b)=>G.P[b].cp-G.P[a].cp);
    G.championAchieved=achievers[0];
  }
  // If a Car Achievement was triggered, that player wins outright — rank them first regardless of CP
  let final=[...G.P.map((_,i)=>i)].sort((a,b)=>G.P[b].cp-G.P[a].cp);
  if(typeof G.championAchieved==='number'){
    final=[G.championAchieved,...final.filter(i=>i!==G.championAchieved)];
  }
  let h='<div class="card"><div class="ct" style="font-size:.88rem;color:var(--gd);">🏆 CHAMPIONSHIP COMPLETE</div>';
  if(typeof G.championAchieved==='number'){
    const champ=G.P[G.championAchieved];
    h+='<div class="info" style="background:#1a1300;border-color:var(--gd);border-width:2px;line-height:1.8;">'
      +'<strong style="color:var(--gd);font-size:.85rem;">⚡ ALTERNATE WIN CONDITION TRIGGERED ⚡</strong><br>'
      +'<strong style="color:'+champ.col+';">'+champ.name+'</strong> won the Championship via their car\'s unique achievement, not Championship Points:<br>'
      +'<em style="color:#ddd;">"'+champ.achWon+'"</em><br>'
      +'<span style="font-size:.65rem;color:#999;">Normal CP standings are shown below for reference, but this result overrides them.</span>'
      +'</div>';
  }
  h+='<div class="info" style="background:#0a1408;border-color:#1a3a1a;line-height:1.8;">'
    +'<strong style="color:#6ce06c;">Final Championship Points = Race CP (already earned across all 8 races) + End-Game Bonus CP (calculated once, right now).</strong><br>'
    +'End-Game Bonuses come from 3 sources: <strong>Static Goals</strong> (always active — Power/Handling Champion, Reliability Master, Diversified Builder), '
    +'<strong>Random Goals</strong> (2 of 6 possible, chosen at game start — see the Goals tab), and <strong>Car-Specific Achievements</strong> — each car now has one unique alternate WIN CONDITION (not just bonus CP) tied to its identity. Triggering it wins the Championship outright.<br>'
    +'Each player\'s qualifying bonuses are listed under their name below.'
    +'</div>';
  final.forEach((i,pos)=>{
    const p=G.P[i];
    const isChamp=i===G.championAchieved;
    h+='<div style="display:flex;align-items:start;gap:10px;padding:9px 0;border-bottom:1px solid #1a1a1a;'+(isChamp?'background:#1a1300;border-radius:6px;padding-left:8px;':'')+'">'
      +'<div style="font-size:1.3rem;">'+(isChamp?'⚡':MED[Math.min(pos,3)])+'</div>'
      +'<div style="flex:1;">'
      +'<div style="color:'+p.col+';font-weight:700;font-size:.9rem;">'+p.name+(isAI(i)?'<span style="font-size:.6rem;color:#6cb4ee;"> [AI: '+AI_P[p.ai].label+']</span>':'')+(isChamp?'<span style="color:var(--gd);font-size:.65rem;"> — CHAMPIONSHIP WINNER (alternate)</span>':'')+'</div>'
      +'<div style="font-size:.65rem;color:#666;margin-top:1px;">'+(p.car?p.car.name:'—')+' | '+p.installed.length+' upgrades | RC:'+p.rc+' | DNFs:'+p.dnfs+'</div>'
      +(p._bon.length?'<div style="font-size:.65rem;color:#6ce06c;margin-top:2px;">'+p._bon.join(' | ')+'</div>':'<div style="font-size:.65rem;color:#555;">No end-game bonuses</div>')
      +'</div>'
      +'<div style="font-size:1.4rem;font-weight:700;color:var(--gd);">'+p.cp+'</div>'
      +'</div>';
  });
  h+='<div class="warn" style="margin:10px 0;">'+(typeof G.championAchieved==='number'?'Alternate win condition overrides normal CP ranking. ':'')+'Tie-breakers: Race Wins → Segment Wins → Reliability → Reckless Counter.</div>';
  // Full car build review
  h+='<div style="margin-top:16px;"><div class="ct" style="font-size:.8rem;margin-bottom:10px;">Championship Car Build Review</div>';
  final.forEach(function(pi){
    var p=G.P[pi];
    h+='<div style="background:var(--pn);border:2px solid '+p.col+'44;border-radius:6px;padding:12px;margin-bottom:12px;">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    h+='<div><span style="font-weight:700;color:'+p.col+';font-size:.95rem;">'+p.name+'</span>';
    h+=' <span style="font-size:.7rem;color:#888;">'+(p.car?p.car.name:'—')+'</span></div>';
    h+='<span style="font-size:1.3rem;font-weight:700;color:var(--gd);">'+p.cp+' CP</span>';
    h+='</div>';
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">';
    ['P','H','B','A','C','R'].forEach(function(s){
      h+='<div style="background:#111;border-radius:4px;padding:4px 8px;text-align:center;min-width:52px;">';
      h+='<div style="font-size:.5rem;color:#888;">'+SN[s]+'</div>';
      h+='<div style="font-size:1.1rem;font-weight:700;color:var(--gd);">'+p[s]+'</div>';
      h+='</div>';
    });
    h+='<div style="background:#111;border-radius:4px;padding:4px 8px;text-align:center;min-width:52px;">';
    h+='<div style="font-size:.5rem;color:#ff8800;">Max Heat</div>';
    h+='<div style="font-size:1.1rem;font-weight:700;color:#ff8800;">'+(p.maxHeat||0)+'</div>';
    h+='</div>';
    h+='</div>';
    h+=renderInstalledCards(p);
    h+='</div>';
  });
  h+='</div>';
  h+='<button class="btn" onclick="location.reload()">🔄 New Championship</button></div>';
  el.innerHTML=h;
}

// ── BOARDS ────────────────────────────────────────────────────────────

function renderInstalledCards(p){
  try{
  if(!p||!p.installed||!p.installed.length)return '<div style="margin-top:8px;font-size:.62rem;color:#333;font-style:italic;">No upgrades installed yet.</div>';
  var cards=p.installed.map(function(u){
    var pills='';
    if(u.stat&&u.val)pills+='<span style="background:#051005;border:1px solid #2a5a2a;border-radius:8px;padding:1px 6px;font-size:.55rem;color:#6ce06c;font-weight:700;">+'+u.val+' '+SN[u.stat]+'</span> ';
    if(u.heat)pills+='<span style="background:#100a00;border:1px solid #5a3000;border-radius:8px;padding:1px 6px;font-size:.55rem;color:#ff8c00;">+'+u.heat+' Heat</span> ';
    if(u.x&&u.x.indexOf('unlock')===0)pills+='<span style="background:#050a14;border:1px solid #1a3a6c;border-radius:8px;padding:1px 6px;font-size:.52rem;color:#6cb4ee;">'+u.x.replace('unlock_','Unlocks ').toUpperCase()+'</span>';
    if(u.x==='nitrous')pills+='<span style="background:#140014;border:1px solid #6a006a;border-radius:8px;padding:1px 6px;font-size:.52rem;color:#dd88ff;">NITROUS</span>';
    var tb=u.tier?'<span style="font-size:.45rem;background:#2a1a00;color:var(--gd);border:1px solid var(--gd);border-radius:2px;padding:1px 4px;font-weight:700;margin-right:4px;">S-TIER</span>'
           :u.wc>=2?'<span style="font-size:.45rem;background:#050f1a;color:#6cb4ee;border:1px solid #1a3a6c;border-radius:2px;padding:1px 4px;font-weight:700;margin-right:4px;">MAJOR</span>'
           :'<span style="font-size:.45rem;background:#051005;color:#90d090;border:1px solid #2a5a2a;border-radius:2px;padding:1px 4px;font-weight:700;margin-right:4px;">MINOR</span>';
    return '<div style="background:#0f0f0f;border:2px solid '+(u.tier?'#5a3a00':u.wc>=2?'#1a3a6c':'#2a2a2a')+';border-radius:6px;padding:8px 10px;min-width:140px;max-width:180px;">'
      +'<div style="display:flex;align-items:center;margin-bottom:4px;">'+tb+'<div style="font-size:.68rem;font-weight:700;color:#fff;">'+u.n+'</div></div>'
      +'<div style="font-size:.6rem;color:#ccc;margin-bottom:5px;line-height:1.4;">'+u.eff+'</div>'
      +'<div style="font-size:.55rem;color:#555;font-style:italic;margin-bottom:4px;">'+u.desc+'</div>'
      +'<div style="display:flex;gap:3px;flex-wrap:wrap;">'+pills+'</div>'
      +'</div>';
  });
  return '<div style="margin-top:8px;"><div style="font-size:.62rem;color:#888;margin-bottom:6px;font-weight:700;letter-spacing:.5px;">INSTALLED UPGRADES ('+p.installed.length+')</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;">'+cards.join('')+'</div></div>';
  }catch(e){console.error('renderInstalledCards err:',e,p);return '';}
}

function renderBoards(){
  $('boardsGrid').innerHTML=G.P.map((p,i)=>{
    const mx=Math.max(8,p.heat+2);
    const pips=Array.from({length:mx},(_,j)=>'<div class="hp'+(j<p.heat?(j>=p.C?' hot':' on'):'')+'"></div>').join('');
    return '<div class="pb" style="border-color:'+p.col+'55;">'
      +'<div style="display:flex;justify-content:space-between;align-items:start;">'
      +'<div><div class="pname" style="color:'+p.col+'">'+p.name+(isAI(i)?'<span style="font-size:.55rem;color:#6cb4ee;"> [AI]</span>':'')+'</div>'
      +'<div class="pcar-lbl">'+(p.car?p.car.name+' — '+p.car.sub:'No car')+'</div></div>'
      +'<div class="cpbig">'+p.cp+' CP</div></div>'
      +'<div class="srow">'+['P','H','B','A'].map(s=>'<div class="sp">'+SN[s]+' <span>'+p[s]+'</span></div>').join('')
      +'<div class="sp">Cool <span>'+p.C+'</span></div>'
      +'<div class="sp">Rel <span style="color:'+(p.R<=2?'var(--red)':'var(--gd)')+'">'+p.R+'/'+p.Rb+'</span></div>'
      +'</div>'
      +'<div class="rrow"><div>'+p.creds+' Cr</div><div>'+p.mechs+' Mech ('+(p.mechs*2)+'WC)</div>'
      +'<div>'+p.engs+' Eng</div>'
      +'<div style="color:'+(p.rc>=5?'#ff8800':'inherit')+'">RC:'+p.rc+(p.rc>=5?' !':'')+'</div>'
      +'<div style="color:'+(p.fat>0?'var(--red)':'#555')+'">Fat:'+p.fat+'</div>'
      +(p.fuel!=='pump98'?'<div style="color:var(--gd);">⛽ '+FUELS.find(f=>f.id===p.fuel).name+'</div>':'')
      +'</div>'
      +(p.ability?'<div style="background:#1a1400;border:1px solid #5a4a00;border-radius:4px;padding:4px 7px;margin-bottom:4px;"><div style="font-size:.62rem;color:var(--gd);font-weight:700;">★ '+p.ability.n+'</div><div style="font-size:.56rem;color:#999;line-height:1.4;margin-top:1px;">'+p.ability.e+'</div></div>':'')
      +(p.sponsor?'<div style="font-size:.6rem;color:var(--gd);margin-bottom:2px;">♦ '+p.sponsor.name+'</div>':'')
      +'<div style="font-size:.6rem;color:#888;margin-bottom:2px;">Heat '+p.heat+' / Cool '+p.C+(p.heat>p.C?' ⚠ OVERHEATING!':'')+'</div>'
      +'<div style="font-size:.58rem;color:#888;margin-top:4px;margin-bottom:2px;">'+'Heat: <strong style="color:'+(p.heat>p.C?'var(--red)':'#ff8800')+';">'+p.heat+'</strong>'+' / Cooling: <strong style="color:#6cb4ee;">'+p.C+'</strong>'+(p.heat>p.C?' <span style="color:var(--red);">⚠ OVERHEATING — Overheat Check required before race starts!</span>':''+(p.heat===p.C?' <span style="color:#ff8800;">At limit — any extra Heat triggers a check</span>':' — safe'))+'</div>'+'<div style="font-size:.54rem;color:#555;margin-bottom:3px;line-height:1.5;">'+'Heat exceeds Cooling → automatic -1 Reliability + D6 roll. On fail: -2 more Reliability. '+'<strong>Heat from upgrades/fuel is permanent this race.</strong> '+'Data Logger card = reroll one failed check per race.'+'</div>'+'<div class="hbar">'+pips+'</div>'
      +'<div style="margin-top:6px;"><div style="font-size:.6rem;color:#888;margin-bottom:4px;font-weight:700;">Installed Upgrades ('+p.installed.length+'):</div>'+'<div style="display:flex;flex-wrap:wrap;gap:3px;">'+(p.installed.map(u=>'<div style="background:#1a1a1a;border:1px solid '+(u.tier?'#5a3a00':'#2a2a2a')+';border-radius:3px;padding:3px 7px;font-size:.55rem;">'+(u.tier?'<span style="color:var(--gd);font-size:.45rem;font-weight:700;margin-right:3px;">S</span>':'')+'<span style="color:#ddd;font-weight:700;">'+u.n+'</span>'+(u.stat&&u.val?'<span style="color:#6ce06c;margin-left:3px;">+'+u.val+' '+SN[u.stat]+'</span>':'')+(u.heat?'<span style="color:#ff8800;margin-left:3px;">+'+u.heat+' Heat</span>':'')+'</div>').join('')||'<span style="color:#2a2a2a;font-size:.6rem;">None yet</span>')+'</div></div>'
      +(p.wip&&p.wip.length?'<div style="font-size:.6rem;color:#6cb4ee;margin-top:3px;">Installing: '+p.wip.map(w=>w.card.n+' ('+w.wc_paid+'/'+w.wc_total+' WC)').join(', ')+'</div>':'')
      +(p.garage.length?'<div style="font-size:.58rem;color:#444;margin-top:2px;">Workshop: '+p.garage.map(u=>u.n).join(', ')+'</div>':'')
      +'</div>';
  }).join('');
}

// ── GOALS & SPONSORS ──────────────────────────────────────────────────
function renderGoals(){
  const el=$('goalsDisplay'); if(!el)return;
  let h='<div style="font-size:.67rem;font-weight:700;color:#777;margin-bottom:5px;">STATIC GOALS — always scored:</div>';
  STATIC_GOALS.forEach(g=>{
    let lead='?';
    if(g.key==='P'){const m=Math.max(...G.P.map(p=>p.P));lead=G.P.filter(p=>p.P===m).map(p=>p.name).join(', ')+' (P='+m+')';}
    if(g.key==='H'){const m=Math.max(...G.P.map(p=>p.H));lead=G.P.filter(p=>p.H===m).map(p=>p.name).join(', ')+' (H='+m+')';}
    if(g.key==='dnf'){const nd=G.P.filter(p=>p.dnfs===0).map(p=>p.name);lead=nd.length?nd.join(', '):'None';}
    if(g.key==='div')lead='Evaluated at Race 8';
    h+='<div class="goalcard"><span style="font-size:.9rem;font-weight:700;color:var(--gd);float:right;">+'+g.cp+' CP</span>'
      +'<div style="font-weight:700;color:#fff;margin-bottom:2px;">'+g.n+'</div>'
      +'<div style="font-size:.67rem;color:#bbb;margin-bottom:3px;">'+g.desc+'</div>'
      +'<div style="font-size:.62rem;color:#888;">Leading: <span style="color:#fff;">'+lead+'</span></div>'
      +'</div>';
  });
  h+='<div style="font-size:.67rem;font-weight:700;color:var(--gd);margin:8px 0 5px;">RANDOM GOALS — 2 active this Championship:</div>';
  G.activeGoals.forEach(g=>{
    h+='<div class="goalcard active"><span style="font-size:.9rem;font-weight:700;color:var(--gd);float:right;">+'+g.cp+' CP</span>'
      +'<div style="font-weight:700;color:#fff;margin-bottom:2px;">'+g.n+'</div>'
      +'<div style="font-size:.67rem;color:#bbb;">'+g.desc+'</div>'
      +'</div>';
  });
  el.innerHTML=h;
}

function renderSponsors(){
  const el=$('sponsorDisplay'); if(!el)return;
  let h='';
  G.P.forEach(p=>{
    if(!p.carId)return;
    h+='<div style="display:flex;gap:7px;padding:5px 0;border-bottom:1px solid #1a1a1a;align-items:start;">'
      +'<div style="width:8px;height:8px;border-radius:50%;background:'+p.col+';margin-top:3px;flex-shrink:0;"></div>'
      +'<div><strong style="color:'+p.col+'">'+p.name+'</strong> '
      +(p.sponsor
        ?'<span style="color:var(--gd);font-size:.68rem;">♦ '+p.sponsor.name+'</span><div style="font-size:.65rem;color:#bbb;margin-top:1px;">'+p.sponsor.bonus+'</div><div style="font-size:.6rem;color:var(--gd);">+'+p.sponsor.endCp+' CP if: '+p.sponsor.endCond+'</div>'
        :'<span style="font-size:.67rem;color:#444;">No Sponsor</span>')
      +'</div></div>';
  });
  el.innerHTML=h||'<div style="color:#444;font-size:.72rem;">No cars assigned yet</div>';
  const el2=$('sponsorAvail'); if(!el2)return;
  if(!G.sponsFU.length){el2.innerHTML='<div style="color:#555;font-size:.7rem;">None available</div>';return;}
  el2.innerHTML=G.sponsFU.map(sp=>'<div style="background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:5px;">'
    +'<div style="font-weight:700;color:var(--gd);margin-bottom:2px;">'+sp.name+' <span style="font-size:.6rem;color:#888;">('+sp.fee+' Cr)</span></div>'
    +'<div style="font-size:.65rem;color:#888;">'+sp.cat+'</div>'
    +'<div style="font-size:.68rem;color:#ddd;margin-top:3px;line-height:1.5;">'+sp.bonus+'</div>'
    +'<div style="font-size:.65rem;color:var(--gd);margin-top:2px;">+'+sp.endCp+' CP if: '+sp.endCond+'</div>'
    +'</div>').join('');
}

// ── STANDINGS ─────────────────────────────────────────────────────────
function renderStandings(){
  const sorted=[...G.P.map((_,i)=>i)].sort((a,b)=>G.P[b].cp-G.P[a].cp);
  $('stbl').innerHTML='<tr><th>Pos</th><th>Player</th><th>Car</th><th>Champ. Points</th><th>Credits</th><th>Heat/Cooling</th><th>Reckless Counter</th><th>Fatigue</th><th>Upgrades</th><th>Sponsor</th></tr>'
    +sorted.map((i,pos)=>{const p=G.P[i];return '<tr>'
      +'<td>'+MED[Math.min(pos,3)]+' '+(pos+1)+'</td>'
      +'<td><span style="color:'+p.col+'"><strong>'+p.name+'</strong></span>'+(isAI(i)?'<br><span style="font-size:.58rem;color:#6cb4ee;">AI: '+AI_P[p.ai].label+'</span>':'')+'</td>'
      +'<td style="font-size:.68rem;">'+(p.car?p.car.name:'—')+'<br>'+(p.ability?'<span style="color:#888;font-size:.6rem;">★ '+p.ability.n+'</span>':'')+'</td>'
      +'<td style="color:var(--gd)"><strong>'+p.cp+'</strong></td>'
      +'<td>'+p.creds+'</td>'
      +'<td style="color:'+(p.heat>p.C?'var(--red)':'#aaa')+'">'+p.heat+'/'+p.C+(p.heat>p.C?' ⚠':'')+'</td>'
      +'<td style="color:'+(p.rc>=5?'#ff8800':'inherit')+'">'+p.rc+'</td>'
      +'<td style="color:'+(p.fat>0?'var(--red)':'#555')+'">'+p.fat+'</td>'
      +'<td>'+p.installed.length+'</td>'
      +'<td style="font-size:.62rem;color:var(--gd);">'+(p.sponsor?p.sponsor.name:'—')+'</td>'
      +'</tr>';}).join('');
}

// ── RULES TAB ─────────────────────────────────────────────────────────
function renderRulesCars(){
  $('rcars').innerHTML=CARS.map(c=>'<div class="ccard" style="cursor:default;">'
    +'<div class="cname" style="color:'+c.col+'">'+c.name+'</div>'
    +'<div class="csub">'+c.sub+'</div>'
    +'<div class="smini">'+['P','H','B','A','C','R'].map(s=>'<div class="sm"><div class="sl">'+SN[s]+'</div><div class="sv">'+c[s]+'</div></div>').join('')+'</div>'
    +'<div style="font-size:.57rem;color:#666;margin-bottom:3px;line-height:1.5;"><strong style="color:#888;">Strength:</strong> '+c.str+'</div>'
    +'<div style="font-size:.57rem;color:#444;margin-bottom:3px;line-height:1.5;"><strong>Weakness:</strong> '+c.weak+'</div>'
    +'<div style="font-size:.57rem;color:var(--gd);line-height:1.4;">★ Achievement: '+c.ach+'</div>'
    +'</div>').join('');
}

function renderAbilTabs(carId){
  $('abilTabs').innerHTML=CARS.map(c=>'<div style="padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.65rem;background:'+(c.id===carId?'var(--red)':'#1a1a1a')+';border:1px solid '+(c.id===carId?'var(--red)':'#333')+';color:'+(c.id===carId?'#fff':'#888')+'" onclick="renderAbilTabs(\''+c.id+'\')">'+c.name+'</div>').join('');
  const ab=ABILITIES[carId]||[];
  $('abilContent').innerHTML='<div class="ugrid">'+ab.map(a=>'<div style="background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:9px;">'
    +'<div style="font-weight:700;color:var(--gd);margin-bottom:3px;font-size:.78rem;">'+a.n+'</div>'
    +'<div style="font-size:.7rem;color:#ddd;margin-bottom:3px;line-height:1.5;">'+a.e+'</div>'
    +'<div style="font-size:.62rem;color:#666;font-style:italic;">'+a.d+'</div>'
    +'</div>').join('')+'</div>';
}

function renderFuelRef(){
  const el=$('fuelRef'); if(!el)return;
  el.innerHTML='<div class="fgrid">'+FUELS.map(f=>'<div class="fcard avail" style="cursor:default;">'
    +'<div class="fname">'+f.name+'</div>'
    +'<div style="font-size:.67rem;color:#bbb;margin-bottom:4px;line-height:1.4;">'+f.eff+'</div>'
    +'<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px;">'+f.tags.map(t=>'<span class="badge bg" style="font-size:.5rem;">'+t+'</span>').join('')+'</div>'
    +'<div style="font-size:.6rem;color:var(--gd);">'+(f.cost?'Unlock cost: '+f.cost+' Cr (one-time, then free)':'Always free')+'</div>'
    +'<div style="font-size:.58rem;color:#555;margin-top:3px;">'+f.reqText+'</div>'
    +'</div>').join('')+'</div>';
}

// ── TABS ──────────────────────────────────────────────────────────────
function ST(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  document.querySelector('.tab[onclick="ST(\''+name+'\')"]').classList.add('on');
  $('tab-'+name).classList.add('on');
  if(name==='boards')renderBoards();
  if(name==='standings')renderStandings();
  if(name==='goals'){renderGoals();renderSponsors();}
}

// ── BOOT ──────────────────────────────────────────────────────────────
init(); resetAuction();
