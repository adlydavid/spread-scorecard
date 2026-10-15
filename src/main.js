(function(){
  "use strict";
  var state={side:"sales",month:null,q:"",former:false,sort:{sales:["spread","desc"],recruiting:["spread","desc"]}};
  var MONTHS={}, META=null, TARGETS=null;
  // From the latest weekly spread report and the Bullhorn sync (see netlify/functions/data.mjs); null until uploaded.
  var REPORT=null, REPORT_WEEKS=[], PRIMES=null, RECONTACT=null, FORECAST=null;
  // Commercial users, left off the Sales and Recruiting tables (their spread stays in the company total).
  var EXCLUDED={Salemi:1,Rogers:1,Driscoll:1};
  var SIDES=["sales","recruiting","primes","recontact","spread"];
  var PERIODS={};
  try{var s=localStorage.getItem("ss-side"); if(SIDES.indexOf(s)>=0) state.side=s;}catch(e){}
  // People table view: hidden column keys per side ("tcol" for the % of target column), and row density.
  // Name and Spread always show; the Team total row isn't a column, so it always shows too.
  var HIDDEN={sales:[],recruiting:[]}, LOCKED={full:1,spread:1}, compact=false, colsOpen=false;
  try{ var hc=JSON.parse(localStorage.getItem("ss-cols")); if(hc) ["sales","recruiting"].forEach(function(sd){ if(Array.isArray(hc[sd])) HIDDEN[sd]=hc[sd]; }); }catch(e){}
  try{ compact=localStorage.getItem("ss-density")==="compact"; }catch(e){}
  function shown(side,k){ return !!LOCKED[k] || HIDDEN[side].indexOf(k)<0; }

  var $=function(id){return document.getElementById(id)};
  var fmt=new Intl.NumberFormat("en-US");
  function money(v){ if(v==null) return "—"; return "$"+fmt.format(Math.round(v)); }
  function moneyMM(v,dec){ return v==null? "—" : "$"+(v/1e6).toFixed(dec==null? 2 : dec)+"MM"; }
  function moneyK(v){ if(v==null) return "—"; if(Math.abs(v)>=1e6) return "$"+(v/1e6).toFixed(2)+"M"; return "$"+Math.round(v/1000)+"k"; }
  function n(v){ return v==null? "—" : fmt.format(v); }
  function ratio(a,b){ if(!b) return null; return a/b; }
  function rtxt(r){ return r==null? "—" : (r>=10? Math.round(r) : r.toFixed(1))+" : 1"; }
  function pct(r){ return r==null? "—" : Math.round(r*100)+"%"; }
  function dateLabel(s){ var p=s.split("-"); var d=new Date(+p[0],+p[1]-1,+p[2]); return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
  // "Hannah Wilkinson" -> "HW"; first and last word, letters only
  function initials(full){ var w=String(full||"").replace(/\(.*?\)/g,"").replace(/[^A-Za-z\s'-]/g,"").trim().split(/\s+/).filter(Boolean); return w.length? (w[0][0]+(w.length>1? w[w.length-1][0] : "")).toUpperCase() : ""; }
  // Motion: why the next render() happens. "load" fades the sections in; "month" (a new month or tab) grows the chart
  // bars and counts the KPIs up. Other renders (search, sort, toggles, reloads) don't animate. Reduced motion turns it off.
  var motion="load";
  function animate(kind){ motion=kind; }
  function motionOK(){ try{ return window.matchMedia("(prefers-reduced-motion: no-preference)").matches && !window.matchMedia("print").matches; }catch(e){ return false; } }
  // Counts the first number in a formatted value ("$612,345", "9.5 : 1", "45%") up from 0, keeping its format.
  // The moving text is hidden from screen readers; a hidden copy holds the final value.
  var counting=[];
  function countUp(node,text){
    var mt=/[\d,]*\.?\d+/.exec(text); if(!mt) return;
    var raw=mt[0], end=parseFloat(raw.replace(/,/g,"")), dec=(raw.split(".")[1]||"").length, comma=raw.indexOf(",")>=0;
    if(!end) return;
    node.textContent="";
    var vis=el("span",null,text), sr=el("span","sr-only",text); vis.setAttribute("aria-hidden","true");
    node.appendChild(vis); node.appendChild(sr);
    function show(v){ var f= comma? v.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : v.toFixed(dec); vis.textContent=text.slice(0,mt.index)+f+text.slice(mt.index+raw.length); }
    var job={done:function(){ vis.textContent=text; job.stop=true; }}, t0=null, D=380;
    counting.push(job);
    function step(ts){
      if(job.stop) return;
      if(t0==null) t0=ts;
      var p=Math.min(1,(ts-t0)/D), e=1-Math.pow(1-p,3); // ease out
      if(p<1){ show(end*e); requestAnimationFrame(step); } else job.done();
    }
    show(0); requestAnimationFrame(step);
  }
  function finishCounts(){ counting.forEach(function(j){ j.done(); }); counting=[]; }
  window.addEventListener("beforeprint",finishCounts);
  function el(tag,cls,text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }

  // CSV export. Text that a spreadsheet would read as a formula gets a leading apostrophe.
  function csvCell(v){
    if(v==null) return "";
    if(typeof v==="number") return String(Math.round(v*100)/100);
    var s=String(v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
    return /[",\r\n]/.test(s)? '"'+s.replace(/"/g,'""')+'"' : s;
  }
  function downloadCSV(file,rows){
    var text=String.fromCharCode(0xFEFF)+rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n")+"\r\n"; // BOM so Excel reads UTF-8
    var url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
    var a=el("a"); a.href=url; a.download=file; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },0);
  }
  function csvButton(label,onClick){ var b=el("button","field csvbtn","↓ "+label); b.type="button"; b.addEventListener("click",onClick); return b; }

  var COLS={
    sales:[
      {k:"full",l:"Account manager",t:"name"},
      {k:"spread",l:"Spread / wk",t:"spread",grp:"Results"},
      {k:"visits",l:"Client visits",t:"n",grp:"Activity"},
      {k:"jobOrders",l:"Job orders",t:"n",grp:"Activity"},
      {k:"sendOuts",l:"Send outs",t:"n",grp:"Pipeline"},
      {k:"interviews",l:"Interviews",t:"n",grp:"Pipeline"},
      {k:"deals",l:"Deals",t:"n",grp:"Pipeline"},
      {k:"starts",l:"Starts",t:"n",grp:"Pipeline"},
      {k:"soDeal",l:"Send out : deal",t:"ratio",a:"sendOuts",b:"deals",grp:"Ratios"},
      {k:"intDeal",l:"Interview : deal",t:"ratio",a:"interviews",b:"deals",grp:"Ratios"},
      {k:"cvDeal",l:"Visit : deal",t:"ratio",a:"visits",b:"deals",grp:"Ratios"},
      {k:"fill",l:"Fill %",t:"pct",a:"deals",b:"jobOrders",grp:"Ratios"}
    ],
    recruiting:[
      {k:"full",l:"Recruiter",t:"name"},
      {k:"spread",l:"Spread / wk",t:"spread",grp:"Results"},
      {k:"submittals",l:"Submittals",t:"n",grp:"Pipeline"},
      {k:"interviews",l:"Interviews",t:"n",grp:"Pipeline"},
      {k:"placements",l:"Placements",t:"n",grp:"Pipeline"},
      {k:"subDeal",l:"Submittal : deal",t:"ratio",a:"submittals",b:"placements",grp:"Ratios"},
      {k:"intDeal",l:"Interview : deal",t:"ratio",a:"interviews",b:"placements",grp:"Ratios"}
    ]
  };

  var CARD_COLS={
    sales:["visits","sendOuts","interviews","deals","soDeal","intDeal"],
    recruiting:["submittals","interviews","placements","subDeal","intDeal"]
  };

  function computed(row,c){
    if(c.t==="ratio") return ratio(row[c.a]||0,row[c.b]||0);
    if(c.t==="pct") return ratio(row[c.a]||0,row[c.b]||0);
    return row[c.k];
  }
  function totals(rows,cols){
    var t={full:"Team total",name:"_total"};
    cols.forEach(function(c){ if(c.t==="n"||c.t==="spread"){ var s=0,any=false; rows.forEach(function(r){ if(r[c.k]!=null){s+=r[c.k];any=true;} }); t[c.k]=any? s:null; } });
    return t;
  }
  function grade(c,v,team){
    if(v==null||team==null) return "";
    if(c.t==="ratio"){ if(v<=team) return "good"; if(v<=team*1.5) return "warn"; return "bad"; }
    if(c.t==="pct"){ if(v>=team) return "good"; if(v>=team*0.5) return "warn"; return "bad"; }
    return "";
  }
  // Highlight cards for the selected month or period. Ranks the whole team (not the search), follows the
  // former-staff toggle, skips the house and unassigned rows, and only ranks ratios with enough deals.
  // prev is the previous month when it's comparable (no gain card for periods or month to date).
  function highlights(m,side,rows,team,prev){
    var ppl=rows.filter(function(r){ return r.name!=="_other" && r.name!=="House" && (state.former || !r.former); });
    function best(score,ok){
      var top=null;
      ppl.forEach(function(r){ if(ok && !ok(r)) return; var v=score(r); if(v==null||isNaN(v)) return; if(!top||v>top.v) top={r:r,v:v}; });
      return top;
    }
    function share(v,t){ return t? Math.round(v/t*100)+"% of team" : null; }
    var cards=[], deal= side==="sales"? "deals" : "placements";
    if(m.spread){
      var t=best(function(r){ return r.spread; });
      if(t && t.v>0) cards.push({kind:"top", lab: mtd(m)? "Top spread so far" : "Top spread", r:t.r, val:money(t.v), note:share(t.v,team.spread)});
    }
    if(prev){
      var was={}; (prev[side]||[]).forEach(function(r){ was[r.name]=r.spread; });
      var g=best(function(r){ return r.spread==null||was[r.name]==null? null : r.spread-was[r.name]; });
      if(g && g.v>=1) cards.push({kind:"gain", lab:"Biggest gain vs "+prev.short, r:g.r, val:"+"+money(g.v), note:money(was[g.r.name])+" → "+money(g.r.spread)});
    }
    var rc=COLS[side].filter(function(c){ return c.k===(side==="sales"? "soDeal" : "subDeal"); })[0];
    var b=best(function(r){ var v=computed(r,rc); return v==null? null : -v; }, function(r){ return (r[rc.b]||0)>=MIN_SAMPLE.ratio && (r[rc.a]||0)>0; });
    if(b) cards.push({kind:"ratio", lab:"Best "+rc.l.toLowerCase(), r:b.r, val:rtxt(-b.v), note:b.r[rc.b]+" "+deal+" · team "+rtxt(computed(team,rc))});
    var ak= side==="sales"? "sendOuts" : "submittals";
    var a=best(function(r){ return r[ak]; });
    if(a && a.v>0) cards.push({kind:"act", lab:"Most "+(side==="sales"? "send outs" : "submittals"), r:a.r, val:n(a.v), note:share(a.v,team[ak])});
    return cards;
  }

  // Small stroke icons for the highlight cards: star (top spread), rising line (gain), target (best ratio), pulse (activity)
  var HL_ICONS={
    top:"M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
    gain:"M3.5 16.5l5.5-5.5 4 4 7.5-7.5M15 7.5h5.5V13",
    ratio:"M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 11.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6",
    act:"M3 12.5h4l2.5-6.5 5 13 2.5-6.5h4"
  };
  function hlIcon(kind){
    var NS="http://www.w3.org/2000/svg", svg=document.createElementNS(NS,"svg"), p=document.createElementNS(NS,"path");
    svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("class","hico"); svg.setAttribute("aria-hidden","true");
    p.setAttribute("d",HL_ICONS[kind]); svg.appendChild(p);
    return svg;
  }

  // Monthly spread targets from the admin panel: versions that apply from a payroll month onward.
  // Amounts are per 4-week month; with scale5 a 5-week month's target is weeks/4 times larger.
  function monthTarget(mm,side,name){
    var v=null; ((TARGETS && TARGETS.versions) || []).forEach(function(x){ if(x.from<=mm.key) v=x; });
    if(!v) return null;
    var amt= name? (v.people && v.people[side] || {})[name] : v.team;
    if(amt==null) return null;
    return v.scale5? amt/4 : amt/mm.weeks; // per week, to compare with weekly average spread
  }
  // target for the selected month, or for a period the months in it that have spread
  function targetFor(m,side,name){
    if(!m.range) return monthTarget(m,side,name);
    var sum=0, any=false;
    var w=0; m.spreadMonths.forEach(function(mm){ var t=monthTarget(mm,side,name); if(t!=null){ sum+=t*mm.spreadW; w+=mm.spreadW; any=true; } });
    return any? sum/w : null; // weekly target averaged over the period's weeks
  }
  // share of target, and for a month-to-date month the share on pace for by month end
  function targetShare(m,spread,t){
    if(!t || spread==null) return null;
    var share=spread/t, done=1; // both are weekly averages, so a month-to-date month compares directly
    return {share:share, pace:share/done, done:done};
  }
  function targetGrade(ts){ var x=ts.pace; return x>=1? "good" : x>=0.75? "warn" : "bad"; }

  // Smallest denominator worth coloring: deals/placements for the per-deal ratios, job orders for Fill %.
  var MIN_SAMPLE={ratio:2,pct:3};
  // Class and tooltip for one person's ratio cell: graded against the team, or why it isn't.
  function gradeCell(c,r,v,team,per){
    var den=r[c.b]||0, show= c.t==="pct"? pct : rtxt;
    var unit= c.t==="pct"? "job orders" : c.b==="placements"? "placements" : c.b==="interviews"? "interviews" : "deals";
    if(v==null) return {cls:"zero",title:"No "+unit+" "+per+", so there's no ratio"};
    if(den<MIN_SAMPLE[c.t]) return {cls:"few",title:"Too few "+unit+" to compare ("+den+" "+per+")"};
    var g=grade(c,v,team); if(!g) return {cls:"",title:""};
    var better= c.t==="ratio"? v<team : v>team, diff;
    if(v===team) diff="same as team";
    else if(!team) diff=(better?"better":"worse")+" than team";
    else diff=Math.max(1,Math.round(Math.abs(v-team)/team*100))+"% "+(better?"better":"worse");
    return {cls:g,title:show(v)+" vs team "+show(team)+" — "+diff};
  }

  function monthKeys(){ return Object.keys(MONTHS).sort(); }
  // Spread is shown as a weekly average: the month's spread divided by the payroll weeks it covers (the weeks
  // reported so far for a month-to-date report). 30k, 30k, 30k and 50k weeks average 35k. Totals stay in
  // gpTotal, revenueTotal and each row's spreadTotal.
  function weekly(v){
    if(!v.spread || v.spreadW) return;
    var w= v.spreadWeeks && v.spreadWeeks[0]<v.spreadWeeks[1]? v.spreadWeeks[0] : v.weeks;
    v.spreadW=w; v.gpTotal=v.gp; v.revenueTotal=v.revenue;
    if(v.gp!=null) v.gp=v.gp/w; if(v.revenue!=null) v.revenue=v.revenue/w;
    ["sales","recruiting"].forEach(function(s){ (v[s]||[]).forEach(function(r){ if(r.spread!=null){ r.spreadTotal=r.spread; r.spread=r.spread/w; } }); });
  }
  // spread from a mid-month report ("Week 2 of 5") rather than the month's final numbers
  function mtd(m){ return !!(m && m.spread && m.spreadWeeks && m.spreadWeeks[0]<m.spreadWeeks[1]); }
  function dayNum(s){ var p=s.split("-"); return Date.UTC(+p[0],+p[1]-1,+p[2])/864e5; }

  // Change vs the previous month for a KPI tile. Ratios are better when lower.
  function delta(kind,cur,prev,pm,cm){
    if(cur==null||prev==null) return null;
    var d=cur-prev, a=Math.abs(d), txt, show;
    if(kind==="money"){ txt=a<1000? money(a) : moneyK(a); show=money; }
    else if(kind==="count"){ txt=prev? Math.round(a/prev*100)+"%" : n(a); show=n; }
    else if(kind==="ratio"){ txt=a.toFixed(1); show=rtxt; }
    else { txt=Math.round(a*100)+" pts"; show=pct; }
    var title=pm+" "+show(prev)+" → "+cm+" "+show(cur);
    if(/^\$?0(\.0)?(%| pts)?$/.test(txt)) return {txt:"No change vs "+pm,cls:"",title:title};
    var better= kind==="ratio"? d<0 : d>0;
    return {txt:(d>0?"▲ ":"▼ ")+txt+" vs "+pm, cls:better?"up":"down", title:title};
  }
  function getMonth(k){ return MONTHS[k]||PERIODS[k]||null; }
  // a bar is highlighted when it's the selected month or part of the selected period
  function isOn(k){ var m=getMonth(state.month); return m&&m.range? m.months.indexOf(k)>=0 : k===state.month; }
  function span(ms){ return ms.length? ms[0].short+(ms.length>1? "–"+ms[ms.length-1].short : "") : ""; }

  // Periods sum each person's numbers across payroll months; computed() then derives ratios from the sums.
  // Spread only counts months whose spread has arrived.
  function buildPeriods(){
    PERIODS={};
    var keys=monthKeys(); if(!keys.length) return;
    var yr=keys[keys.length-1].slice(0,4), ytd=keys.filter(function(k){ return k.slice(0,4)===yr; });
    function add(key,label,ks){
      var ms=ks.map(function(k){ return MONTHS[k]; }), spm=ms.filter(function(m){ return m.spread; });
      var p={key:key,range:true,label:label,months:ks,spreadMonths:spm,start:ms[0].start,end:ms[ms.length-1].end,
        weeks:0,spread:spm.length>0,gp:null,revenue:null,deals:[],inProgress:!ms[ms.length-1].spread||mtd(ms[ms.length-1])};
      ms.forEach(function(m){ p.weeks+=m.weeks; p.deals=p.deals.concat(m.deals||[]); });
      var cm=ms.filter(function(m){ return m.clients; });
      if(cm.length){
        p.clients={}; p.clientMonths=cm.map(function(m){ return m.short; });
        cm.forEach(function(m){ Object.keys(m.clients).forEach(function(id){
          var c=m.clients[id], t=p.clients[id]||(p.clients[id]={name:c.name});
          ["jobOrders","visits","submittals","interviews","deals"].forEach(function(f){ t[f]=(t[f]||0)+(c[f]||0); });
        }); });
      }
      p.spreadW=0; spm.forEach(function(m){ p.spreadW+=m.spreadW; });
      if(spm.length){ p.gpTotal=0; p.revenueTotal=0; spm.forEach(function(m){ p.gpTotal+=m.gpTotal||0; p.revenueTotal+=m.revenueTotal||0; }); p.gp=p.gpTotal/p.spreadW; p.revenue=p.revenueTotal/p.spreadW; }
      ["sales","recruiting"].forEach(function(side){
        var by={}, order=[];
        ms.forEach(function(m){ (m[side]||[]).forEach(function(r){
          var t=by[r.name]; if(!t){ t=by[r.name]={spread:null}; order.push(r.name); }
          Object.keys(r).forEach(function(f){
            var v=r[f];
            if(f==="spread"){ if(m.spread&&r.spreadTotal!=null) t.spreadTotal=(t.spreadTotal||0)+r.spreadTotal; }
            else if(f==="spreadTotal"){}
            else if(v==null){ if(!(f in t)) t[f]=null; }
            else if(typeof v==="number") t[f]=(t[f]||0)+v;
            else t[f]=v; // name, full, former, ae: latest month wins
          });
        }); });
        p[side]=order.map(function(nm){ var t=by[nm]; t.spread= t.spreadTotal!=null&&p.spreadW? t.spreadTotal/p.spreadW : null; return t; });
      });
      p.option=label+" ("+span(ms)+")"+(!p.spread? " · spread pending" : spm.length<ms.length? " · spread through "+spm[spm.length-1].short : "");
      PERIODS[key]=p;
    }
    add("ytd","Year to date "+yr,ytd);
    [1,2,3,4].forEach(function(q){ var ks=ytd.filter(function(k){ return Math.ceil(+k.slice(5,7)/3)===q; }); if(ks.length) add("q"+q,"Q"+q+" "+yr,ks); });
    if(keys.length>3) add("last3","Last 3 months",keys.slice(-3));
  }

  function buildMonthSelect(){
    var sel=$("month"), keys=monthKeys(), cur=state.month;
    sel.textContent="";
    var pg=el("optgroup"); pg.label="Periods";
    Object.keys(PERIODS).forEach(function(k){ var o=el("option",null,PERIODS[k].option); o.value=k; pg.appendChild(o); });
    var mg=el("optgroup"); mg.label="Months";
    keys.slice().reverse().forEach(function(k){ var m=MONTHS[k]; var o=el("option",null,m.label+(m.spread?"":" · spread pending")); o.value=k; mg.appendChild(o); });
    sel.appendChild(mg); if(pg.children.length) sel.appendChild(pg);
    if(!cur||!getMonth(cur)){
      // default: latest month that has spread, else latest
      var withSp=keys.filter(function(k){return MONTHS[k].spread;});
      cur=withSp.length? withSp[withSp.length-1] : keys[keys.length-1];
    }
    state.month=cur; sel.value=cur;
  }

  function syncTabs(){
    SIDES.forEach(function(sd){ $("tab-"+sd).setAttribute("aria-selected",String(state.side===sd)); });
    var people=state.side==="sales"||state.side==="recruiting";
    $("month").hidden=!(people||state.side==="primes"); $("formerWrap").hidden=!people;
    document.querySelector(".mast").hidden= people||state.side==="primes"; // no banner on the monthly views
    $("q").placeholder= state.side==="recontact"||state.side==="spread"? "Find a name or client" : "Find a name";
  }
  function render(){
    syncTabs();
    if(state.side==="recontact"||state.side==="spread"){ var mo0= motionOK()? motion : ""; motion=""; finishCounts(); hideTip(); (state.side==="spread"? renderSpread : renderRecontact)(mo0); writeHash(); return; }
    var keys=monthKeys();
    if(!keys.length) return;
    var m=getMonth(state.month); if(!m) return;
    var mo= motionOK()? motion : ""; motion=""; finishCounts();
    if(state.side==="primes"){ hideTip(); renderPrimes(m,mo); writeHash(); return; }
    var side=state.side, cols=COLS[side], per=m.range? "this period" : "this month";
    $("mMonth").textContent=m.label;
    if(m.range){
      $("mRange").textContent=span(m.months.map(getMonth))+" · "+m.weeks+" payroll weeks"+(m.inProgress?" · in progress":"");
      $("mSrc").textContent=(m.spread? span(m.spreadMonths)+" spread" : "Spread pending")+(META? " · Bullhorn through "+dateLabel(META.bullhornAsOf) : "");
    } else {
      $("mRange").textContent=dateLabel(m.start)+" – "+dateLabel(m.end)+" · "+m.weeks+" payroll weeks"+(m.spread? (mtd(m)? " · spread through week "+m.spreadWeeks[0]+" of "+m.spreadWeeks[1] : "") : " · in progress");
      $("mSrc").textContent= META? ("Spread: "+META.spreadReport+" · Bullhorn as of "+dateLabel(META.bullhornAsOf)) : "Sources: Weekly Spread Dashboard · Bullhorn";
    }

    var all=(m[side]||[]).slice();
    var q=state.q.trim().toLowerCase();
    var visible=all.filter(function(r){
      if(r.name==="_other") return !q;
      if(r.former && !state.former) return false;
      if(q && r.full.toLowerCase().indexOf(q)<0) return false;
      return true;
    });
    // team totals always from every row for the month (not the filter)
    var team=totals(all,cols);
    var people=visible.filter(function(r){return r.name!=="_other";});
    var other=visible.filter(function(r){return r.name==="_other";});
    var sk=state.sort[side], sc=cols.filter(function(c){return c.k===sk[0];})[0]||cols[1];
    people.sort(function(a,b){
      var va=computed(a,sc), vb=computed(b,sc);
      if(sc.t==="name"){ return sk[1]==="asc"? String(va).localeCompare(vb) : String(vb).localeCompare(va); }
      if(va==null&&vb==null) return a.full.localeCompare(b.full);
      if(va==null) return 1; if(vb==null) return -1;
      return sk[1]==="asc"? va-vb : vb-va;
    });

    hideTip();
    var body=$("body"); body.textContent="";

    // previous month, compared only when both months have spread (periods aren't compared)
    var pk=m.range? null : keys[keys.indexOf(state.month)-1], prev=pk? MONTHS[pk] : null;
    var cmp=!!(prev && m.spread && prev.spread && !mtd(m) && !mtd(prev));
    var prevTeam= cmp? totals(prev[side]||[],cols) : null;
    function chg(kind,key){
      function val(t){ return typeof key==="string"? t[key] : ratio(t[key[0]],t[key[1]]); }
      return cmp? delta(kind,val(team),val(prevTeam),prev.short,m.short) : null;
    }

    // KPI strip
    var k=el("div","kpis");
    function tile(lab,val,note,c,extra){
      var t=el("div","kpi"), vd=el("div","val num",val); if(mo) countUp(vd,val); t.appendChild(el("div","lab",lab)); t.appendChild(vd); t.appendChild(el("div","note",note||" "));
      if(c){ var d=el("div","delta num"+(c.cls?" "+c.cls:""),c.txt); if(c.title) d.title=c.title; t.appendChild(d); }
      if(extra) t.appendChild(extra);
      k.appendChild(t);
    }
    var spNote= !m.spread? "Arrives with Shelley's next report" : "avg of "+m.spreadW+" week"+(m.spreadW===1?"":"s")+(mtd(m)? " so far (week "+m.spreadWeeks[0]+" of "+m.spreadWeeks[1]+")" : "")+" · "+moneyK(m.gpTotal)+" total";
    var spChg= cmp? delta("money",m.gp,prev.gp,prev.short,m.short) : null;
    // progress toward the team target, with a tick at where a month-to-date month should be by now
    var tgt=targetFor(m,side,null), prog=null;
    if(tgt){
      prog=el("div","tgt");
      var ts=targetShare(m,m.spread? m.gp : null,tgt);
      if(ts){
        var tb=el("div","tbar "+targetGrade(ts)), tf=el("span","tfill");
        tf.style.width=Math.min(100,ts.share*100)+"%"; tb.appendChild(tf);
        if(ts.done<1){ var tm=el("span","tmark"); tm.style.left=(ts.done*100)+"%"; tb.appendChild(tm); }
        var tt=Math.round(ts.share*100)+"% of "+moneyK(tgt)+" target"+(ts.done<1? " · week "+m.spreadWeeks[0]+" of "+m.spreadWeeks[1] : "");
        tb.setAttribute("aria-hidden","true"); // the note below says the same in words
        prog.appendChild(tb); prog.appendChild(el("div","tnote",tt));
      } else prog.appendChild(el("div","tnote","Target "+moneyK(tgt)));
    }
    var wk=REPORT&&REPORT.weekly;
    function runRateTile(){ tile("Run rate", wk? moneyMM(wk.runRate,1) : "—", wk? "w/e "+dateLabel(wk.weekEnding)+": "+moneyK(wk.revenue)+" × 52" : "From the weekly spread upload"); }
    if(side==="sales"){
      tile("Weekly spread", m.spread? money(m.gp):"Pending", spNote, spChg, prog);
      runRateTile();
      tile("Send outs", n(team.sendOuts), n(team.jobOrders)+" new job orders", chg("count","sendOuts"));
      tile("Interviews", n(team.interviews), "candidates interviewed", chg("count","interviews"));
      tile("Deals", n(team.deals), n(team.starts)+" starts "+per, chg("count","deals"));
      tile("Send out : deal", rtxt(ratio(team.sendOuts,team.deals)), "interview "+rtxt(ratio(team.interviews,team.deals))+" · visit "+rtxt(ratio(team.visits,team.deals)), chg("ratio",["sendOuts","deals"]));
      tile("Fill %", pct(ratio(team.deals,team.jobOrders)), "deals ÷ job orders", chg("pct",["deals","jobOrders"]));
    } else {
      tile("Weekly spread", m.spread? money(m.gp):"Pending", spNote, spChg, prog);
      runRateTile();
      tile("Submittals", n(team.submittals), "sent to clients", chg("count","submittals"));
      tile("Interviews", n(team.interviews), "candidates interviewed", chg("count","interviews"));
      tile("Placements", n(team.placements), "deals closed", chg("count","placements"));
      tile("Submittal : deal", rtxt(ratio(team.submittals,team.placements)), "interview : deal "+rtxt(ratio(team.interviews,team.placements)), chg("ratio",["submittals","placements"]));
    }
    k.firstChild.classList.add("primary"); // Spread is always the first tile
    k.style.setProperty("--n",k.children.length-1);
    body.appendChild(k);

    // highlights: a few people worth noticing first; each card opens that person's history
    var hl=highlights(m,side,all,team,cmp? prev : null);
    if(hl.length){
      var hs=el("section","hl"); hs.setAttribute("aria-label","Highlights");
      hl.forEach(function(x){
        var c=el("button","hlc k-"+x.kind); c.type="button";
        var hd=el("span","hhead"); hd.appendChild(hlIcon(x.kind)); hd.appendChild(el("span","lab",x.lab)); c.appendChild(hd);
        c.appendChild(el("span","who",x.r.full));
        c.appendChild(el("span","hv num",x.val)); if(x.note) c.appendChild(el("span","hn",x.note));
        c.setAttribute("aria-label",x.lab+": "+x.r.full+", "+x.val+(x.note? ", "+x.note : "")+". Open their history.");
        c.addEventListener("click",function(){ openPerson(x.r.name,side,c); });
        hs.appendChild(c);
      });
      body.appendChild(hs);
    }

    // month strip
    var ms=el("section","months");
    var h=el("div","sechead"); h.appendChild(el("h2",null,"Weekly spread by month")); var ch=el("span","hint","Company gross profit, average per payroll week"); ch.appendChild(el("span","noprint"," · select a month")); h.appendChild(ch);
    ms.appendChild(h); var cw=el("div","chartbox"); cw.appendChild(monthChart(keys,!!mo)); ms.appendChild(cw); body.appendChild(ms);

    // people table
    var sec=el("section","people");
    var sh=el("div","sechead");
    sh.appendChild(el("h2",null, side==="sales"?"Account managers":"Recruiters"));
    var shh=el("span","hint", "Sorted by "+sc.l.toLowerCase()+(sk[1]==="desc"?", high to low":", low to high")+" · "+people.length+" people");
    shh.appendChild(el("span","noprint"," · select a name for their history")); sh.appendChild(shh);
    var tgtOf={}, hasTgt=false;
    people.concat([team]).forEach(function(r){ var t=targetFor(m,side,r.name==="_total"? null : r.name); if(t){ tgtOf[r.name]=t; if(r.name!=="_total") hasTgt=true; } });
    var vcols=cols.filter(function(c){ return shown(side,c.k); });
    var showTgt=hasTgt && shown(side,"tcol");
    var tools=el("div","ptools");
    tools.appendChild(densityToggle());
    tools.appendChild(columnChooser(side,cols,hasTgt));
    // exports the table as shown: same columns, rows, order and team total; ratios as numbers, Fill % as a percent
    tools.appendChild(csvButton("Download CSV",function(){
      var rows=[[vcols[0].l,"Former"].concat(vcols.slice(1).map(function(c){ return c.l; }), showTgt? ["% of target"] : [], ["Spread, month total"])];
      var teamTot=0; all.forEach(function(r){ teamTot+=r.spreadTotal||0; });
      people.concat(other,[team]).forEach(function(r){
        var row=vcols.map(function(c){
          var v=computed(r,c);
          if(c.t==="name") return r.full;
          if(c.t==="spread") return m.spread? v : null;
          if(c.t==="pct") return v==null? null : v*100;
          return v;
        });
        row.splice(1,0,r.former?"Yes":"");
        if(showTgt){ var ts=targetShare(m, m.spread? (r.name==="_total"? team.spread : r.spread) : null, tgtOf[r.name]); row.push(ts? ts.share*100 : null); }
        row.push(m.spread? (r.name==="_total"? teamTot : r.spreadTotal) : null);
        rows.push(row);
      });
      downloadCSV("spread-scorecard_"+side+"_"+state.month+".csv",rows);
    }));
    sh.appendChild(tools);
    sec.appendChild(sh);
    var box=el("div","tablebox sticky people-table"+(compact?" compact":"")); var tbl=el("table","num");
    var thead=el("thead");
    var gr=el("tr"); var groups=[]; vcols.forEach(function(c){ var g=c.grp||""; if(groups.length&&groups[groups.length-1].g===g) groups[groups.length-1].n++; else groups.push({g:g,n:1}); });
    // Name and Results (Spread) are always the first two groups; % of target follows them
    if(showTgt) groups.splice(2,0,{g:"",n:1,cls:"tcol"});
    groups.forEach(function(g){ var th=el("th","grp"+(g.cls?" "+g.cls:""),g.g); th.colSpan=g.n; gr.appendChild(th); });
    thead.appendChild(gr);
    var hr=el("tr");
    vcols.forEach(function(c){
      var th=el("th"); var b=el("button",null,c.l); b.type="button";
      th.setAttribute("data-l",c.l); // print shows this instead of the button, which Chrome leaves blank in repeated headers
      if(sk[0]===c.k){ th.setAttribute("aria-sort",sk[1]==="asc"?"ascending":"descending"); b.appendChild(el("span","arr",sk[1]==="asc"?"▲":"▼")); th.setAttribute("data-l",c.l+(sk[1]==="asc"?" ▲":" ▼")); }
      b.addEventListener("click",function(){ var cur=state.sort[side]; if(cur[0]===c.k) cur[1]=cur[1]==="asc"?"desc":"asc"; else { cur[0]=c.k; cur[1]=(c.t==="name"||c.t==="ratio")?"asc":"desc"; } render(); });
      th.appendChild(b); hr.appendChild(th);
      if(c.t==="spread"){
        if(showTgt){ var tc=el("th","tcol","% of target"); tc.title="Spread compared with each person's monthly target"; hr.appendChild(tc); }
      }
    });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb=el("tbody");
    var maxSp=0; people.forEach(function(r){ if(r.spread>maxSp) maxSp=r.spread; });
    var teamVals={}; cols.forEach(function(c){ if(c.t==="ratio"||c.t==="pct") teamVals[c.k]=computed(team,c); });
    function targetCell(r){
      var td=el("td","tcol r"), ts=targetShare(m, m.spread? r.spread : null, tgtOf[r.name]);
      if(!tgtOf[r.name]){ td.textContent="—"; td.className+=" zero"; td.title="No target set"; return td; }
      if(!ts){ td.textContent="—"; td.className+=" zero"; td.title="Target "+money(tgtOf[r.name])+"; spread pending"; return td; }
      td.textContent=Math.round(ts.share*100)+"%";
      if(r.name!=="_total") td.className+=" "+targetGrade(ts);
      td.title=money(r.spread)+" of "+money(tgtOf[r.name])+" target";
      return td;
    }
    var prevSp={}; if(cmp){ (prev[side]||[]).forEach(function(r){ prevSp[r.name]=r.spread; }); prevSp._total=prevTeam.spread; }
    // ▲/▼ vs the person's previous-month spread; an empty span keeps the amounts aligned
    function spreadChg(r,v){
      var s=el("span","chg"), p=prevSp[r.name];
      if(p==null||Math.abs(v-p)<1) return s;
      var d=v-p; s.textContent=d>0?"▲":"▼"; s.className="chg "+(d>0?"up":"down");
      s.title=(d>0?"+":"−")+money(Math.abs(d))+" vs "+prev.short+" ("+money(p)+" → "+money(v)+")";
      s.setAttribute("role","img"); s.setAttribute("aria-label",s.title);
      return s;
    }
    function addRow(r,cls){
      var tr=el("tr",cls||null); if(r.former) tr.classList.add("former");
      vcols.forEach(function(c){
        var td=el("td"); var v=computed(r,c);
        if(c.t==="name"){
          var ini=el("span","ini"+(r.name==="_total"||r.name==="_other"? " blank" : ""),initials(r.full)); ini.setAttribute("aria-hidden","true"); td.appendChild(ini);
          if(r.name==="_total"||r.name==="_other") td.appendChild(document.createTextNode(r.full));
          else { var nb=el("button","pname",r.full); nb.type="button"; nb.addEventListener("click",function(){ openPerson(r.name,side,nb); }); td.appendChild(nb); }
          if(r.former) td.appendChild(el("span","tag","former"));
          else if(side==="recruiting" && r.ae) td.appendChild(el("span","tag","AM"));
        } else if(c.t==="spread"){
          if(!m.spread){ td.textContent=r.name==="_total"?"Pending":"—"; td.className="zero"; }
          else if(v==null){ td.textContent="—"; td.className="zero"; }
          else {
            td.className="sp";
            var w=el("div","spw");
            if(r.name!=="_total" && maxSp>0 && v>0){ var bar=el("span","spbar"); bar.style.width=Math.max(3,Math.round(56*v/maxSp))+"px"; w.appendChild(bar); }
            w.appendChild(el("span",null,money(v)));
            if(cmp) w.appendChild(spreadChg(r,v));
            td.appendChild(w);
          }
        } else if(c.t==="n"){
          td.textContent=n(v); if(!v) td.className="zero";
        } else {
          td.textContent= c.t==="pct"? pct(v) : rtxt(v);
          var gc= r.name==="_total"||r.name==="_other"? {cls:v==null?"zero":"",title:""} : gradeCell(c,r,v,teamVals[c.k],per);
          td.className="r"+(gc.cls?" "+gc.cls:"");
          if(gc.title) td.title=gc.title;
        }
        if(c.t==="spread"){
          if(showTgt){ tr.appendChild(td); td=targetCell(r); }
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }

    // card view controls (phone < 640px)
    var cardControls=el("div","card-controls");
    var slabel=el("label","cardsort");
    slabel.appendChild(el("span","csort-lbl","Sort by"));
    var ssel=el("select","field small csort-sel");
    ssel.setAttribute("aria-label","Sort by");
    cols.forEach(function(c){
      var opt=el("option",null,c.l);
      opt.value=c.k;
      ssel.appendChild(opt);
    });
    ssel.value=sk[0];
    ssel.addEventListener("change",function(){
      var cur=state.sort[side];
      var chosen=cols.filter(function(c){ return c.k===ssel.value; })[0];
      cur[0]=ssel.value;
      cur[1]=(chosen && (chosen.t==="name"||chosen.t==="ratio"))? "asc" : "desc";
      render();
    });
    slabel.appendChild(ssel);
    cardControls.appendChild(slabel);

    var sdir=el("button","field small csort-dir");
    sdir.type="button";
    var dirLbl= sc.t==="name"? (sk[1]==="asc"?"A–Z":"Z–A") : sc.t==="ratio"? (sk[1]==="asc"?"Best first":"Worst first") : (sk[1]==="asc"?"Low to high":"High to low");
    sdir.appendChild(el("span","csort-arr",sk[1]==="asc"?"▲ ":"▼ "));
    sdir.appendChild(el("span","csort-lbl-dir",dirLbl));
    sdir.setAttribute("aria-label","Toggle sort order (currently "+dirLbl+")");
    sdir.title="Toggle sort order";
    sdir.addEventListener("click",function(){
      var cur=state.sort[side];
      cur[1]=cur[1]==="asc"?"desc":"asc";
      render();
    });
    cardControls.appendChild(sdir);

    var cardsBox=el("div","pcards");
    function addCard(r,cls){
      var isPerson=(r.name!=="_total"&&r.name!=="_other");
      var card=el(isPerson?"button":"div","pcard"+(cls?" "+cls:""));
      if(isPerson){
        card.type="button";
        card.addEventListener("click",function(){ openPerson(r.name,side,card); });
      }

      var top=el("div","pcard-top");
      var who=el("div","pcard-who");
      who.appendChild(el("span","pcard-name",r.full));
      if(r.former) who.appendChild(el("span","tag","former"));
      else if(side==="recruiting" && r.ae) who.appendChild(el("span","tag","AM"));
      top.appendChild(who);

      var sp=el("div","pcard-spread");
      var spVal=el("span","pcard-amt num");
      if(!m.spread){
        spVal.textContent=r.name==="_total"?"Pending":"—";
        spVal.className+=" zero";
      } else if(r.spread==null){
        spVal.textContent="—";
        spVal.className+=" zero";
      } else {
        spVal.textContent=money(r.spread);
      }
      sp.appendChild(spVal);
      if(cmp && m.spread && r.spread!=null){
        var chg=spreadChg(r,r.spread);
        if(chg && chg.textContent) sp.appendChild(chg);
      }
      top.appendChild(sp);
      card.appendChild(top);

      var grid=el("div","pcard-grid");
      var cardKeys=CARD_COLS[side];
      cardKeys.forEach(function(ck){
        var c=cols.filter(function(col){ return col.k===ck; })[0];
        if(!c) return;
        var v=computed(r,c);
        var cell=el("div","pcard-cell");
        cell.appendChild(el("span","pcard-clab",c.l));
        var valSpan=el("span","pcard-cval num");
        if(c.t==="n"){
          valSpan.textContent=n(v);
          if(!v) cell.className+=" zero";
        } else {
          valSpan.textContent=c.t==="pct"? pct(v) : rtxt(v);
          var gc=(r.name==="_total"||r.name==="_other")? {cls:v==null?"zero":"",title:""} : gradeCell(c,r,v,teamVals[c.k],per);
          cell.className+=" r"+(gc.cls?" "+gc.cls:"");
          if(gc.title) cell.title=gc.title;
        }
        cell.appendChild(valSpan);
        grid.appendChild(cell);
      });
      card.appendChild(grid);
      cardsBox.appendChild(card);
    }

    people.forEach(function(r){addRow(r);addCard(r);});
    other.forEach(function(r){addRow(r,"other");addCard(r,"other");});
    if(!people.length && !other.length && q){
      cardsBox.appendChild(el("div","empty pcard-empty","No people match “"+q+"”."));
    }
    addRow(team,"total");
    addCard(team,"total");
    tbl.appendChild(tb); box.appendChild(tbl);
    sec.appendChild(cardControls);
    sec.appendChild(cardsBox);
    sec.appendChild(box);
    box.addEventListener("scroll",function(){ box.classList.toggle("scrolled",box.scrollLeft>0); },{passive:true});
    var lg=el("div","legend");
    lg.appendChild(el("span",null, side==="sales"? "Ratios vs team (per deal, lower is better; Fill %, higher):" : "Ratios vs team (per deal, lower is better):"));
    [["good","At or better than team"],["warn","Up to 50% worse"],["bad","More than 50% worse"]].forEach(function(p){ var s=el("span"); s.appendChild(el("span","sw "+p[0])); s.appendChild(document.createTextNode(p[1])); lg.appendChild(s); });
    var few=el("span"); few.appendChild(el("span","sw few")); few.appendChild(document.createTextNode(side==="sales"? "Too few to compare: under "+MIN_SAMPLE.ratio+" deals ("+MIN_SAMPLE.pct+" job orders for Fill %)" : "Too few to compare: under "+MIN_SAMPLE.ratio+" placements")); lg.appendChild(few);
    sec.appendChild(lg);
    body.appendChild(sec);

    // deals list
    var deals=(m.deals||[]).filter(function(d){ if(!q) return true; return [d.candidate,d.client,nameOf(d.ae),nameOf(d.recruiter)].join(" ").toLowerCase().indexOf(q)>=0; });
    var det=el("details","deals"); if(openDeals) det.open=true;
    det.addEventListener("toggle",function(){ openDeals=det.open; });
    var sum=el("summary",null,m.range?"Deals in this period":"Deals this month"); sum.appendChild(el("span","hint",deals.length+" placements created in Bullhorn")); det.appendChild(sum);
    if(deals.length){
      var tools=el("div","dtools");
      tools.appendChild(csvButton("Download CSV",function(){
        var rows=[["Added","Candidate","Client","Job","Account manager","Recruiter","Start","Status"]];
        deals.forEach(function(d){ rows.push([d.added,d.candidate,d.client,d.title&&d.title.trim(),nameOf(d.ae),nameOf(d.recruiter),d.start,d.status]); });
        downloadCSV("spread-scorecard_deals_"+state.month+".csv",rows);
      }));
      det.appendChild(tools);
    }
    var inner=el("div","inner tablebox"); var dt=el("table","num");
    var dh=el("thead"); var dhr=el("tr"); ["Added","Candidate","Client","Job","Account manager","Recruiter","Start","Status"].forEach(function(x){ dhr.appendChild(el("th",null,x)); }); dh.appendChild(dhr); dt.appendChild(dh);
    var db=el("tbody");
    deals.forEach(function(d){
      var tr=el("tr");
      [dateLabel(d.added),d.candidate,d.client||"—",d.title||"—",nameOf(d.ae),nameOf(d.recruiter),d.start?dateLabel(d.start):"—"].forEach(function(x){ tr.appendChild(el("td",null,x)); });
      var st=el("td"); var cls= d.status==="Never Started"?"no": (d.status==="Approved"||d.status==="Completed")?"ok":"mid"; st.appendChild(el("span","pill "+cls,d.status)); tr.appendChild(st);
      db.appendChild(tr);
    });
    if(!deals.length){ var tr=el("tr"); var td=el("td",null,"No placements created "+per+"."); td.colSpan=8; tr.appendChild(td); db.appendChild(tr); }
    dt.appendChild(db); inner.appendChild(dt); det.appendChild(inner); body.appendChild(det);

    // definitions
    var def=el("details"); if(openDefs) def.open=true; def.addEventListener("toggle",function(){ openDefs=def.open; });
    def.appendChild(el("summary",null,"How each number is counted"));
    var dl=el("dl","defs inner");
    DEFS.forEach(function(p){ dl.appendChild(el("dt",null,p[0])); dl.appendChild(el("dd",null,p[1])); });
    def.appendChild(dl); body.appendChild(def);
    body.classList.toggle("enter",mo==="load");
    if(mo==="load") [].forEach.call(body.children,function(c,i){ c.style.setProperty("--i",i); });
    writeHash();
  }
  var openDeals=false, openDefs=false;

  // ---- shared table for the Primes, Recontacting and Spread views ----
  // cols: {k, l, t: "text"|"money"|"money2"|"n"|"pct"|"hrs", get(row), cell(row) -> node, title(row)}. Click a header to sort.
  var SORTS={};
  function fmtCell(t,v){
    if(v==null||(typeof v==="number"&&isNaN(v))) return "—";
    if(t==="money") return money(v);
    if(t==="money2") return "$"+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    if(t==="n") return n(Math.round(v*10)/10);
    if(t==="pct") return pct1(v);
    if(t==="hrs") return n(Math.round(v*10)/10);
    return String(v);
  }
  function val(c,r){ return c.get? c.get(r) : r[c.k]; }
  function dataTable(id,cols,rows,opt){
    opt=opt||{};
    var so=SORTS[id]||(SORTS[id]=opt.sort||[cols[0].k,"asc"]), sc=cols.filter(function(c){ return c.k===so[0]; })[0]||cols[0];
    var sorted=rows.slice().sort(function(a,b){
      var va=sc.sortVal? sc.sortVal(a) : val(sc,a), vb=sc.sortVal? sc.sortVal(b) : val(sc,b);
      if(va==null&&vb==null) return 0; if(va==null) return 1; if(vb==null) return -1;
      var d= typeof va==="number"&&typeof vb==="number"? va-vb : String(va).localeCompare(String(vb));
      return so[1]==="asc"? d : -d;
    });
    var box=el("div","tablebox"+(opt.sticky?" sticky":"")), tbl=el("table","num xtable"+(opt.cls?" "+opt.cls:"")), th=el("thead"), hr=el("tr");
    if(opt.minWidth!=null) tbl.style.minWidth=opt.minWidth+"px";
    cols.forEach(function(c){
      var h=el("th",c.t&&c.t!=="text"?"rt":null), b=el(opt.nosort? "span" : "button",opt.nosort? "thl" : null,c.l); if(!opt.nosort) b.type="button";
      if(so[0]===c.k){ h.setAttribute("aria-sort",so[1]==="asc"?"ascending":"descending"); b.appendChild(el("span","arr",so[1]==="asc"?"▲":"▼")); }
      if(!opt.nosort) b.addEventListener("click",function(){ if(so[0]===c.k) so[1]=so[1]==="asc"?"desc":"asc"; else { so[0]=c.k; so[1]=c.t&&c.t!=="text"?"desc":"asc"; } SORTS[id]=so; render(); var nb=document.querySelector('[data-tid="'+id+'"] th button'); if(nb) nb.focus(); });
      if(c.title) h.title=c.title;
      h.appendChild(b); hr.appendChild(h);
    });
    th.appendChild(hr); tbl.appendChild(th);
    var tb=el("tbody");
    function row(r,cls){
      var tr=el("tr",cls||null);
      cols.forEach(function(c){
        var td=el("td",c.t&&c.t!=="text"?"rt":null);
        if(c.cell && !cls){ var x=c.cell(r); if(x!=null) td.appendChild(typeof x==="string"? document.createTextNode(x) : x); }
        else {
          // a total row shows its own sums, and ratios (pct) worked out from them
          var v= cls==="total"? (c.k in r? r[c.k] : c.t==="pct"&&c.get? c.get(r) : null) : val(c,r);
          if(cls==="total" && v==null){ tr.appendChild(td); return; }
          td.textContent= c.t&&c.t!=="text"? fmtCell(c.t,v) : (v==null||v===""? "—" : String(v)); if(v==null||v===0||v==="") td.classList.add("zero"); }
        if(c.tip && !cls){ var tt=c.tip(r); if(tt) td.title=tt; }
        if(c.tdClass && !cls){ var tc=c.tdClass(r); if(tc) td.className+=" "+tc; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    sorted.forEach(function(r){ row(r); });
    if(!sorted.length){ var tr=el("tr"), td=el("td","zero",opt.empty||"Nothing to show."); td.colSpan=cols.length; tr.appendChild(td); tb.appendChild(tr); }
    if(opt.total && sorted.length) row(opt.total,"total");
    tbl.appendChild(tb); box.appendChild(tbl); box.setAttribute("data-tid",id);
    return box;
  }
  function sumBy(rows,f){ var s=0; rows.forEach(function(r){ s+=r[f]||0; }); return s; }
  function csvOf(file,cols,rows){
    return csvButton("Download CSV",function(){
      var out=[cols.map(function(c){ return c.l; })];
      rows.forEach(function(r){ out.push(cols.map(function(c){ var v= c.csv? c.csv(r) : val(c,r); return c.t==="pct"&&v!=null? Math.round(v*1000)/10 : v; })); });
      downloadCSV(file,out);
    });
  }
  function section(cls,title,hint,tools){
    var sec=el("section","xsec"+(cls?" "+cls:"")), h=el("div","sechead");
    h.appendChild(el("h2",null,title)); if(hint) h.appendChild(el("span","hint",hint));
    if(tools){ var t=el("div","ptools"); [].concat(tools).forEach(function(x){ t.appendChild(x); }); h.appendChild(t); }
    sec.appendChild(h); return sec;
  }
  function emptyNote(title,text){ var e=el("div","empty"); e.appendChild(el("strong",null,title)); e.appendChild(document.createTextNode(text)); return e; }
  function longDate(s){ var p=s.split("-"); return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
  function q2(){ return state.q.trim().toLowerCase(); }
  function hit(texts){ var q=q2(); return !q || texts.join(" ").toLowerCase().indexOf(q)>=0; }

  // ---- Primes tab: federal clients we have someone billing at, their Bullhorn activity for the selected month or
  // period, and the ratios between them, graded against the federal total. Each client opens its own history.
  var ACT=["jobOrders","visits","submittals","interviews","deals"];
  var PRATIOS=[
    {k:"subInt",l:"Submittal : interview",t:"ratio",a:"submittals",b:"interviews"},
    {k:"intDeal",l:"Interview : deal",t:"ratio",a:"interviews",b:"deals"},
    {k:"subDeal",l:"Submittal : deal",t:"ratio",a:"submittals",b:"deals"},
    {k:"visDeal",l:"Visit : deal",t:"ratio",a:"visits",b:"deals"},
    {k:"fill",l:"Fill %",t:"pct",a:"deals",b:"jobOrders"}
  ];
  function clientActivity(g,cl){ var r={}; ACT.forEach(function(f){ var t=0; g.corps.forEach(function(c){ var x=cl&&cl[c.id]; if(x) t+=x[f]||0; }); r[f]= cl? t : null; }); return r; }
  function ratioOf(c,r){ return ratio(r[c.a]||0,r[c.b]||0); }
  function ratioCols(team){
    return PRATIOS.map(function(c){
      return {k:c.k,l:c.l,t:"n",get:function(r){ return r[c.a]==null? null : ratioOf(c,r); },
        cell:function(r){ var v=ratioOf(c,r); return r[c.a]==null? "—" : c.t==="pct"? pct(v) : rtxt(v); },
        sortVal:function(r){ var v=ratioOf(c,r); return v==null? null : (c.t==="ratio"? -v : v); }, // best first when sorted high to low
        tdClass:function(r){ if(r[c.a]==null||!team) return ""; var g=gradeCell(c,r,ratioOf(c,r),ratioOf(c,team),"here"); return "r"+(g.cls?" "+g.cls:""); },
        tip:function(r){ if(r[c.a]==null||!team) return ""; return gradeCell(c,r,ratioOf(c,r),ratioOf(c,team),"here").title; },
        csv:function(r){ var v=ratioOf(c,r); return v==null? null : c.t==="pct"? Math.round(v*1000)/10 : Math.round(v*10)/10; }};
    });
  }
  function renderPrimes(m,mo){
    var body=$("body"); body.textContent="";
    var groups=(PRIMES&&PRIMES.groups)||[];
    if(!groups.length){ body.appendChild(emptyNote("No federal clients yet", REPORT? "They appear after the next Bullhorn sync (admin panel → Bullhorn activity → Sync now)." : "Upload the Weekly Spread Dashboard in the admin panel. Its Detail sheet lists the federal clients we have people billing at.")); return; }
    var cl=m.clients||null;
    var rows=groups.map(function(g){ return Object.assign({name:g.name,group:g,hc:g.hc,weeklyGp:g.weeklyGp,weeklyRevenue:g.weeklyRevenue,hours:g.hours},clientActivity(g,cl)); });
    var fed={name:"Federal total",hc:sumBy(rows,"hc"),weeklyGp:sumBy(rows,"weeklyGp"),weeklyRevenue:sumBy(rows,"weeklyRevenue"),hours:sumBy(rows,"hours")};
    ACT.forEach(function(f){ fed[f]= cl? sumBy(rows,f) : null; });
    var co=null; // every client in Bullhorn, federal or not, for comparison
    if(cl){ co={name:"All clients"}; ACT.forEach(function(f){ co[f]=0; Object.keys(cl).forEach(function(id){ co[f]+=cl[id][f]||0; }); }); }

    var k=el("div","kpis"); function tile(lab,v,note){ var t=el("div","kpi"), vd=el("div","val num",v); if(mo) countUp(vd,v); t.appendChild(el("div","lab",lab)); t.appendChild(vd); t.appendChild(el("div","note",note||" ")); k.appendChild(t); }
    var coGp=REPORT&&REPORT.weekly? REPORT.weekly.gp : null;
    tile("Federal weekly GP", money(fed.weeklyGp), (coGp? Math.round(fed.weeklyGp/coGp*100)+"% of company · " : "")+"w/e "+dateLabel(PRIMES.weekEnding));
    tile("Billing", n(fed.hc), groups.length+" federal clients");
    tile("Submittals", cl? n(fed.submittals) : "—", m.label);
    tile("Interviews", cl? n(fed.interviews) : "—", m.label);
    tile("Deals", cl? n(fed.deals) : "—", cl? n(fed.jobOrders)+" job orders" : "");
    tile("Interview : deal", cl? rtxt(ratio(fed.interviews,fed.deals)) : "—", co? "all clients "+rtxt(ratio(co.interviews,co.deals)) : "");
    tile("Submittal : deal", cl? rtxt(ratio(fed.submittals,fed.deals)) : "—", co? "all clients "+rtxt(ratio(co.submittals,co.deals)) : "");
    k.firstChild.classList.add("primary"); k.style.setProperty("--n",k.children.length-1);
    body.appendChild(k);

    var shown=rows.filter(function(r){ return hit([r.name].concat(r.group.corps.map(function(c){ return c.name; }))); });
    var cols=[
      {k:"name",l:"Client",cell:function(r){ var f=document.createDocumentFragment(), b=el("button","pname",r.name); b.type="button"; b.addEventListener("click",function(){ openClient(r.group,b); }); f.appendChild(b); if(r.group.sharedWithCommercial) f.appendChild(el("span","tag","+ commercial")); return f; },
        tip:function(r){ return "Bullhorn: "+(r.group.corps.map(function(c){ return c.name; }).join(", ")||"no matching company")+(r.group.sharedWithCommercial? ". This company also has commercial placements; its Bullhorn activity covers both." : ""); }},
      {k:"hc",l:"Billing",t:"n"},
      {k:"weeklyGp",l:"Weekly GP",t:"money",title:"Gross profit for the week ending "+dateLabel(PRIMES.weekEnding)},
      {k:"gpHour",l:"GP / hr",t:"money2",get:function(r){ return r.hours? r.weeklyGp/r.hours : null; }},
      {k:"jobOrders",l:"Job orders",t:"n"},{k:"visits",l:"Client visits",t:"n"},{k:"submittals",l:"Submittals",t:"n"},
      {k:"interviews",l:"Interviews",t:"n"},{k:"deals",l:"Deals",t:"n"}
    ].concat(ratioCols(cl? fed : null));
    var hint=(m.range? m.label+" ("+span(m.months.map(getMonth))+")" : m.label)+" Bullhorn activity"+(m.range&&m.clientMonths&&m.clientMonths.length<m.months.length? " (months with client data: "+m.clientMonths.join(", ")+")" : "")+" · billing and GP from the week ending "+dateLabel(PRIMES.weekEnding)+" · select a client for its history";
    var sec=section("primes","Federal clients",hint,[csvOf("primes_"+state.month+".csv",cols.map(function(c){ return c.k==="name"? {k:"name",l:"Client"} : c; }),shown)]);
    var box=dataTable("primes",cols,shown,{sort:["weeklyGp","desc"],total:fed,sticky:true,minWidth:1300});
    if(co){ var tb=box.querySelector("tbody"), tr=el("tr","other"); cols.forEach(function(c){ var td=el("td",c.t&&c.t!=="text"?"rt":null); td.textContent= c.k==="name"? "All clients (federal and commercial)" : ACT.indexOf(c.k)>=0? n(co[c.k]) : PRATIOS.some(function(x){ return x.k===c.k; })? (function(x){ var v=ratioOf(x,co); return x.t==="pct"? pct(v) : rtxt(v); })(PRATIOS.filter(function(x){ return x.k===c.k; })[0]) : ""; tr.appendChild(td); }); tb.appendChild(tr); }
    sec.appendChild(box);
    if(!cl) sec.appendChild(el("p","pnote",m.label+" has no Bullhorn activity by client yet. Pick another month."));
    var lg=el("div","legend"); lg.appendChild(el("span",null,"Ratios vs the federal total (per deal or per interview, lower is better; Fill %, higher):"));
    [["good","At or better"],["warn","Up to 50% worse"],["bad","More than 50% worse"],["few","Too few to compare"]].forEach(function(p){ var s0=el("span"); s0.appendChild(el("span","sw "+p[0])); s0.appendChild(document.createTextNode(p[1])); lg.appendChild(s0); });
    sec.appendChild(lg);
    sec.appendChild(el("p","pnote","Clients are the report's Federal rows with someone billing, tied to Bullhorn companies through each consultant's Placement ID. Report clients under the same Bullhorn company (BAE Space and BAE - GEO; the two AT&T lines) share one row. Job orders, visits, submittals, interviews and deals are everything Bullhorn has at those companies for the period; + commercial marks a company that also has commercial work, so its counts include that."));
    body.appendChild(sec);
    body.classList.toggle("enter",mo==="load");
  }

  // a federal client's month-by-month activity, who's billing there, its deals, and upcoming starts and ends
  function openClient(g,from){
    if(!dlg){
      dlg=el("dialog","drawer"); dlg.setAttribute("aria-labelledby","pTitle");
      dlg.addEventListener("click",function(e){ if(e.target===dlg) dlg.close(); });
      dlg.addEventListener("close",function(){ if(opener&&opener.isConnected) opener.focus(); });
      document.body.appendChild(dlg);
    }
    dlg.textContent=""; dlg.classList.add("wide");
    var pin=el("div","pin"), hd=el("header","phead"), ht=el("div");
    ht.appendChild(el("div","eyebrow","Federal client")); var h2=el("h2",null,g.name); h2.id="pTitle"; ht.appendChild(h2);
    ht.appendChild(el("div","psub","Bullhorn: "+(g.corps.map(function(c){ return c.name; }).join(", ")||"no matching company")));
    hd.appendChild(ht);
    var x=el("button","pclose","×"); x.type="button"; x.setAttribute("aria-label","Close"); x.addEventListener("click",function(){ dlg.close(); }); hd.appendChild(x);
    pin.appendChild(hd);
    var people=(REPORT&&REPORT.detail||[]).filter(function(d){ return g.clients.indexOf(d.client)>=0 && /^federal$/i.test(d.lob||""); });
    var hrs=sumBy(people,"hours");
    var st=el("div","pstats"); function stat(lab,v,note){ var t=el("div","pstat"); t.appendChild(el("div","lab",lab)); t.appendChild(el("div","val num",v)); t.appendChild(el("div","note",note)); st.appendChild(t); }
    stat("Weekly GP",money(g.weeklyGp),"w/e "+dateLabel(PRIMES.weekEnding)+(g.mtdGp!=null? " · "+moneyK(g.mtdGp)+" month to date" : ""));
    stat("Billing",n(g.hc),people.length+" consultant"+(people.length===1?"":"s"));
    stat("GP / hour",hrs? "$"+(g.weeklyGp/hrs).toFixed(2) : "—",n(Math.round(hrs))+" hours that week");
    pin.appendChild(st);

    var hist=monthKeys().filter(function(k){ return MONTHS[k].clients; }).reverse().map(function(k){ return Object.assign({month:MONTHS[k].label,key:k},clientActivity(g,MONTHS[k].clients)); });
    var hs=el("section","psec"); hs.appendChild(el("h3",null,"Month by month"));
    if(hist.length){
      var tot={month:"All"}; ACT.forEach(function(f){ tot[f]=sumBy(hist,f); });
      hs.appendChild(dataTable("cl-hist",[{k:"month",l:"Month"},{k:"jobOrders",l:"Job orders",t:"n"},{k:"visits",l:"Visits",t:"n"},{k:"submittals",l:"Submittals",t:"n"},{k:"interviews",l:"Interviews",t:"n"},{k:"deals",l:"Deals",t:"n"}].concat(ratioCols(null).map(function(c){ c.tdClass=null; c.tip=null; return c; })),hist,{nosort:true,total:tot,minWidth:0}));
    } else hs.appendChild(el("p","pnote","No months with client activity yet."));
    pin.appendChild(hs);

    var ps=el("section","psec"); ps.appendChild(el("h3",null,"Billing the week ending "+dateLabel(PRIMES.weekEnding)));
    ps.appendChild(dataTable("cl-people",[{k:"name",l:"Consultant",get:function(d){ return (d.first+" "+d.last).trim(); }},{k:"ae",l:"A/E",get:function(d){ return nameOf(d.ae); }},{k:"recruiter",l:"Recruiter",get:function(d){ return nameOf(d.recruiter); }},{k:"bill",l:"Bill",t:"money2"},{k:"pay",l:"Pay",t:"money2"},{k:"hours",l:"Hours",t:"hrs"},{k:"gp",l:"GP",t:"money"}],
      people.slice().sort(function(a,b){ return b.gp-a.gp; }),{nosort:true,minWidth:0}));
    pin.appendChild(ps);

    var names=g.corps.map(function(c){ return c.name.toLowerCase(); }), deals=[];
    monthKeys().forEach(function(k){ (MONTHS[k].deals||[]).forEach(function(d){ if(d.client && names.indexOf(d.client.trim().toLowerCase())>=0) deals.push(d); }); });
    deals.sort(function(a,b){ return a.added<b.added? 1 : -1; });
    var ds=el("section","psec"); var dh=el("h3",null,"Deals"); dh.appendChild(el("span","hint",deals.length+" placement"+(deals.length===1?"":"s")+" in the scorecard's months")); ds.appendChild(dh);
    ds.appendChild(dataTable("cl-deals",[{k:"added",l:"Added",cell:function(d){ return longDate(d.added); }},{k:"candidate",l:"Candidate"},{k:"title",l:"Job"},{k:"ae",l:"A/E",get:function(d){ return nameOf(d.ae); }},{k:"recruiter",l:"Recruiter",get:function(d){ return nameOf(d.recruiter); }},{k:"start",l:"Start",cell:function(d){ return d.start? longDate(d.start) : "—"; }},{k:"status",l:"Status"}],deals,{nosort:true,minWidth:0,empty:"No placements at this client in these months."}));
    pin.appendChild(ds);

    if(FORECAST){
      var cn=g.clients.concat(g.corps.map(function(c){ return c.name; })).map(function(s0){ return s0.toLowerCase(); });
      var up=FORECAST.starts.filter(function(s0){ return cn.indexOf((s0.client||"").toLowerCase())>=0; }), en=FORECAST.ends.filter(function(e){ return g.clients.indexOf(e.client)>=0; });
      var fs=el("section","psec"); fs.appendChild(el("h3",null,"Coming up"));
      fs.appendChild(el("p","pnote",up.length+" start"+(up.length===1?"":"s")+" and "+en.length+" end"+(en.length===1?"":"s")+" in Bullhorn over the next 26 weeks."));
      if(up.length) fs.appendChild(dataTable("cl-starts",[{k:"name",l:"Starting"},{k:"begin",l:"Start",cell:function(s0){ return longDate(s0.begin); }},{k:"title",l:"Job"},{k:"weeklyGp",l:"Est. weekly GP",t:"money"}],up,{nosort:true,minWidth:0}));
      if(en.length) fs.appendChild(dataTable("cl-ends",[{k:"name",l:"Ending"},{k:"end",l:"End date",cell:function(e){ return longDate(e.end); }},{k:"weeklyGp",l:"Weekly GP",t:"money"}],en,{nosort:true,minWidth:0}));
      pin.appendChild(fs);
    }
    dlg.appendChild(pin);
    opener=from||null; dlg.showModal(); dlg.scrollTop=0;
  }

  // ---- Recontacting: everyone billing on the latest spread report, and when we last reached out to them ----
  var rcFilter="all";
  function daysBetween(a,b){ return a&&b? Math.round(dayNum(b)-dayNum(a)) : null; }
  function agePill(d){ var s=el("span","pill "+(d==null?"no":d<=30?"ok":d<=60?"mid":"no"), d==null? "Never" : d===0? "Today" : d+" day"+(d===1?"":"s")); return s; }
  function renderRecontact(mo){
    $("mMonth").textContent="Recontacting";
    var body=$("body"); body.textContent="";
    if(!REPORT){ $("mRange").textContent="Active consultants"; $("mSrc").textContent="Sources: Weekly Spread Dashboard · Bullhorn"; body.appendChild(emptyNote("No spread report yet","Upload the Weekly Spread Dashboard in the admin panel. Its Detail sheet lists everyone billing, and the Bullhorn sync looks up each person's last contact.")); return; }
    $("mRange").textContent="Everyone billing on the report for the week ending "+longDate(REPORT.weekEnding);
    if(!RECONTACT||RECONTACT.weekEnding!==REPORT.weekEnding){
      $("mSrc").textContent="Spread: "+(META&&META.spreadReport||"Weekly Spread Dashboard");
      body.appendChild(emptyNote("Waiting for the Bullhorn sync","The latest report's consultants haven't been checked in Bullhorn yet. In the admin panel, open Bullhorn activity and choose Sync now; it takes under a minute."));
      return;
    }
    var asOf=RECONTACT.asOf;
    $("mSrc").textContent="Notes from Bullhorn as of "+longDate(asOf);
    var all=RECONTACT.rows.map(function(r){ return Object.assign({},r,{aDays:r.attempt? daysBetween(r.attempt.date,asOf) : null, sDays:r.substance? daysBetween(r.substance.date,asOf) : null}); });
    var due=function(r){ return r.sDays==null||r.sDays>30; };
    var rows=all.filter(function(r){
      if(rcFilter==="federal" && !/^federal$/i.test(r.lob||"")) return false;
      if(rcFilter==="commercial" && /^federal$/i.test(r.lob||"")) return false;
      if(rcFilter==="due" && !due(r)) return false;
      return hit([r.name,r.client,nameOf(r.ae),nameOf(r.recruiter),r.ae,r.recruiter]);
    });
    var k=el("div","kpis"); function tile(lab,v,note){ var t=el("div","kpi"), vd=el("div","val num",v); if(mo) countUp(vd,v); t.appendChild(el("div","lab",lab)); t.appendChild(vd); t.appendChild(el("div","note",note||" ")); k.appendChild(t); }
    var b30=all.filter(function(r){ return r.sDays!=null&&r.sDays<=30; }).length, b60=all.filter(function(r){ return r.sDays!=null&&r.sDays>30&&r.sDays<=60; }).length, old=all.filter(function(r){ return r.sDays==null||r.sDays>60; }).length;
    tile("Active consultants",n(all.length),sumBy(REPORT.detail,"hc")+" headcount billing");
    tile("Talked to in 30 days",n(b30),"note of substance");
    tile("31–60 days",n(b60),"due for a recontact");
    tile("Over 60 days",n(old),"or no note of substance");
    var miss=all.filter(function(r){ return !r.inBullhorn; }).length;
    tile("Not in Bullhorn",n(miss),miss? "Placement ID not found" : "every Placement ID matched");
    k.firstChild.classList.add("primary"); k.style.setProperty("--n",k.children.length-1);
    body.appendChild(k);

    var seg=el("div","tabs density rcfilter"); seg.setAttribute("role","group"); seg.setAttribute("aria-label","Show");
    [["all","All"],["due","Due (30+ days)"],["federal","Federal"],["commercial","Commercial"]].forEach(function(f){
      var b=el("button",null,f[1]); b.type="button"; b.setAttribute("aria-pressed",String(rcFilter===f[0]));
      b.addEventListener("click",function(){ rcFilter=f[0]; render(); var nb=document.querySelector('.rcfilter button[aria-pressed="true"]'); if(nb) nb.focus(); });
      seg.appendChild(b);
    });
    // one line per contact: date · type · who; a note of substance shows its first line and opens to the full note
    function contactCell(c,withText){
      var d=el("div","rc"+(withText?" long":""));
      if(!c){ d.appendChild(el("span","zero","None found")); return d; }
      var p=c.date.split("-"), short=(+p[1])+"/"+(+p[2])+"/"+p[0].slice(2);
      var meta=el("span","rcm"); meta.appendChild(el("b",null,short));
      meta.appendChild(document.createTextNode(" · "+(withText? (c.by||c.action||"") : (c.action||""))));
      d.title=[longDate(c.date),c.action,c.by].filter(Boolean).join(" · ");
      if(!withText||!c.text){ d.appendChild(meta); return d; }
      var b=el("button","rcnote"); b.type="button"; b.setAttribute("aria-expanded","false");
      b.appendChild(meta); b.appendChild(el("span","rct",c.text));
      b.addEventListener("click",function(){ b.setAttribute("aria-expanded",String(b.getAttribute("aria-expanded")!=="true")); });
      d.appendChild(b); return d;
    }
    var cols=[
      {k:"name",l:"Consultant",cell:function(r){ var f=document.createDocumentFragment(); f.appendChild(document.createTextNode(r.name)); if(!r.inBullhorn) f.appendChild(el("span","tag","not in Bullhorn")); return f; }},
      {k:"client",l:"Client",cell:function(r){ var f=document.createDocumentFragment(); f.appendChild(document.createTextNode(r.client||"—")); if(r.lob) f.appendChild(el("span","tag",r.lob)); return f; }, csv:function(r){ return r.client; }},
      {k:"ae",l:"A/E",get:function(r){ return r.ae; },tip:function(r){ return nameOf(r.ae); },csv:function(r){ return nameOf(r.ae); }},
      {k:"recruiter",l:"Recruiter",get:function(r){ return r.recruiter; },tip:function(r){ return nameOf(r.recruiter); },csv:function(r){ return nameOf(r.recruiter); }},
      {k:"attempt",l:"Last attempted contact",get:function(r){ return r.attempt&&r.attempt.date; },cell:function(r){ return contactCell(r.attempt); },csv:function(r){ return r.attempt? r.attempt.date+" "+[r.attempt.action,r.attempt.by].filter(Boolean).join(" · ") : ""; }},
      {k:"aDays",l:"Days",t:"n",sortVal:function(r){ return r.aDays==null? 1e6 : r.aDays; },cell:function(r){ return agePill(r.aDays); },title:"Days since the last attempted contact"},
      {k:"substance",l:"Last note of substance · click to read",get:function(r){ return r.substance&&r.substance.date; },cell:function(r){ return contactCell(r.substance,true); },tdClass:function(){ return "notecell"; },csv:function(r){ return r.substance? r.substance.date+" "+[r.substance.action,r.substance.by].filter(Boolean).join(" · ")+": "+r.substance.text : ""; }},
      {k:"sDays",l:"Days",t:"n",sortVal:function(r){ return r.sDays==null? 1e6 : r.sDays; },cell:function(r){ return agePill(r.sDays); },title:"Days since the last note of substance"}
    ];
    var sec=section("recontact","Consultants",rows.length+" of "+all.length+" · most overdue first",[seg,csvOf("recontacting_"+asOf+".csv",cols.map(function(c){ return c.k==="client"? {k:"client",l:"Client"} : c.k==="aDays"? {k:"aDays",l:"Days since attempt",t:"n"} : c.k==="sDays"? {k:"sDays",l:"Days since note of substance",t:"n"} : c; }),rows)]);
    sec.appendChild(dataTable("recontact",cols,rows,{sort:["sDays","desc"],sticky:true,cls:"rctable",minWidth:0,empty:"No consultants match."}));
    sec.appendChild(el("p","pnote","Attempted contact: the newest call, voicemail, text, email, InMail or meeting note on the candidate in Bullhorn, reached or not. Note of substance: the newest conversation note (recontact call, business conversation, meeting, video call, interview debrief…) with at least a sentence written, not counting dialer logs or voicemails. Green is 30 days or less, amber 31–60, red over 60."));
    body.appendChild(sec);
    body.classList.toggle("enter",mo==="load");
  }

  // ---- Spread: the latest weekly spread report, broken down ----
  function groupRows(rows,key){
    var by={}, out=[];
    rows.forEach(function(r){ var k=key(r)||"—", g=by[k]; if(!g){ g=by[k]={key:k,people:0,hc:0,revenue:0,gp:0,hours:0}; out.push(g); } g.people++; g.hc+=r.hc||0; g.revenue+=r.revenue||0; g.gp+=r.gp||0; g.hours+=r.hours||0; });
    out.forEach(function(g){ g.margin= g.revenue? g.gp/g.revenue : null; g.gpHour= g.hours? g.gp/g.hours : null; });
    return out;
  }
  function renderSpread(mo){
    var body=$("body"); body.textContent="";
    if(!REPORT){ $("mMonth").textContent="Spread report"; $("mRange").textContent="The latest Weekly Spread Dashboard"; $("mSrc").textContent="Sources: Weekly Spread Dashboard";
      body.appendChild(emptyNote("No spread report yet","Upload the Weekly Spread Dashboard in the admin panel; this tab breaks down the whole report: weekly totals and run rate, clients, account managers, recruiters and every consultant.")); return; }
    var R=REPORT, wk=R.weekly, D=R.detail, mt=R.mtd||{};
    $("mMonth").textContent="Week ending "+longDate(R.weekEnding);
    $("mRange").textContent=(mt.label||"")+(mt.weekOf? " · week "+mt.weekOf[0]+" of "+mt.weekOf[1]+(mt.weekOf[0]<mt.weekOf[1]? " (month to date)" : " (full month)") : "");
    $("mSrc").textContent="Spread: "+(R.file||"Weekly Spread Dashboard")+" · uploaded "+new Date(R.at).toLocaleDateString("en-US",{month:"short",day:"numeric"})+(R.by? " by "+R.by : "");
    var rev=wk? wk.revenue : sumBy(D,"revenue"), gp=wk? wk.gp : sumBy(D,"gp"), hrs=sumBy(D,"hours"), hc=sumBy(D,"hc");
    var k=el("div","kpis"); function tile(lab,v,note){ var t=el("div","kpi"), vd=el("div","val num",v); if(mo) countUp(vd,v); t.appendChild(el("div","lab",lab)); t.appendChild(vd); t.appendChild(el("div","note",note||" ")); k.appendChild(t); }
    tile("Run rate", moneyMM(rev*52), money(rev)+" week's revenue × 52");
    tile("Weekly revenue", money(rev), "week ending "+dateLabel(R.weekEnding));
    tile("Weekly GP", money(gp), rev? pct1(gp/rev)+" margin" : "");
    tile("GP run rate", moneyMM(gp*52), "weekly GP × 52");
    tile("Billing", n(hc), D.length+" consultants on the Detail sheet");
    tile("GP / hour", hrs? "$"+(gp/hrs).toFixed(2) : "—", n(Math.round(hrs))+" hours billed");
    k.firstChild.classList.add("primary"); k.style.setProperty("--n",k.children.length-1);
    body.appendChild(k);

    if(mt.gp!=null){
      var ms=section("mtd","Month to date",(mt.label||"")+(mt.weekOf? " · week "+mt.weekOf[0]+" of "+mt.weekOf[1] : "")+" · from the Dashboard - Month To Date sheet");
      var g=el("div","mtdgrid");
      [["Revenue",money(mt.revenue)],["Gross profit",money(mt.gp)],["Margin",mt.revenue? pct1(mt.gp/mt.revenue) : "—"],["GP per week",mt.weekOf? money(mt.gp/mt.weekOf[0]) : "—"]].forEach(function(x){ var d=el("div"); d.appendChild(el("div","lab",x[0])); d.appendChild(el("div","val num",x[1])); g.appendChild(d); });
      ms.appendChild(g); body.appendChild(ms);
    }

    var shown=D.filter(function(d){ return hit([d.first,d.last,d.client,d.lob,d.ae,d.recruiter,nameOf(d.ae),nameOf(d.recruiter),d.type,d.thirdParty]); });
    var q=q2(), qh= q? " · matching “"+state.q.trim()+"”" : "";
    var share=function(g){ return gp? g.gp/gp : null; };
    var gcols=function(first){ return [{k:"key",l:first},{k:"hc",l:"Billing",t:"n"},{k:"revenue",l:"Revenue",t:"money"},{k:"gp",l:"GP",t:"money"},{k:"margin",l:"Margin",t:"pct"},{k:"gpHour",l:"GP / hr",t:"money2"},{k:"share",l:"Share of GP",t:"pct",get:share}]; };
    var tot=function(rows){ var t={key:"Total",hc:sumBy(rows,"hc"),revenue:sumBy(rows,"revenue"),gp:sumBy(rows,"gp"),hours:sumBy(rows,"hours")}; t.margin=t.revenue? t.gp/t.revenue : null; t.gpHour=t.hours? t.gp/t.hours : null; return t; };
    var grid=el("div","xgrid");
    function block(id,title,first,key,extra){
      var rows=groupRows(shown,key), cols=gcols(first).concat(extra||[]);
      var sec=section(null,title,null,[csvOf("spread_"+id+"_"+R.weekEnding+".csv",cols,rows)]);
      sec.appendChild(dataTable("sp-"+id,cols,rows,{sort:["gp","desc"],total:tot(shown),minWidth:0})); return sec;
    }
    var lob=block("lob","By line of business","Line of business",function(d){ return d.lob; });
    var typ=block("type","By employment type","Type",function(d){ return d.thirdParty? "Third party" : d.type; });
    var mtdAe=mt.ae||{}, mtdRm=mt.rm||{}, mtdCl={}; (R.clients||[]).forEach(function(c){ mtdCl[c.client]=c; });
    var ae=block("ae","By account manager","Account manager",function(d){ return nameOf(d.ae); },[{k:"mtd",l:"MTD GP",t:"money",get:function(g){ var v=null; Object.keys(mtdAe).forEach(function(n0){ if(nameOf(n0)===g.key) v=mtdAe[n0]; }); return v; }}]);
    var rm=block("rm","By recruiter","Recruiter",function(d){ return nameOf(d.recruiter); },[{k:"mtd",l:"MTD GP",t:"money",get:function(g){ var v=null; Object.keys(mtdRm).forEach(function(n0){ if(nameOf(n0)===g.key) v=mtdRm[n0]; }); return v; }}]);
    [lob,typ,ae,rm].forEach(function(x){ grid.appendChild(x); });

    var clRows=groupRows(shown,function(d){ return d.client; });
    clRows.forEach(function(g){ var l={}; shown.forEach(function(d){ if(d.client===g.key&&d.lob) l[d.lob]=1; }); g.lob=Object.keys(l).join(" / "); var c=mtdCl[g.key]; g.mtdRevenue=c? c.revenue : null; g.mtdGp=c? c.gp : null; });
    var ccols=[{k:"key",l:"Client"},{k:"lob",l:"LOB"},{k:"hc",l:"Billing",t:"n"},{k:"revenue",l:"Weekly revenue",t:"money"},{k:"gp",l:"Weekly GP",t:"money"},{k:"margin",l:"Margin",t:"pct"},{k:"gpHour",l:"GP / hr",t:"money2"},{k:"mtdRevenue",l:"MTD revenue",t:"money"},{k:"mtdGp",l:"MTD GP",t:"money"}];
    var ctot=tot(shown); ctot.mtdRevenue=sumBy(clRows,"mtdRevenue"); ctot.mtdGp=sumBy(clRows,"mtdGp");
    var cs=section(null,"By client",clRows.length+" clients"+qh,[csvOf("spread_clients_"+R.weekEnding+".csv",ccols,clRows)]);
    cs.appendChild(dataTable("sp-client",ccols,clRows,{sort:["gp","desc"],total:ctot,minWidth:860}));
    body.appendChild(cs);
    body.appendChild(grid);

    if(REPORT_WEEKS.length){
      var wcols=[{k:"weekEnding",l:"Week ending",cell:function(w){ return longDate(w.weekEnding); }},{k:"revenue",l:"Revenue",t:"money"},{k:"runRate",l:"Run rate",t:"money",cell:function(w){ return moneyMM(w.runRate); }},{k:"gp",l:"GP",t:"money"},{k:"margin",l:"Margin",t:"pct",get:function(w){ return w.revenue? w.gp/w.revenue : null; }},{k:"hc",l:"Billing",t:"n"}];
      var ws=section(null,"Weekly totals","each uploaded report's week",[csvOf("spread_weeks.csv",wcols,REPORT_WEEKS)]);
      ws.appendChild(dataTable("sp-weeks",wcols,REPORT_WEEKS,{sort:["weekEnding","desc"],minWidth:640})); body.appendChild(ws);
    }

    var dcols=[
      {k:"name",l:"Consultant",get:function(d){ return (d.last+", "+d.first).trim(); }},
      {k:"client",l:"Client"},{k:"lob",l:"LOB"},
      {k:"ae",l:"A/E",get:function(d){ return nameOf(d.ae); }},{k:"recruiter",l:"Recruiter",get:function(d){ return nameOf(d.recruiter); }},
      {k:"type",l:"Type",get:function(d){ return d.thirdParty? "3rd party: "+d.thirdParty : d.type; }},
      {k:"start",l:"Start",cell:function(d){ return d.start? longDate(d.start) : "—"; }},
      {k:"bill",l:"Bill",t:"money2"},{k:"pay",l:"Pay",t:"money2"},{k:"hours",l:"Hours",t:"hrs"},
      {k:"revenue",l:"Revenue",t:"money"},{k:"gp",l:"GP",t:"money"},
      {k:"margin",l:"Margin",t:"pct",get:function(d){ return d.revenue? d.gp/d.revenue : null; }},
      {k:"gpHour",l:"GP / hr",t:"money2"},
      {k:"notes",l:"Notes"}
    ];
    var dtot={name:"Total",hours:sumBy(shown,"hours"),revenue:sumBy(shown,"revenue"),gp:sumBy(shown,"gp")}; dtot.margin=dtot.revenue? dtot.gp/dtot.revenue : null; dtot.gpHour=dtot.hours? dtot.gp/dtot.hours : null;
    var dsec=section(null,"Consultants",shown.length+" of "+D.length+qh,[csvOf("spread_consultants_"+R.weekEnding+".csv",dcols,shown)]);
    dsec.appendChild(dataTable("sp-detail",dcols,shown,{sort:["gp","desc"],sticky:true,total:dtot,minWidth:1400}));
    body.appendChild(dsec);

    // deals in the current payroll month, from Bullhorn
    var keys=monthKeys(), cur= keys.length? MONTHS[keys[keys.length-1]] : null;
    if(cur){
      var dl=(cur.deals||[]).filter(function(d){ return hit([d.candidate,d.client,d.title,nameOf(d.ae),nameOf(d.recruiter)]); });
      var dcols2=[{k:"added",l:"Added",cell:function(d){ return longDate(d.added); },csv:function(d){ return d.added; }},{k:"candidate",l:"Candidate"},{k:"client",l:"Client"},{k:"title",l:"Job",get:function(d){ return d.title&&d.title.trim(); }},
        {k:"ae",l:"Account manager",get:function(d){ return nameOf(d.ae); }},{k:"recruiter",l:"Recruiter",get:function(d){ return nameOf(d.recruiter); }},
        {k:"start",l:"Start",cell:function(d){ return d.start? longDate(d.start) : "—"; },csv:function(d){ return d.start; }},
        {k:"status",l:"Status",cell:function(d){ return el("span","pill "+(d.status==="Never Started"?"no":(d.status==="Approved"||d.status==="Completed")?"ok":"mid"),d.status||"—"); }}];
      var dsx=section("dealsec","Deals this month",cur.label+" · "+dl.length+" placement"+(dl.length===1?"":"s")+" created in Bullhorn"+(META&&META.bullhornAsOf? " as of "+dateLabel(META.bullhornAsOf) : ""),[csvOf("deals_"+cur.key+".csv",dcols2,dl)]);
      dsx.appendChild(dataTable("sp-deals",dcols2,dl,{sort:["added","desc"],minWidth:980,empty:"No placements created yet this month."}));
      body.appendChild(dsx);
    }
    body.appendChild(forecastSection());
    body.classList.toggle("enter",mo==="load");
  }

  // ---- Where we're headed: an estimate from the report's week plus upcoming starts and ends in Bullhorn ----
  // Each week = the report week's revenue and GP, minus consultants whose placement ends, plus placements starting,
  // counted by working days (a Wednesday start adds 3/5 of a week). Starts use Bullhorn bill and pay rates for 40
  // hours with the report's usual burden. Not included: deals not made yet, extensions not yet in Bullhorn, perm
  // fees, and hours that change.
  function fwd(iso,d){ var t=new Date(iso+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+d); return t.toISOString().slice(0,10); }
  function workShare(weekEnd,from,to){ // share of the week's Mon-Fri inside [from, to]
    var n0=0; for(var d=1;d<=5;d++){ var day=fwd(weekEnd,-6+d); if((!from||day>=from)&&(!to||day<=to)) n0++; } return n0/5;
  }
  function forecastSection(){
    var F=FORECAST;
    var sec=section("forecast","Where we're headed","An estimate, not reported numbers");
    if(!F||!REPORT||F.weekEnding!==REPORT.weekEnding||F.base.revenue==null){ sec.appendChild(el("p","pnote","Shows after the Bullhorn sync runs for the latest spread report (admin panel → Bullhorn activity → Sync now).")); return sec; }
    var W=13, weeks=[];
    for(var i=1;i<=W;i++){
      var we=fwd(F.weekEnding,7*i), rev=F.base.revenue, gp=F.base.gp, hc=F.base.hc, st=[], en=[];
      F.ends.forEach(function(e){ var gone=1-workShare(we,null,e.end); if(gone>0){ rev-=e.weeklyRevenue*gone; gp-=e.weeklyGp*gone; if(gone===1) hc--; } if(e.end>fwd(we,-7)&&e.end<=we) en.push(e); });
      F.starts.forEach(function(s0){ if(s0.weeklyGp==null) return; var on=workShare(we,s0.begin,s0.end); if(on>0){ rev+=s0.weeklyRevenue*on; gp+=s0.weeklyGp*on; if(on===1) hc++; } if(s0.begin>fwd(we,-7)&&s0.begin<=we) st.push(s0); });
      weeks.push({weekEnding:we,revenue:rev,gp:gp,runRate:rev*52,hc:hc,starts:st,ends:en,past:META&&META.bullhornAsOf&&we<=META.bullhornAsOf});
    }
    var k=el("div","kpis"); function tile(lab,v,note){ var t=el("div","kpi"), vd=el("div","val num",v); t.appendChild(el("div","lab",lab)); t.appendChild(vd); t.appendChild(el("div","note",note||" ")); k.appendChild(t); }
    var w4=weeks[3], w8=weeks[7], w13=weeks[12];
    tile("Run rate now",moneyMM(F.base.revenue*52),"w/e "+dateLabel(F.weekEnding)+" · "+money(F.base.gp)+" GP");
    [w4,w8,w13].forEach(function(w,i){ var d=w.runRate-F.base.revenue*52; tile("In "+[4,8,13][i]+" weeks",moneyMM(w.runRate),"w/e "+dateLabel(w.weekEnding)+" · "+money(w.gp)+" GP/wk ("+(d>=0?"+":"−")+moneyMM(Math.abs(d))+")"); });
    var gs=F.starts.filter(function(s0){ return s0.weeklyGp!=null; });
    tile("Starts coming",n(F.starts.length),"+"+money(sumBy(gs,"weeklyGp"))+" GP/wk at full weeks");
    tile("Ends coming",n(F.ends.length),"−"+money(sumBy(F.ends,"weeklyGp"))+" GP/wk");
    k.firstChild.classList.add("primary"); k.style.setProperty("--n",k.children.length-1);
    sec.appendChild(k);
    var wcols=[{k:"weekEnding",l:"Week ending",cell:function(w){ var f=document.createDocumentFragment(); f.appendChild(document.createTextNode(longDate(w.weekEnding))); if(w.past) f.appendChild(el("span","tag","past · not uploaded")); return f; }},
      {k:"starts",l:"Starts",cell:function(w){ return w.starts.length? w.starts.map(function(s0){ return s0.name; }).join(", ") : "—"; },csv:function(w){ return w.starts.map(function(s0){ return s0.name; }).join("; "); }},
      {k:"ends",l:"Ends",cell:function(w){ return w.ends.length? w.ends.map(function(e){ return e.name; }).join(", ") : "—"; },csv:function(w){ return w.ends.map(function(e){ return e.name; }).join("; "); }},
      {k:"hc",l:"Billing",t:"n"},{k:"revenue",l:"Est. revenue",t:"money"},{k:"gp",l:"Est. GP",t:"money"},{k:"runRate",l:"Est. run rate",t:"money",cell:function(w){ return moneyMM(w.runRate); }}];
    var wrap=el("div","fctable"); wrap.appendChild(dataTable("fc-weeks",wcols,weeks,{nosort:true,minWidth:980})); sec.appendChild(wrap);
    sec.tools=null;
    var hd=sec.querySelector(".sechead"), t=el("div","ptools"); t.appendChild(csvOf("forecast_"+F.weekEnding+".csv",wcols,weeks)); hd.appendChild(t);
    if(F.starts.length){
      var sc=[{k:"begin",l:"Start",cell:function(s0){ return longDate(s0.begin); },csv:function(s0){ return s0.begin; }},{k:"name",l:"Consultant"},{k:"client",l:"Client"},{k:"title",l:"Job"},{k:"employmentType",l:"Type"},{k:"bill",l:"Bill",t:"money2"},{k:"pay",l:"Pay",t:"money2"},{k:"weeklyRevenue",l:"Est. weekly revenue",t:"money"},{k:"weeklyGp",l:"Est. weekly GP",t:"money"},{k:"status",l:"Status"}];
      var h3=el("h3",null,"Starting"); sec.appendChild(h3); sec.appendChild(dataTable("fc-starts",sc,F.starts,{sort:["begin","asc"],minWidth:1100}));
    }
    if(F.ends.length){
      var ec=[{k:"end",l:"End date",cell:function(e){ return longDate(e.end); },csv:function(e){ return e.end; }},{k:"name",l:"Consultant"},{k:"client",l:"Client"},{k:"lob",l:"LOB"},{k:"ae",l:"A/E",get:function(e){ return nameOf(e.ae); }},{k:"recruiter",l:"Recruiter",get:function(e){ return nameOf(e.recruiter); }},{k:"weeklyRevenue",l:"Weekly revenue",t:"money"},{k:"weeklyGp",l:"Weekly GP",t:"money"}];
      sec.appendChild(el("h3",null,"Ending")); sec.appendChild(dataTable("fc-ends",ec,F.ends,{sort:["end","asc"],minWidth:960}));
    }
    var noRate=F.starts.length-gs.length;
    sec.appendChild(el("p","pnote","How it's worked out: start from the week ending "+longDate(F.weekEnding)+" ("+money(F.base.revenue)+" revenue, "+money(F.base.gp)+" GP). Each later week takes off consultants whose Bullhorn placement has ended and adds placements that have started, by working days. Starts are "+F.hoursPerWeek+" hours a week at their Bullhorn bill and pay rates, with "+Math.round(F.burden.w2*100)+"% burden for W2 and "+Math.round(F.burden.third*100)+"% for third party (the report's usual rates). Not counted: deals not made yet, extensions not yet entered in Bullhorn (an unextended end date shows as an end), hours that change, and perm fees"+(F.perm&&F.perm.length? " ("+F.perm.length+" perm placement"+(F.perm.length===1?"":"s")+" starting)" : "")+"."+(noRate? " "+noRate+" start"+(noRate===1?" has":"s have")+" no bill or pay rate in Bullhorn, so "+(noRate===1?"it isn't":"they aren't")+" counted." : "")));
    return sec;
  }

  // Comfortable / Compact row height for the people table
  function densityToggle(){
    var g=el("div","tabs density"); g.setAttribute("role","group"); g.setAttribute("aria-label","Row density");
    [["Comfortable",false],["Compact",true]].forEach(function(p){
      var b=el("button",null,p[0]); b.type="button"; b.setAttribute("aria-pressed",String(compact===p[1]));
      b.addEventListener("click",function(){
        if(compact===p[1]) return;
        compact=p[1]; try{ localStorage.setItem("ss-density",compact?"compact":"comfortable"); }catch(e){}
        render();
        var nb=document.querySelectorAll(".density button")[p[1]?1:0]; if(nb) nb.focus(); // render() rebuilt the controls
      });
      g.appendChild(b);
    });
    return g;
  }

  // "Columns" button and its checkbox popover. It stays open across renders until a click outside or Escape.
  function saveHidden(){ try{ localStorage.setItem("ss-cols",JSON.stringify(HIDDEN)); }catch(e){} }
  function columnChooser(side,cols,hasTgt){
    var opts=[];
    cols.forEach(function(c){
      opts.push({k:c.k,l:c.l});
      if(c.t==="spread" && hasTgt) opts.push({k:"tcol",l:"% of target"});
    });
    var off=opts.filter(function(o){ return !shown(side,o.k); }).length;
    var wrap=el("div","colpick");
    var btn=el("button","field colbtn","Columns"); btn.type="button";
    if(off) btn.appendChild(el("span","colcount",(opts.length-off)+"/"+opts.length));
    btn.setAttribute("aria-haspopup","true"); btn.setAttribute("aria-expanded",String(colsOpen)); btn.setAttribute("aria-controls","colpop");
    var pop=el("div","colpop"); pop.id="colpop"; pop.hidden=!colsOpen; pop.setAttribute("role","group"); pop.setAttribute("aria-label","Columns to show");
    function refocus(sel){ render(); var x=document.querySelector(sel); if(x) x.focus(); }
    opts.forEach(function(o){
      var lab=el("label","check"+(LOCKED[o.k]?" locked":"")), cb=el("input"); cb.type="checkbox";
      cb.setAttribute("data-k",o.k); cb.checked=shown(side,o.k);
      if(LOCKED[o.k]){ cb.disabled=true; lab.title="Always shown"; }
      cb.addEventListener("change",function(){
        var h=HIDDEN[side], i=h.indexOf(o.k);
        if(cb.checked){ if(i>=0) h.splice(i,1); } else if(i<0) h.push(o.k);
        saveHidden(); refocus('.colpop input[data-k="'+o.k+'"]');
      });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(o.l));
      pop.appendChild(lab);
    });
    var reset=el("button","field small","Show all"); reset.type="button"; reset.disabled=!off;
    reset.addEventListener("click",function(){ HIDDEN[side]=[]; saveHidden(); refocus(".colpop input:not([disabled])"); });
    pop.appendChild(reset);
    btn.addEventListener("click",function(){ setColsOpen(!colsOpen); });
    wrap.appendChild(btn); wrap.appendChild(pop);
    return wrap;
  }
  function setColsOpen(open,focusBtn){
    colsOpen=open;
    var pop=$("colpop"), btn=document.querySelector(".colbtn");
    if(pop) pop.hidden=!open;
    if(btn){ btn.setAttribute("aria-expanded",String(open)); if(focusBtn) btn.focus(); }
  }
  document.addEventListener("click",function(e){ if(colsOpen && !(e.target.closest && e.target.closest(".colpick"))) setColsOpen(false); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && colsOpen){ e.preventDefault(); setColsOpen(false,true); } });

  var NAMES={};
  function nameOf(last){ if(!last||last==="_other") return "Unassigned"; return NAMES[last]||last; }
  var DEFS=[
    ["Spread / wk","Gross profit from Shelley's Weekly Spread Dashboard, credited to the account manager (A/E) and recruiter (R/M) on each consultant, shown as a weekly average: the month's spread divided by its payroll weeks (the weeks reported so far for a month-to-date report). Weeks of 30k, 30k, 30k and 50k average 35k. Periods divide total spread by total weeks, and targets are compared per week."],
    ["Month","The report's payroll month: Sunday to Saturday weeks, grouped by the Saturday the week ends on. Bullhorn activity uses the same dates."],
    ["Client visits","New, Existing and In-Person Meetings logged against a client contact, all combined."],
    ["Job orders","New job orders by owner. MIT Lincoln Laboratory reqs loaded by the web import are credited to Hannah Wilkinson, the MIT account manager."],
    ["Send outs","Candidates submitted to clients against the account manager's job orders."],
    ["Submittals","The same submissions, credited to the recruiter who sent them."],
    ["Interviews","Candidates with an Interview, Interview Prep or Interview Debrief note, counted once per candidate per week and credited to the job's account manager and the submitting recruiter."],
    ["Deals / Placements","Placements created in Bullhorn during the month, including ones that later never started."],
    ["Starts","Placements whose start date falls in the month, excluding Never Started."],
    ["Ratios","Send out : deal, Interview : deal, Visit : deal and Submittal : deal show activity per deal; everyone has Interview : deal. Fill % is deals divided by job orders."],
    ["Run rate","The latest weekly spread report's revenue for the week, times 52, in millions ($MM)."],
    ["Primes","Federal clients (LOB Federal on the spread report's Detail sheet) with someone billing that week. Each consultant's Placement ID links the client to its Bullhorn company, whose job orders, client visits, submittals, interviews and deals are counted for the selected month. Weekly GP is that week's gross profit from the report."],
    ["Not shown","Michael Salemi, Connor Rogers and Kyle Driscoll are commercial users and aren't listed. Their spread is still in the company total."]
  ];

  // Company spread by month: bars with a dashed average line, and margin % in its own band above
  // (margin moves within a few points, so it gets a min–max scale rather than sharing the bars' $ axis).
  function margin(m){ return m.spread&&m.revenue? m.gp/m.revenue : null; }
  function pct1(v){ return (v*100).toFixed(1)+"%"; }
  function monthChart(keys,grow){
    var padL=22, padR=78, W=Math.max(keys.length*86,600)+padR-padL, H=150;
    var mTop=18, mBot=42, top=66, base=H-24;
    var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.setAttribute("class","chart"+(grow?" grow":"")); svg.setAttribute("role","group"); svg.setAttribute("aria-label","Company spread and margin by month");
    function E(tag,a,parent){ var e=document.createElementNS(svg.namespaceURI,tag); for(var k in a) e.setAttribute(k,a[k]); (parent||svg).appendChild(e); return e; }
    function T(x,y,s,cls,anchor,parent){ var t=E("text",{x:x,y:y,"text-anchor":anchor||"middle"},parent); if(cls) t.setAttribute("class",cls); t.textContent=s; return t; }

    var sp=keys.filter(function(k){ return MONTHS[k].spread; }), full=sp.filter(function(k){ return !mtd(MONTHS[k]); }), max=0, sum=0;
    sp.forEach(function(k){ var v=MONTHS[k].gp||0; if(v>max) max=v; });
    var tg={}; keys.forEach(function(k){ var t=monthTarget(MONTHS[k],state.side,null); if(t){ tg[k]=t; if(t>max) max=t; } });
    full.forEach(function(k){ sum+=MONTHS[k].gp||0; });
    var avg= full.length? sum/full.length : null; // month-to-date figures would drag the average down
    var mv=sp.map(function(k){ return margin(MONTHS[k]); }).filter(function(v){ return v!=null; });
    var lo=Math.min.apply(null,mv), hi=Math.max.apply(null,mv);
    if(hi-lo<0.04){ var mid=(hi+lo)/2; lo=mid-0.02; hi=mid+0.02; }
    function my(v){ return mBot-(mBot-mTop)*(v-lo)/(hi-lo); }
    var slot=(W-padL-padR)/keys.length, bw=Math.min(46,slot*0.56);
    // value labels sit a fixed 7px above each bar; when that month's target line would cut through the label,
    // the label moves just above the line instead
    function labelY(barTop,t){
      var y=barTop-7;
      if(t){ var ty=base-(base-top)*t/max; if(ty>y-13 && ty<y+4) y=Math.min(y,ty-6); }
      return y;
    }
    function cx(i){ return padL+slot*i+slot/2; }

    // vertical bar gradients (colors come from CSS so they follow the theme)
    var defs=E("defs",{});
    [["mcG","gs"],["mcGon","gs on"]].forEach(function(gd){
      var lg=E("linearGradient",{id:gd[0],x1:"0",y1:"0",x2:"0",y2:"1"},defs);
      E("stop",{offset:"0","class":gd[1]},lg); E("stop",{offset:"1","class":gd[1]+" lo"},lg);
    });
    // a bar with only its top corners rounded
    function topRound(x,y,w,h,rad){
      var q=Math.min(rad,w/2,h);
      return "M"+x+","+(y+h)+"V"+(y+q)+"Q"+x+","+y+" "+(x+q)+","+y+"H"+(x+w-q)+"Q"+(x+w)+","+y+" "+(x+w)+","+(y+q)+"V"+(y+h)+"Z";
    }
    E("line",{x1:padL,x2:W-padR,y1:base,y2:base,stroke:"currentColor","stroke-opacity":"0.18"});
    // average line sits behind the bars; value labels are haloed so it breaks around them
    var ay= avg!=null && max>0? base-(base-top)*avg/max : null;
    if(ay!=null) E("line",{x1:padL,x2:W-padR+6,y1:ay,y2:ay,"class":"avg"});
    // target: a short line over each month that has one (5-week months can be higher), also behind the bars
    var lastTy=null;
    keys.forEach(function(k,i){
      if(!tg[k]) return;
      var ty=base-(base-top)*tg[k]/max, x1=cx(i)-slot*0.38, x2=cx(i)+slot*0.38; lastTy=ty;
      E("line",{x1:x1,x2:x2,y1:ty,y2:ty,"class":"tline"});
      E("line",{x1:x2,x2:x2,y1:ty-3,y2:ty+3,"class":"tcap"}); // small end cap
    });
    keys.forEach(function(k,i){
      var m=MONTHS[k], x=cx(i), on=isOn(k), mg=margin(m);
      var g=E("g",{"class":"m",tabindex:"0",role:"button","data-k":k,style:"--i:"+i});
      g.setAttribute("aria-label",m.label+": "+(m.spread? "spread "+money(m.gp)+" per week, "+money(m.gpTotal)+" over "+m.spreadW+" weeks"+(m.revenue? ", margin "+pct1(mg) : "") : "spread pending, "+m.weeks+" payroll weeks"));
      E("rect",{x:x-slot/2+3,y:mTop-12,width:slot-6,height:base-mTop+12,rx:4,"class":"hit"},g);
      var anchor;
      if(m.spread && max>0){
        var h=Math.max(2,(base-top)*m.gp/max);
        if(on) E("path",{d:topRound(x-bw/2-3,base-h-3,bw+6,h+3,6),"class":"halo"},g); // soft glow behind the selected month
        anchor=E("path",{d:topRound(x-bw/2,base-h,bw,h,4),"class":"bar"+(on?" on":"")+(mtd(m)?" part":"")},g);
        T(x,labelY(base-h,tg[k]),moneyK(m.gp)+(mtd(m)?" MTD":""),"v",null,g);
      } else {
        anchor=E("line",{x1:x-bw/2,x2:x+bw/2,y1:base,y2:base,"class":"pendline"},g);
        T(x,base-10,"pending","v",null,g);
      }
      T(x,H-6,m.short,on?"v":null,null,g);
      function pick(){ state.month=k; $("month").value=k; animate("month"); render(); }
      g.addEventListener("click",pick);
      g.addEventListener("keydown",function(e){
        if(e.key!=="Enter"&&e.key!==" ") return;
        e.preventDefault(); pick();
        var ng=document.querySelector('.months g.m[data-k="'+k+'"]'); if(ng) ng.focus(); // render() rebuilt the chart
      });
      g.addEventListener("mouseenter",function(){ showTip(anchor,m); });
      g.addEventListener("focus",function(){ showTip(anchor,m); });
      g.addEventListener("mouseleave",hideTip);
      g.addEventListener("blur",hideTip);
    });

    // series labels in the right gutter
    if(ay!=null) T(W-padR+10,ay+4,"avg "+moneyK(avg),"lg","start");
    if(lastTy!=null) T(W-padR+10,(ay!=null && Math.abs(lastTy-ay)<13? Math.min(lastTy,ay)-9 : lastTy+4),"target","lg tlab","start");
    if(mv.length){
      var pts=[];
      keys.forEach(function(k,i){ var v=margin(MONTHS[k]); if(v!=null) pts.push([cx(i),my(v),v,k]); });
      E("polyline",{points:pts.map(function(p){ return p[0]+","+p[1]; }).join(" "),"class":"mline"});
      pts.forEach(function(p){
        var on=isOn(p[3]);
        E("circle",{cx:p[0],cy:p[1],r:on?3.5:2.75,"class":"mdot"+(on?" on":"")});
        T(p[0],p[1]-7,Math.round(p[2]*100)+"%","mv"+(on?" v":""));
      });
      T(W-padR+10,(mTop+mBot)/2+4,"margin","lg","start");
    }
    return svg;
  }

  // one shared tooltip, fixed to the viewport so the chart's scroll box can't clip it
  var tip=null;
  function showTip(anchor,m){
    if(!tip){ tip=el("div","ctip"); tip.setAttribute("aria-hidden","true"); document.body.appendChild(tip); }
    tip.textContent="";
    tip.appendChild(el("strong",null,m.label));
    var dl=el("dl");
    var rows= m.spread? [["Spread / week",money(m.gp)],["Month "+(mtd(m)? "so far" : "total"),money(m.gpTotal)],["Weeks",mtd(m)? m.spreadWeeks[0]+" of "+m.spreadWeeks[1] : String(m.weeks)],["Revenue / week",m.revenue? money(m.revenue):"—"],["Margin",m.revenue? pct1(margin(m)):"—"]]
                      : [["Spread","Pending"],["Payroll weeks",String(m.weeks)]];
    var t=monthTarget(m,state.side,null);
    if(t){ var ts=targetShare(m,m.spread? m.gp : null,t); rows.push(["Target",moneyK(t)+(ts? " · "+Math.round(ts.share*100)+"%" : "")]); }
    rows.forEach(function(r){ dl.appendChild(el("dt",null,r[0])); dl.appendChild(el("dd",null,r[1])); });
    tip.appendChild(dl); tip.hidden=false;
    var r=anchor.getBoundingClientRect(), tw=tip.offsetWidth, th=tip.offsetHeight;
    var x=Math.min(Math.max(8,r.left+r.width/2-tw/2),window.innerWidth-tw-8), y=r.top-th-10;
    if(y<8) y=r.bottom+10;
    tip.style.left=Math.round(x)+"px"; tip.style.top=Math.round(y)+"px";
  }
  function hideTip(){ if(tip) tip.hidden=true; }
  window.addEventListener("scroll",hideTip,{passive:true,capture:true});

  // person panel: one person's history across every loaded month
  var PCOLS={
    sales:["spread","visits","sendOuts","interviews","deals","soDeal","intDeal"],
    recruiting:["spread","submittals","interviews","placements","subDeal","intDeal"]
  };
  var dlg=null, opener=null;
  function openPerson(name,side,from){
    if(!dlg){
      dlg=el("dialog","drawer"); dlg.setAttribute("aria-labelledby","pTitle");
      dlg.addEventListener("click",function(e){ if(e.target===dlg) dlg.close(); });
      dlg.addEventListener("close",function(){ if(opener&&opener.isConnected) opener.focus(); });
      document.body.appendChild(dlg);
    }
    dlg.classList.remove("wide");
    var keys=monthKeys(), all=COLS[side];
    var cols=PCOLS[side].map(function(k){ return all.filter(function(c){ return c.k===k; })[0]; });
    var hist=keys.map(function(k){ var m=MONTHS[k]; return {k:k,m:m,r:(m[side]||[]).filter(function(x){ return x.name===name; })[0]||null}; });
    var mine=hist.filter(function(h){ return h.r; }), last=mine.length? mine[mine.length-1].r : null;
    var dealKey= side==="sales"? "deals" : "placements";

    dlg.textContent="";
    var pin=el("div","pin");
    var hd=el("header","phead"), ht=el("div");
    ht.appendChild(el("div","eyebrow",side==="sales"?"Account manager":"Recruiter"));
    var h2=el("h2",null,nameOf(name)); h2.id="pTitle"; if(last&&last.former) h2.appendChild(el("span","tag","former")); ht.appendChild(h2);
    hd.appendChild(ht);
    var x=el("button","pclose","×"); x.type="button"; x.setAttribute("aria-label","Close"); x.addEventListener("click",function(){ dlg.close(); }); hd.appendChild(x);
    pin.appendChild(hd);

    // summary
    var sp=hist.filter(function(h){ return h.m.spread && h.r; }), tot=0, best=null, dl=0;
    var wks=0; sp.forEach(function(h){ tot+=h.r.spreadTotal||0; wks+=h.m.spreadW; if(!best||(h.r.spread||0)>(best.r.spread||0)) best=h; });
    mine.forEach(function(h){ dl+=h.r[dealKey]||0; });
    var st=el("div","pstats");
    function stat(lab,val,note){ var t=el("div","pstat"); t.appendChild(el("div","lab",lab)); t.appendChild(el("div","val num",val)); t.appendChild(el("div","note",note)); st.appendChild(t); }
    stat("Weekly average", sp.length&&wks? money(tot/wks) : "—", sp.length? money(tot)+" over "+wks+" weeks, "+sp[0].m.short+"–"+sp[sp.length-1].m.short : "No spread yet");
    stat("Best month", best? moneyK(best.r.spread||0)+" / wk" : "—", best? best.m.label : "");
    stat(side==="sales"?"Deals":"Placements", n(dl), "across "+mine.length+" month"+(mine.length===1?"":"s"));
    pin.appendChild(st);

    var cs=el("section","psec"); cs.appendChild(el("h3",null,"Weekly spread by month"));
    var cb=el("div","chartbox"); cb.appendChild(personChart(hist,nameOf(name))); cs.appendChild(cb); pin.appendChild(cs);

    // monthly table, newest first; ratios graded against that month's team
    var ts=el("section","psec"); ts.appendChild(el("h3",null,"Month by month"));
    var box=el("div","tablebox ptable"), tbl=el("table","num"), th=el("thead"), hr=el("tr");
    hr.appendChild(el("th",null,"Month")); cols.forEach(function(c){ hr.appendChild(el("th",null,c.l)); });
    th.appendChild(hr); tbl.appendChild(th);
    var tb=el("tbody"), sum={};
    mine.slice().reverse().forEach(function(h){
      var tr=el("tr"), team=totals(h.m[side]||[],all);
      tr.appendChild(el("td",null,h.m.short+(h.m.spread&&!mtd(h.m)?"":" *")));
      cols.forEach(function(c){
        var v=computed(h.r,c), td=el("td");
        if(c.t==="spread"){ if(!h.m.spread||v==null){ td.textContent=h.m.spread?"—":"Pending"; td.className="zero"; } else td.textContent=money(v); }
        else if(c.t==="n"){ td.textContent=n(v); if(!v) td.className="zero"; }
        else { td.textContent=c.t==="pct"? pct(v) : rtxt(v); var gc=gradeCell(c,h.r,v,computed(team,c),"this month"); td.className="r"+(gc.cls?" "+gc.cls:""); if(gc.title) td.title=gc.title; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
      all.forEach(function(c){ if(c.t==="n"||(c.t==="spread"&&h.m.spread)) sum[c.k]=(sum[c.k]||0)+(h.r[c.k]||0); });
    });
    if(mine.length){
      var tr=el("tr","total"); tr.appendChild(el("td",null,"All"));
      cols.forEach(function(c){ var v=computed(sum,c); tr.appendChild(el("td",null, c.t==="spread"? (sp.length? money(v):"—") : c.t==="n"? n(v||0) : c.t==="pct"? pct(v) : rtxt(v))); });
      tb.appendChild(tr);
    }
    tbl.appendChild(tb); box.appendChild(tbl); ts.appendChild(box);
    if(mine.some(function(h){ return !h.m.spread||mtd(h.m); })) ts.appendChild(el("p","pnote","* In progress: spread is month to date, or arrives with Shelley's next report. Ratios are colored against the team for the same month; gray means too few to compare."));
    else ts.appendChild(el("p","pnote","Ratios are colored against the team for the same month; gray means too few to compare."));
    pin.appendChild(ts);

    // deals where they're the AM or the recruiter
    var deals=[];
    keys.forEach(function(k){ (MONTHS[k].deals||[]).forEach(function(d){ if(d.ae===name||d.recruiter===name) deals.push(d); }); });
    deals.sort(function(a,b){ return a.added<b.added? 1 : a.added>b.added? -1 : 0; });
    var ds=el("section","psec"); var dh=el("h3",null,"Deals"); dh.appendChild(el("span","hint",deals.length+" placement"+(deals.length===1?"":"s"))); ds.appendChild(dh);
    var dbox=el("div","tablebox ptable pdeals"), dt=el("table","num"), dth=el("thead"), dhr=el("tr");
    ["Added","Candidate","Client","Role","Status"].forEach(function(s){ dhr.appendChild(el("th",null,s)); });
    dth.appendChild(dhr); dt.appendChild(dth);
    var dtb=el("tbody");
    deals.forEach(function(d){
      var tr=el("tr"), role= d.ae===name&&d.recruiter===name? "AM + recruiter" : d.ae===name? "AM" : "Recruiter";
      [dateLabel(d.added),d.candidate,d.client||"—",role].forEach(function(s){ tr.appendChild(el("td",null,s)); });
      var sd=el("td"), cls= d.status==="Never Started"?"no": (d.status==="Approved"||d.status==="Completed")?"ok":"mid"; sd.appendChild(el("span","pill "+cls,d.status)); tr.appendChild(sd);
      if(d.title) tr.title=d.title;
      dtb.appendChild(tr);
    });
    if(!deals.length){ var etr=el("tr"), etd=el("td",null,"No placements in these months."); etd.colSpan=5; etr.appendChild(etd); dtb.appendChild(etr); }
    dt.appendChild(dtb); dbox.appendChild(dt); ds.appendChild(dbox); pin.appendChild(ds);

    dlg.appendChild(pin);
    opener=from||null;
    dlg.showModal();
    dlg.scrollTop=0;
  }

  function personChart(hist,full){
    var W=560, H=150, pad=10, top=24, base=H-26;
    var max=0; hist.forEach(function(h){ if(h.m.spread&&h.r&&h.r.spread>max) max=h.r.spread; });
    var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.setAttribute("class","chart pchart"); svg.setAttribute("role","img");
    svg.setAttribute("aria-label","Monthly spread for "+full+": "+hist.map(function(h){ return h.m.short+" "+(!h.m.spread?"pending":h.r&&h.r.spread!=null? money(h.r.spread):"none"); }).join(", "));
    var slot=(W-pad*2)/hist.length, bw=Math.min(34,slot*0.6);
    function T(x,y,s,cls){ var t=document.createElementNS(svg.namespaceURI,"text"); t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("text-anchor","middle"); if(cls) t.setAttribute("class",cls); t.textContent=s; return t; }
    function R(x,y,w,h,cls){ var r=document.createElementNS(svg.namespaceURI,"rect"); r.setAttribute("x",x); r.setAttribute("y",y); r.setAttribute("width",w); r.setAttribute("height",h); r.setAttribute("rx",2); r.setAttribute("class",cls); return r; }
    var axis=document.createElementNS(svg.namespaceURI,"line"); axis.setAttribute("x1",pad); axis.setAttribute("x2",W-pad); axis.setAttribute("y1",base); axis.setAttribute("y2",base); axis.setAttribute("stroke","currentColor"); axis.setAttribute("stroke-opacity","0.18"); svg.appendChild(axis);
    hist.forEach(function(h,i){
      var cx=pad+slot*i+slot/2, on=isOn(h.k), v=h.r? h.r.spread : null;
      if(h.m.spread && v!=null){
        var hh= max>0&&v>0? Math.max(2,(base-top)*v/max) : 0;
        if(hh) svg.appendChild(R(cx-bw/2,base-hh,bw,hh,"bar"+(on?" on":"")));
        svg.appendChild(T(cx,base-hh-6,v<1000? money(Math.max(v,0)) : moneyK(v),"v"));
      } else if(!h.m.spread && h.r){
        svg.appendChild(T(cx,base-8,"pending"));
      }
      svg.appendChild(T(cx,H-8,h.m.short,on?"v":null));
    });
    return svg;
  }

  // URL state: #recruiting&m=2026-09&sort=submittals:desc&q=smith&former=1 (plain #sales / #recruiting still work)
  function readHash(){
    var p=new URLSearchParams(location.hash.slice(1));
    SIDES.forEach(function(sd){ if(p.has(sd)) state.side=sd; });
    if(p.get("m")) state.month=p.get("m");
    var so=(p.get("sort")||"").split(":");
    if(COLS[state.side]) state.sort[state.side]= so[0] && COLS[state.side].some(function(c){ return c.k===so[0]; })? [so[0],so[1]==="asc"?"asc":"desc"] : ["spread","desc"];
    state.q=p.get("q")||""; state.former=p.get("former")==="1";
    $("q").value=state.q; $("former").checked=state.former;
  }
  function writeHash(){
    var p=new URLSearchParams(); if(COLS[state.side]||state.side==="primes") p.set("m",state.month);
    var so=state.sort[state.side]; if(so && (so[0]!=="spread"||so[1]!=="desc")) p.set("sort",so[0]+":"+so[1]);
    if(state.q.trim()) p.set("q",state.q.trim());
    if(state.former && COLS[state.side]) p.set("former","1");
    var h="#"+state.side+"&"+p.toString().replace(/%3A/gi,":");
    if(location.hash!==h) history.replaceState(null,"",h);
  }
  readHash();
  window.addEventListener("hashchange",function(){ readHash(); if(monthKeys().length){ buildMonthSelect(); animate("month"); render(); } });

  // controls
  SIDES.map(function(sd){ return "tab-"+sd; }).forEach(function(id){ $(id).addEventListener("click",function(){ state.side=$(id).getAttribute("data-side"); try{localStorage.setItem("ss-side",state.side);}catch(e){} animate("month"); render(); }); });
  $("month").addEventListener("change",function(){ state.month=this.value; animate("month"); render(); });
  $("q").addEventListener("input",function(){ state.q=this.value; render(); });
  $("former").addEventListener("change",function(){ state.former=this.checked; render(); });
  $("print").addEventListener("click",function(){ window.print(); });

  // theme: System follows the OS; Light/Dark set data-theme (index.html applies the saved choice before first paint)
  function showTheme(){
    var t=document.documentElement.getAttribute("data-theme")||"system";
    [].forEach.call(document.querySelectorAll("[data-theme-set]"),function(b){ b.setAttribute("aria-pressed",String(b.getAttribute("data-theme-set")===t)); });
  }
  [].forEach.call(document.querySelectorAll("[data-theme-set]"),function(b){
    b.addEventListener("click",function(){
      var t=b.getAttribute("data-theme-set"), fixed=t==="light"||t==="dark";
      if(fixed) document.documentElement.setAttribute("data-theme",t); else document.documentElement.removeAttribute("data-theme");
      try{ if(fixed) localStorage.setItem("ss-theme",t); else localStorage.removeItem("ss-theme"); }catch(e){}
      showTheme();
    });
  });
  showTheme();

  // print with every section expanded, then put the sections back the way they were
  var printOpen=null;
  window.addEventListener("beforeprint",function(){
    printOpen=[].map.call(document.querySelectorAll("#body details"),function(d){ return [d,d.open]; });
    printOpen.forEach(function(p){ p[0].open=true; });
  });
  window.addEventListener("afterprint",function(){
    if(printOpen) printOpen.forEach(function(p){ p[0].open=p[1]; });
    printOpen=null;
  });

  function setStatus(live,text){ var s=$("status"); s.classList.toggle("live",!!live); $("statusText").textContent=text; }
  function showProblem(title,msg){ var b=$("body"); b.textContent=""; var e=el("div","empty"); e.appendChild(el("strong",null,title)); e.appendChild(document.createTextNode(msg)); b.appendChild(e); }

  function ingest(snap){
    MONTHS={}; NAMES={};
    snap.docs.forEach(function(d){ var v=d.data(); if(v&&v.key){
      ["sales","recruiting"].forEach(function(s){ (v[s]||[]).forEach(function(r){ NAMES[r.name]=r.full; }); }); // names first, so their deals still read in full
      ["sales","recruiting"].forEach(function(s){ if(v[s]) v[s]=v[s].filter(function(r){ return !EXCLUDED[r.name]; }); });
      weekly(v);
      MONTHS[v.key]=v; } });
    if(!monthKeys().length){ setStatus(false,"No report data yet"); showProblem("No report data yet","Upload the Weekly Spread Dashboard in the admin panel, and the Bullhorn sync fills in the activity."); return; }
    buildPeriods(); buildMonthSelect(); render();
  }
  function updatedText(){
    if(!META||!META.generated) return "Live data";
    var p=META.generated.split("T"); var d=p[0].split("-"); var t=(p[1]||"00:00").split(":");
    var dt=new Date(+d[0],+d[1]-1,+d[2],+t[0],+t[1]);
    return "Data as of "+dt.toLocaleDateString("en-US",{month:"short",day:"numeric"})+", "+dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
  }

  // Local build: data ships as JSON files in public/data (see README).
  function loadLocal(after){
    var base="data/";
    fetch(base+"index.json",{cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error("index"); return r.json(); }).then(function(idx){
      return Promise.all([
        fetch(base+"meta.json",{cache:"no-store"}).then(function(r){ return r.ok? r.json() : null; }),
        Promise.all(idx.months.map(function(k){ return fetch(base+"months/"+k+".json",{cache:"no-store"}).then(function(r){ return r.json(); }); })),
        // weekly uploads from the admin page; absent when the site runs without its Netlify functions
        fetch("/api/data",{cache:"no-store"}).then(function(r){ return r.ok? r.json() : null; }).catch(function(){ return null; })
      ]);
    }).then(function(res){
      var docs=res[1], live=res[2];
      if(live && live.months && live.months.length){
        var byKey={}; docs.concat(live.months).forEach(function(d){ byKey[d.key]=d; });
        docs=Object.keys(byKey).map(function(k){ return byKey[k]; });
      }
      META=(live && live.meta) || res[0];
      TARGETS=(live && live.targets) || null;
      REPORT=(live && live.report) || null; REPORT_WEEKS=(live && live.reportWeeks) || [];
      PRIMES=(live && live.primes) || null; RECONTACT=(live && live.recontact) || null; FORECAST=(live && live.forecast) || null;
      ingest({docs:docs.map(function(d){ return {data:function(){ return d; }}; })});
      if(monthKeys().length) setStatus(true,updatedText());
      checkBanner();
      checkNewStatus();
      if(after) after();
    }).catch(function(){
      setStatus(false,"Data unavailable");
      showProblem("Couldn't load the report data","Run the app with npm run dev from the project folder, and check that public/data/index.json exists.");
    });
  }
  loadLocal(function(){ if(/[?&]admin\b/.test(location.search)) openAdminPanel(); });

  // Banner under controls: shown when spreadWeekEnding is > 9 days older than bullhornAsOf (or today)
  function checkBanner(){
    var b=$("banner"); if(!b) return;
    if(!META || !META.spreadWeekEnding){ b.hidden=true; b.textContent=""; return; }
    var asOf = META.bullhornAsOf ? dayNum(META.bullhornAsOf) : Math.floor(Date.now() / 864e5);
    var spDay = dayNum(META.spreadWeekEnding);
    var daysOld = asOf - spDay;
    if(daysOld <= 9){ b.hidden=true; b.textContent=""; return; }

    var versionKey = META.spreadWeekEnding + "_" + (META.generated || "");
    try {
      if(localStorage.getItem("ss-dismissed-banner") === versionKey){ b.hidden=true; b.textContent=""; return; }
    } catch(e){}

    b.textContent="";
    var msg = el("span", "banner-msg", "Spread is through " + dateLabel(META.spreadWeekEnding) + " — this week's report hasn't been uploaded yet.");
    b.appendChild(msg);

    if(adminSession()){
      var up = el("button", "banner-action", "Upload now");
      up.type = "button";
      up.addEventListener("click", openAdminPanel);
      b.appendChild(up);
    }

    var closeBtn = el("button", "banner-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss banner");
    closeBtn.title = "Dismiss";
    closeBtn.addEventListener("click", function(){
      try { localStorage.setItem("ss-dismissed-banner", versionKey); } catch(e){}
      b.hidden = true;
      b.textContent = "";
    });
    b.appendChild(closeBtn);
    b.hidden = false;
  }

  // Small "New" dot on status pill when META.generated is newer than viewer's last visit
  function checkNewStatus(){
    if(!META || !META.generated) return;
    var lastGen = null;
    try { lastGen = localStorage.getItem("ss-last-gen"); } catch(e){}
    var statusEl = $("status");
    var existingDot = $("statusNew");

    if(!lastGen){
      // First visit: record current generated version
      try { localStorage.setItem("ss-last-gen", META.generated); } catch(e){}
      if(existingDot) existingDot.remove();
      return;
    }

    if(META.generated > lastGen){
      if(!existingDot){
        existingDot = el("span", "new-dot", "New");
        existingDot.id = "statusNew";
        existingDot.title = "New data since your last visit (click to dismiss)";
        existingDot.setAttribute("aria-label", "New data since your last visit");
        statusEl.appendChild(existingDot);
        statusEl.classList.add("has-new");
      }

      function markSeen(){
        var dot = $("statusNew");
        if(dot) dot.remove();
        statusEl.classList.remove("has-new");
        try { localStorage.setItem("ss-last-gen", META.generated); } catch(e){}
      }

      existingDot.onclick = function(e){
        e.stopPropagation();
        markSeen();
      };
      statusEl.onclick = function(){
        markSeen();
      };

      window.addEventListener("beforeunload", markSeen, { once: true });
    } else {
      if(existingDot) existingDot.remove();
      statusEl.classList.remove("has-new");
    }
  }

  // Admin: a small sign-in button in the corner. The upload panel and its Excel reader load only when opened.
  function adminSession(){ try{ var a=JSON.parse(sessionStorage.getItem("ss-admin")); return a && a.exp*1000>Date.now()? a : null; }catch(e){ return null; } }
  function showAdminButton(){
    var a=adminSession(), b=$("adminBtn");
    b.classList.toggle("in",!!a);
    b.querySelector(".lbl").textContent= a? "Upload" : "Admin login";
    b.setAttribute("aria-label", a? "Open the weekly spread upload (signed in as "+a.user+")" : "Admin sign-in");
    checkBanner();
  }
  function openAdminPanel(){
    var b=$("adminBtn"); b.disabled=true;
    import("./admin-panel.js").then(function(m){
      b.disabled=false;
      m.openAdmin({
        opener:b,
        onSession:function(s){ showAdminButton(); checkBanner(); },
        onChange:function(){ loadLocal(); }, // an upload or undo: reload the scorecard behind the panel
        onView:function(key){ state.month=key; buildMonthSelect(); animate("month"); render(); window.scrollTo(0,0); }
      });
    }).catch(function(){ b.disabled=false; setStatus(false,"Couldn't open the admin panel"); });
  }
  $("adminBtn").addEventListener("click",openAdminPanel);
  showAdminButton();
})();
