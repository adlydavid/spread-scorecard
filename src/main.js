(function(){
  "use strict";
  var state={side:"sales",month:null,q:"",former:false,sort:{sales:["spread","desc"],recruiting:["spread","desc"]}};
  var MONTHS={}, META=null, TARGETS=null;
  var PERIODS={};
  try{var s=localStorage.getItem("ss-side"); if(s==="sales"||s==="recruiting") state.side=s;}catch(e){}
  // People table view: hidden column keys per side ("trend" and "tcol" for the extra columns), and row density.
  // Name and Spread always show; the Team total row isn't a column, so it always shows too.
  var HIDDEN={sales:[],recruiting:[]}, LOCKED={full:1,spread:1}, compact=false, colsOpen=false;
  try{ var hc=JSON.parse(localStorage.getItem("ss-cols")); if(hc) ["sales","recruiting"].forEach(function(sd){ if(Array.isArray(hc[sd])) HIDDEN[sd]=hc[sd]; }); }catch(e){}
  try{ compact=localStorage.getItem("ss-density")==="compact"; }catch(e){}
  function shown(side,k){ return !!LOCKED[k] || HIDDEN[side].indexOf(k)<0; }

  var $=function(id){return document.getElementById(id)};
  var fmt=new Intl.NumberFormat("en-US");
  function money(v){ if(v==null) return "—"; return "$"+fmt.format(Math.round(v)); }
  function moneyK(v){ if(v==null) return "—"; if(Math.abs(v)>=1e6) return "$"+(v/1e6).toFixed(2)+"M"; return "$"+Math.round(v/1000)+"k"; }
  function n(v){ return v==null? "—" : fmt.format(v); }
  function ratio(a,b){ if(!b) return null; return a/b; }
  function rtxt(r){ return r==null? "—" : (r>=10? Math.round(r) : r.toFixed(1))+" : 1"; }
  function pct(r){ return r==null? "—" : Math.round(r*100)+"%"; }
  function dateLabel(s){ var p=s.split("-"); var d=new Date(+p[0],+p[1]-1,+p[2]); return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
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
      {k:"spread",l:"Spread",t:"spread",grp:"Results"},
      {k:"calls",l:"Calls",t:"n",grp:"Activity"},
      {k:"visits",l:"Client visits",t:"n",grp:"Activity"},
      {k:"jobOrders",l:"Job orders",t:"n",grp:"Activity"},
      {k:"sendOuts",l:"Send outs",t:"n",grp:"Pipeline"},
      {k:"interviews",l:"Interviews",t:"n",grp:"Pipeline"},
      {k:"deals",l:"Deals",t:"n",grp:"Pipeline"},
      {k:"starts",l:"Starts",t:"n",grp:"Pipeline"},
      {k:"soDeal",l:"Send out : deal",t:"ratio",a:"sendOuts",b:"deals",grp:"Ratios"},
      {k:"cvDeal",l:"Visit : deal",t:"ratio",a:"visits",b:"deals",grp:"Ratios"},
      {k:"fill",l:"Fill %",t:"pct",a:"deals",b:"jobOrders",grp:"Ratios"}
    ],
    recruiting:[
      {k:"full",l:"Recruiter",t:"name"},
      {k:"spread",l:"Spread",t:"spread",grp:"Results"},
      {k:"calls",l:"Calls",t:"n",grp:"Activity"},
      {k:"submittals",l:"Submittals",t:"n",grp:"Pipeline"},
      {k:"interviews",l:"Interviews",t:"n",grp:"Pipeline"},
      {k:"placements",l:"Placements",t:"n",grp:"Pipeline"},
      {k:"subDeal",l:"Submittal : deal",t:"ratio",a:"submittals",b:"placements",grp:"Ratios"},
      {k:"intDeal",l:"Interview : deal",t:"ratio",a:"interviews",b:"placements",grp:"Ratios"}
    ]
  };

  var CARD_COLS={
    sales:["calls","visits","sendOuts","deals","soDeal","fill"],
    recruiting:["calls","submittals","interviews","placements","subDeal","intDeal"]
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
      if(t && t.v>0) cards.push({lab: mtd(m)? "Top spread so far" : "Top spread", r:t.r, val:money(t.v), note:share(t.v,team.spread)});
    }
    if(prev){
      var was={}; (prev[side]||[]).forEach(function(r){ was[r.name]=r.spread; });
      var g=best(function(r){ return r.spread==null||was[r.name]==null? null : r.spread-was[r.name]; });
      if(g && g.v>=1) cards.push({lab:"Biggest gain vs "+prev.short, r:g.r, val:"+"+money(g.v), note:money(was[g.r.name])+" → "+money(g.r.spread)});
    }
    var rc=COLS[side].filter(function(c){ return c.k===(side==="sales"? "soDeal" : "subDeal"); })[0];
    var b=best(function(r){ var v=computed(r,rc); return v==null? null : -v; }, function(r){ return (r[rc.b]||0)>=MIN_SAMPLE.ratio && (r[rc.a]||0)>0; });
    if(b) cards.push({lab:"Best "+rc.l.toLowerCase(), r:b.r, val:rtxt(-b.v), note:b.r[rc.b]+" "+deal+" · team "+rtxt(computed(team,rc))});
    var ak= side==="sales"? "sendOuts" : "calls";
    var a=best(function(r){ return r[ak]; });
    if(a && a.v>0) cards.push({lab:"Most "+(side==="sales"? "send outs" : "calls"), r:a.r, val:n(a.v), note:share(a.v,team[ak])});
    return cards;
  }

  // Monthly spread targets from the admin panel: versions that apply from a payroll month onward.
  // Amounts are per 4-week month; with scale5 a 5-week month's target is weeks/4 times larger.
  function monthTarget(mm,side,name){
    var v=null; ((TARGETS && TARGETS.versions) || []).forEach(function(x){ if(x.from<=mm.key) v=x; });
    if(!v) return null;
    var amt= name? (v.people && v.people[side] || {})[name] : v.team;
    if(amt==null) return null;
    return v.scale5? amt*mm.weeks/4 : amt;
  }
  // target for the selected month, or for a period the months in it that have spread
  function targetFor(m,side,name){
    if(!m.range) return monthTarget(m,side,name);
    var sum=0, any=false;
    m.spreadMonths.forEach(function(mm){ var t=monthTarget(mm,side,name); if(t!=null){ sum+=t; any=true; } });
    return any? sum : null;
  }
  // share of target, and for a month-to-date month the share on pace for by month end
  function targetShare(m,spread,t){
    if(!t || spread==null) return null;
    var share=spread/t, done= mtd(m)? m.spreadWeeks[0]/m.spreadWeeks[1] : 1;
    return {share:share, pace:share/done, done:done};
  }
  function targetGrade(ts){ var x=ts.pace; return x>=1? "good" : x>=0.75? "warn" : "bad"; }

  // Spread trend for the people table: up to 6 months with spread, ending at the selected month
  // (or the last month of a period). Month-to-date months are drawn dashed.
  function trendKeys(m){
    var end= m.range? m.months[m.months.length-1] : m.key;
    return monthKeys().filter(function(k){ return k<=end && MONTHS[k].spread; }).slice(-6);
  }
  function sparkline(vals,on,who){
    var W=64, H=18, p=2.5, max=0, NS="http://www.w3.org/2000/svg";
    vals.forEach(function(x){ if(x.v>max) max=x.v; });
    var svg=document.createElementNS(NS,"svg");
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.setAttribute("width",W); svg.setAttribute("height",H); svg.setAttribute("class","spark"); svg.setAttribute("role","img");
    var label=who+" spread: "+vals.map(function(x){ return x.short+" "+money(x.v)+(x.part?" (month to date)":""); }).join(", ");
    svg.setAttribute("aria-label",label);
    var t=document.createElementNS(NS,"title"); t.textContent=label; svg.appendChild(t);
    function X(i){ return p+(W-2*p)*i/(vals.length-1); }
    function Y(v){ return H-p-(H-2*p)*(max>0? Math.max(v,0)/max : 0); }
    for(var i=1;i<vals.length;i++){
      var l=document.createElementNS(NS,"line");
      l.setAttribute("x1",X(i-1)); l.setAttribute("y1",Y(vals[i-1].v)); l.setAttribute("x2",X(i)); l.setAttribute("y2",Y(vals[i].v));
      l.setAttribute("class","sl"+(vals[i].part?" part":"")); svg.appendChild(l);
    }
    vals.forEach(function(x,i){
      if(x.k!==on) return;
      var c=document.createElementNS(NS,"circle"); c.setAttribute("cx",X(i)); c.setAttribute("cy",Y(x.v)); c.setAttribute("r",2.25); c.setAttribute("class","sd"); svg.appendChild(c);
    });
    return svg;
  }

  // Smallest denominator worth coloring: deals/placements for the per-deal ratios, job orders for Fill %.
  var MIN_SAMPLE={ratio:2,pct:3};
  // Class and tooltip for one person's ratio cell: graded against the team, or why it isn't.
  function gradeCell(c,r,v,team,per){
    var den=r[c.b]||0, show= c.t==="pct"? pct : rtxt;
    var unit= c.t==="pct"? "job orders" : c.b==="placements"? "placements" : "deals";
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
  // spread from a mid-month report ("Week 2 of 5") rather than the month's final numbers
  function mtd(m){ return !!(m && m.spread && m.spreadWeeks && m.spreadWeeks[0]<m.spreadWeeks[1]); }
  function spreadPace(m){ var w=m.spreadWeeks[0], t=m.spreadWeeks[1]; return {txt:"on pace for "+moneyK(m.gp/w*t), cls:"pace", title:money(m.gp)+" in the first "+w+" of "+t+" payroll weeks"}; }
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
  // Projects a partial-month figure to the full payroll month from data as of asOf.
  function pace(v,m,asOf,isMoney){
    if(v==null||!asOf) return null;
    var s=dayNum(m.start), e=dayNum(m.end), a=Math.min(dayNum(asOf),e);
    if(a<s||a>=e) return null;
    var wk=(a-s+1)/7, p=v/wk*m.weeks, f=isMoney? moneyK : function(x){ return n(Math.round(x)); };
    return {txt:"on pace for "+f(p), cls:"pace", title:(isMoney?money(v):n(v))+" in the first "+(Math.round(wk*10)/10)+" of "+m.weeks+" payroll weeks, as of "+dateLabel(asOf)};
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
      if(spm.length){ p.gp=0; p.revenue=0; spm.forEach(function(m){ p.gp+=m.gp||0; p.revenue+=m.revenue||0; }); }
      ["sales","recruiting"].forEach(function(side){
        var by={}, order=[];
        ms.forEach(function(m){ (m[side]||[]).forEach(function(r){
          var t=by[r.name]; if(!t){ t=by[r.name]={spread:null}; order.push(r.name); }
          Object.keys(r).forEach(function(f){
            var v=r[f];
            if(f==="spread"){ if(m.spread&&v!=null) t.spread=(t.spread||0)+v; }
            else if(v==null){ if(!(f in t)) t[f]=null; }
            else if(typeof v==="number") t[f]=(t[f]||0)+v;
            else t[f]=v; // name, full, former, ae: latest month wins
          });
        }); });
        p[side]=order.map(function(nm){ return by[nm]; });
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

  function render(){
    var keys=monthKeys();
    if(!keys.length) return;
    var m=getMonth(state.month); if(!m) return;
    var side=state.side, cols=COLS[side], per=m.range? "this period" : "this month";
    $("tab-sales").setAttribute("aria-selected",side==="sales");
    $("tab-recruiting").setAttribute("aria-selected",side==="recruiting");
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
      if(cmp) return delta(kind,val(team),val(prevTeam),prev.short,m.short);
      if(kind==="count" && (!m.spread||mtd(m)) && !m.range) return pace(val(team),m,META&&META.bullhornAsOf);
      return null;
    }

    // KPI strip
    var k=el("div","kpis");
    function tile(lab,val,note,c,extra){
      var t=el("div","kpi"); t.appendChild(el("div","lab",lab)); t.appendChild(el("div","val num",val)); t.appendChild(el("div","note",note||" "));
      if(c){ var d=el("div","delta num"+(c.cls?" "+c.cls:""),c.txt); if(c.title) d.title=c.title; t.appendChild(d); }
      if(extra) t.appendChild(extra);
      k.appendChild(t);
    }
    var spNote= !m.spread? "Arrives with Shelley's next report" : mtd(m)? "month to date · week "+m.spreadWeeks[0]+" of "+m.spreadWeeks[1] : m.revenue? "on "+moneyK(m.revenue)+" revenue" : "";
    var spChg= cmp? delta("money",m.gp,prev.gp,prev.short,m.short) : m.range? null : mtd(m)? spreadPace(m) : !m.spread? pace(m.gp,m,META&&META.spreadWeekEnding,true) : null;
    // progress toward the team target, with a tick at where a month-to-date month should be by now
    var tgt=targetFor(m,side,null), prog=null;
    if(tgt){
      prog=el("div","tgt");
      var ts=targetShare(m,m.spread? m.gp : null,tgt);
      if(ts){
        var tb=el("div","tbar "+targetGrade(ts)), tf=el("span","tfill");
        tf.style.width=Math.min(100,ts.share*100)+"%"; tb.appendChild(tf);
        if(ts.done<1){ var tm=el("span","tmark"); tm.style.left=(ts.done*100)+"%"; tb.appendChild(tm); }
        var tt=Math.round(ts.share*100)+"% of "+moneyK(tgt)+" target"+(ts.done<1? " · on pace for "+Math.round(ts.pace*100)+"%" : "");
        tb.setAttribute("aria-hidden","true"); // the note below says the same in words
        prog.appendChild(tb); prog.appendChild(el("div","tnote",tt));
      } else prog.appendChild(el("div","tnote","Target "+moneyK(tgt)));
    }
    if(side==="sales"){
      tile("Spread", m.spread? money(m.gp):"Pending", spNote, spChg, prog);
      tile("Send outs", n(team.sendOuts), n(team.jobOrders)+" new job orders", chg("count","sendOuts"));
      tile("Interviews", n(team.interviews), "candidates interviewed", chg("count","interviews"));
      tile("Deals", n(team.deals), n(team.starts)+" starts "+per, chg("count","deals"));
      tile("Send out : deal", rtxt(ratio(team.sendOuts,team.deals)), "visit : deal "+rtxt(ratio(team.visits,team.deals)), chg("ratio",["sendOuts","deals"]));
      tile("Fill %", pct(ratio(team.deals,team.jobOrders)), "deals ÷ job orders", chg("pct",["deals","jobOrders"]));
    } else {
      tile("Spread", m.spread? money(m.gp):"Pending", spNote, spChg, prog);
      tile("Calls", n(team.calls), "logged in Bullhorn", chg("count","calls"));
      tile("Submittals", n(team.submittals), "sent to clients", chg("count","submittals"));
      tile("Interviews", n(team.interviews), "candidates interviewed", chg("count","interviews"));
      tile("Placements", n(team.placements), "deals closed", chg("count","placements"));
      tile("Submittal : deal", rtxt(ratio(team.submittals,team.placements)), "interview : deal "+rtxt(ratio(team.interviews,team.placements)), chg("ratio",["submittals","placements"]));
    }
    body.appendChild(k);

    // highlights: a few people worth noticing first; each card opens that person's history
    var hl=highlights(m,side,all,team,cmp? prev : null);
    if(hl.length){
      var hs=el("section","hl"); hs.setAttribute("aria-label","Highlights");
      hl.forEach(function(x){
        var c=el("button","hlc"); c.type="button";
        c.appendChild(el("span","lab",x.lab)); c.appendChild(el("span","who",x.r.full));
        var v=el("span","hv num",x.val); if(x.note) v.appendChild(el("span","hn",x.note)); c.appendChild(v);
        c.setAttribute("aria-label",x.lab+": "+x.r.full+", "+x.val+(x.note? ", "+x.note : "")+". Open their history.");
        c.addEventListener("click",function(){ openPerson(x.r.name,side,c); });
        hs.appendChild(c);
      });
      body.appendChild(hs);
    }

    // month strip
    var ms=el("section","months");
    var h=el("div","sechead"); h.appendChild(el("h2",null,"Spread by month")); var ch=el("span","hint","Company gross profit"); ch.appendChild(el("span","noprint"," · select a month")); h.appendChild(ch);
    ms.appendChild(h); var cw=el("div","chartbox"); cw.appendChild(monthChart(keys)); ms.appendChild(cw); body.appendChild(ms);

    // people table
    var sec=el("section","people");
    var sh=el("div","sechead");
    sh.appendChild(el("h2",null, side==="sales"?"Account managers":"Recruiters"));
    var shh=el("span","hint", "Sorted by "+sc.l.toLowerCase()+(sk[1]==="desc"?", high to low":", low to high")+" · "+people.length+" people");
    shh.appendChild(el("span","noprint"," · select a name for their history")); sh.appendChild(shh);
    var tgtOf={}, hasTgt=false;
    people.concat([team]).forEach(function(r){ var t=targetFor(m,side,r.name==="_total"? null : r.name); if(t){ tgtOf[r.name]=t; if(r.name!=="_total") hasTgt=true; } });
    var vcols=cols.filter(function(c){ return shown(side,c.k); });
    var showTrend=shown(side,"trend"), showTgt=hasTgt && shown(side,"tcol");
    var tools=el("div","ptools");
    tools.appendChild(densityToggle());
    tools.appendChild(columnChooser(side,cols,hasTgt));
    // exports the table as shown: same columns, rows, order and team total; ratios as numbers, Fill % as a percent
    tools.appendChild(csvButton("Download CSV",function(){
      var rows=[[vcols[0].l,"Former"].concat(vcols.slice(1).map(function(c){ return c.l; }), showTgt? ["% of target"] : [])];
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
        rows.push(row);
      });
      downloadCSV("spread-scorecard_"+side+"_"+state.month+".csv",rows);
    }));
    sh.appendChild(tools);
    sec.appendChild(sh);
    var box=el("div","tablebox sticky people-table"+(compact?" compact":"")); var tbl=el("table","num");
    var thead=el("thead");
    var gr=el("tr"); var groups=[]; vcols.forEach(function(c){ var g=c.grp||""; if(groups.length&&groups[groups.length-1].g===g) groups[groups.length-1].n++; else groups.push({g:g,n:1}); });
    // Name and Results (Spread) are always the first two groups; Trend and % of target follow them
    if(showTrend) groups.splice(2,0,{g:"",n:1,cls:"trend"});
    if(showTgt) groups.splice(showTrend?3:2,0,{g:"",n:1,cls:"tcol"});
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
        if(showTrend){ var tt=el("th","trend","Trend"); tt.title="Spread over the last 6 months with spread"; hr.appendChild(tt); }
        if(showTgt){ var tc=el("th","tcol","% of target"); tc.title="Spread compared with each person's monthly target"; hr.appendChild(tc); }
      }
    });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb=el("tbody");
    var maxSp=0; people.forEach(function(r){ if(r.spread>maxSp) maxSp=r.spread; });
    var teamVals={}; cols.forEach(function(c){ if(c.t==="ratio"||c.t==="pct") teamVals[c.k]=computed(team,c); });
    var tk=trendKeys(m), trendBy={};
    tk.forEach(function(k){
      var mm=MONTHS[k], byName={}, tot=0;
      (mm[side]||[]).forEach(function(r){ if(r.spread!=null){ byName[r.name]=r.spread; tot+=r.spread; } });
      byName._total=tot; trendBy[k]={m:mm,v:byName};
    });
    function trendCell(r){
      var td=el("td","trend");
      if(r.name==="_other" || tk.length<2) return td;
      var vals=tk.map(function(k){ var t=trendBy[k]; return {k:k,short:t.m.short,v:t.v[r.name]||0,part:mtd(t.m)}; });
      if(vals.every(function(x){ return !x.v; })) return td;
      td.appendChild(sparkline(vals, m.range? null : state.month, r.name==="_total"? "Team" : r.full));
      return td;
    }
    function targetCell(r){
      var td=el("td","tcol r"), ts=targetShare(m, m.spread? r.spread : null, tgtOf[r.name]);
      if(!tgtOf[r.name]){ td.textContent="—"; td.className+=" zero"; td.title="No target set"; return td; }
      if(!ts){ td.textContent="—"; td.className+=" zero"; td.title="Target "+money(tgtOf[r.name])+"; spread pending"; return td; }
      td.textContent=Math.round(ts.share*100)+"%";
      if(r.name!=="_total") td.className+=" "+targetGrade(ts);
      td.title=money(r.spread)+" of "+money(tgtOf[r.name])+" target"+(ts.done<1? " · on pace for "+Math.round(ts.pace*100)+"%" : "");
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
      var tr=el("tr",cls||null);
      vcols.forEach(function(c){
        var td=el("td"); var v=computed(r,c);
        if(c.t==="name"){
          if(r.name==="_total"||r.name==="_other") td.textContent=r.full;
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
          if(showTrend){ tr.appendChild(td); td=trendCell(r); }
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
    writeHash();
  }
  var openDeals=false, openDefs=false;

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
      if(c.t==="spread"){ opts.push({k:"trend",l:"Trend"}); if(hasTgt) opts.push({k:"tcol",l:"% of target"}); }
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
    ["Spread","Gross profit from Shelley's Weekly Spread Dashboard, credited to the account manager (A/E) and recruiter (R/M) on each consultant. Team spread matches the report's monthly total."],
    ["Month","The report's payroll month: Sunday to Saturday weeks, grouped by the Saturday the week ends on. Bullhorn activity uses the same dates."],
    ["Calls","Bullhorn notes logged as Call, MOAT Call, Recontact Call, Job or Req Qualification Call, Video Call, or Business Conversation."],
    ["Client visits","New, Existing and In-Person Meetings logged against a client contact, all combined."],
    ["Job orders","New job orders by owner. MIT Lincoln Laboratory reqs loaded by the web import are credited to Hannah Wilkinson, the MIT account manager."],
    ["Send outs","Candidates submitted to clients against the account manager's job orders."],
    ["Submittals","The same submissions, credited to the recruiter who sent them."],
    ["Interviews","Candidates with an Interview, Interview Prep or Interview Debrief note, counted once per candidate per week and credited to the job's account manager and the submitting recruiter."],
    ["Deals / Placements","Placements created in Bullhorn during the month, including ones that later never started."],
    ["Starts","Placements whose start date falls in the month, excluding Never Started."],
    ["Ratios","Send out : deal, Visit : deal, Submittal : deal and Interview : deal show activity per deal. Fill % is deals divided by job orders."]
  ];

  // Company spread by month: bars with a dashed average line, and margin % in its own band above
  // (margin moves within a few points, so it gets a min–max scale rather than sharing the bars' $ axis).
  function margin(m){ return m.spread&&m.revenue? m.gp/m.revenue : null; }
  function pct1(v){ return (v*100).toFixed(1)+"%"; }
  function monthChart(keys){
    var padL=22, padR=78, W=Math.max(keys.length*86,600)+padR-padL, H=150;
    var mTop=18, mBot=42, top=66, base=H-24;
    var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.setAttribute("class","chart"); svg.setAttribute("role","group"); svg.setAttribute("aria-label","Company spread and margin by month");
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
    function cx(i){ return padL+slot*i+slot/2; }

    E("line",{x1:padL,x2:W-padR,y1:base,y2:base,stroke:"currentColor","stroke-opacity":"0.18"});
    // average line sits behind the bars; value labels are haloed so it breaks around them
    var ay= avg!=null && max>0? base-(base-top)*avg/max : null;
    if(ay!=null) E("line",{x1:padL,x2:W-padR+6,y1:ay,y2:ay,"class":"avg"});
    // target: a short line over each month that has one (5-week months can be higher), also behind the bars
    var lastTy=null;
    keys.forEach(function(k,i){
      if(!tg[k]) return;
      var ty=base-(base-top)*tg[k]/max; lastTy=ty;
      E("line",{x1:cx(i)-slot*0.38,x2:cx(i)+slot*0.38,y1:ty,y2:ty,"class":"tline"});
    });
    keys.forEach(function(k,i){
      var m=MONTHS[k], x=cx(i), on=isOn(k), mg=margin(m);
      var g=E("g",{"class":"m",tabindex:"0",role:"button","data-k":k});
      g.setAttribute("aria-label",m.label+": "+(m.spread? "spread "+money(m.gp)+(m.revenue? ", revenue "+money(m.revenue)+", margin "+pct1(mg) : "")+", "+m.weeks+" payroll weeks, "+money(m.gp/m.weeks)+" per week" : "spread pending, "+m.weeks+" payroll weeks"));
      E("rect",{x:x-slot/2+3,y:mTop-12,width:slot-6,height:base-mTop+12,rx:4,"class":"hit"},g);
      var anchor;
      if(m.spread && max>0){
        var h=Math.max(2,(base-top)*m.gp/max);
        anchor=E("rect",{x:x-bw/2,y:base-h,width:bw,height:h,rx:2,"class":"bar"+(on?" on":"")+(mtd(m)?" part":"")},g);
        T(x,base-h-6,moneyK(m.gp)+(mtd(m)?" MTD":""),"v",null,g);
      } else {
        var hh=(base-top)*0.35;
        anchor=E("rect",{x:x-bw/2,y:base-hh,width:bw,height:hh,rx:2,"class":"pend"},g);
        T(x,base-hh-6,"pending","v",null,g);
      }
      T(x,H-6,m.short,on?"v":null,null,g);
      function pick(){ state.month=k; $("month").value=k; render(); }
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
    var rows= mtd(m)? [["Spread so far",money(m.gp)],["Report","week "+m.spreadWeeks[0]+" of "+m.spreadWeeks[1]],["Revenue",m.revenue? money(m.revenue):"—"],["Margin",m.revenue? pct1(margin(m)):"—"],["Spread / week",money(m.gp/m.spreadWeeks[0])],["On pace for",moneyK(m.gp/m.spreadWeeks[0]*m.spreadWeeks[1])]]
            : m.spread? [["Spread",money(m.gp)],["Revenue",m.revenue? money(m.revenue):"—"],["Margin",m.revenue? pct1(margin(m)):"—"],["Payroll weeks",String(m.weeks)],["Spread / week",money(m.gp/m.weeks)]]
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
    sales:["spread","calls","visits","sendOuts","interviews","deals","soDeal"],
    recruiting:["spread","calls","submittals","interviews","placements","subDeal","intDeal"]
  };
  var dlg=null, opener=null;
  function openPerson(name,side,from){
    if(!dlg){
      dlg=el("dialog","drawer"); dlg.setAttribute("aria-labelledby","pTitle");
      dlg.addEventListener("click",function(e){ if(e.target===dlg) dlg.close(); });
      dlg.addEventListener("close",function(){ if(opener&&opener.isConnected) opener.focus(); });
      document.body.appendChild(dlg);
    }
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
    sp.forEach(function(h){ var v=h.r.spread||0; tot+=v; if(!best||v>(best.r.spread||0)) best=h; });
    mine.forEach(function(h){ dl+=h.r[dealKey]||0; });
    var st=el("div","pstats");
    function stat(lab,val,note){ var t=el("div","pstat"); t.appendChild(el("div","lab",lab)); t.appendChild(el("div","val num",val)); t.appendChild(el("div","note",note)); st.appendChild(t); }
    stat("Spread", sp.length? money(tot) : "—", sp.length? sp[0].m.short+"–"+sp[sp.length-1].m.short : "No spread yet");
    stat("Monthly average", sp.length? money(tot/sp.length) : "—", best? "best: "+best.m.short+" "+moneyK(best.r.spread||0) : " ");
    stat(side==="sales"?"Deals":"Placements", n(dl), "across "+mine.length+" month"+(mine.length===1?"":"s"));
    pin.appendChild(st);

    var cs=el("section","psec"); cs.appendChild(el("h3",null,"Spread by month"));
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
        var ph=(base-top)*0.3; svg.appendChild(R(cx-bw/2,base-ph,bw,ph,"pend"));
        svg.appendChild(T(cx,base-ph-6,"pending"));
      }
      svg.appendChild(T(cx,H-8,h.m.short,on?"v":null));
    });
    return svg;
  }

  // URL state: #recruiting&m=2026-09&sort=calls:desc&q=smith&former=1 (plain #sales / #recruiting still work)
  function readHash(){
    var p=new URLSearchParams(location.hash.slice(1));
    if(p.has("recruiting")) state.side="recruiting"; else if(p.has("sales")) state.side="sales";
    if(p.get("m")) state.month=p.get("m");
    var so=(p.get("sort")||"").split(":");
    state.sort[state.side]= so[0] && COLS[state.side].some(function(c){ return c.k===so[0]; })? [so[0],so[1]==="asc"?"asc":"desc"] : ["spread","desc"];
    state.q=p.get("q")||""; state.former=p.get("former")==="1";
    $("q").value=state.q; $("former").checked=state.former;
  }
  function writeHash(){
    var p=new URLSearchParams(); p.set("m",state.month);
    var so=state.sort[state.side]; if(so[0]!=="spread"||so[1]!=="desc") p.set("sort",so[0]+":"+so[1]);
    if(state.q.trim()) p.set("q",state.q.trim());
    if(state.former) p.set("former","1");
    var h="#"+state.side+"&"+p.toString().replace(/%3A/gi,":");
    if(location.hash!==h) history.replaceState(null,"",h);
  }
  readHash();
  window.addEventListener("hashchange",function(){ readHash(); if(monthKeys().length){ buildMonthSelect(); render(); } });

  // controls
  ["tab-sales","tab-recruiting"].forEach(function(id){ $(id).addEventListener("click",function(){ state.side=$(id).getAttribute("data-side"); try{localStorage.setItem("ss-side",state.side);}catch(e){} render(); }); });
  $("month").addEventListener("change",function(){ state.month=this.value; render(); });
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
    snap.docs.forEach(function(d){ var v=d.data(); if(v&&v.key){ MONTHS[v.key]=v; ["sales","recruiting"].forEach(function(s){ (v[s]||[]).forEach(function(r){ NAMES[r.name]=r.full; }); }); } });
    if(!monthKeys().length){ setStatus(false,"No report data yet"); showProblem("No report data yet","The scorecard fills in after the first data refresh. Ask Claude to refresh the Spread Scorecard."); return; }
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
        onView:function(key){ state.month=key; buildMonthSelect(); render(); window.scrollTo(0,0); }
      });
    }).catch(function(){ b.disabled=false; setStatus(false,"Couldn't open the admin panel"); });
  }
  $("adminBtn").addEventListener("click",openAdminPanel);
  showAdminButton();
})();
