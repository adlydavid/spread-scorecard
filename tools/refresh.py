#!/usr/bin/env python3
"""Spread Scorecard refresh kit.

Rebuilds the month documents of the Spread Scorecard artifact from:
  * the newest Weekly Spread Dashboard email (its "Dashboard - Month To Date" sheet, as text), and
  * Bullhorn pulls saved as JSON files (the raw tool results).

Subcommands
  plan  [--today YYYY-MM-DD]
        Prints the payroll months to refresh (previous + current), their Bullhorn
        date ranges, and the roster whose call counts must be fetched.
  build --raw DIR --calls FILE --existing DIR --out DIR [--mtd FILE] [--subject TEXT] [--today YYYY-MM-DD]
        Writes updated month docs (<key>.json) and meta.json into --out.

Raw files expected in --raw (each a Bullhorn query/search result with a "data" list):
  js*.json  JobSubmission  fields id,dateAdded,status,sendingUser(id,firstName,lastName),jobOrder(id,title,owner(id,firstName,lastName),clientCorporation(id,name)),candidate(id,firstName,lastName)
  jo*.json  JobOrder       fields id,dateAdded,status,employmentType,numOpenings,title,owner(id,firstName,lastName),clientCorporation(id,name),isOpen
  pl*.json  Placement      fields id,dateAdded,dateBegin,dateEnd,status,employmentType,payRate,clientBillRate,jobOrder(id,title,owner(id,firstName,lastName),clientCorporation(id,name)),jobSubmission(id,sendingUser(id,firstName,lastName)),candidate(id,firstName,lastName,owner(id,firstName,lastName)),owner(id,firstName,lastName)
  mt*.json  Note (visits)  fields id,action,dateAdded,commentingPerson(id,firstName,lastName),personReference(id,firstName,lastName)
  iv*.json  Note (interviews) same fields as mt
Calls file: {"<lastName>": {"YYYY-MM": count, ...}, ...}
"""
import json, glob, os, sys, re, collections, argparse
import datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MONTHNAME = ['January','February','March','April','May','June','July','August','September','October','November','December']

# ---- people ----------------------------------------------------------------
# Bullhorn CorporateUser ids for everyone whose calls are counted.
ROSTER = {
 'Salemi':5247135,'Wilkinson':5333309,'Madden':5365852,'Nash':5420286,'Endres':5460321,"O'Donnell":5291005,
 'McCabe':5504239,'LeRoy':5504236,'Vaydik':5337642,'Keane':5522375,'Gomez':5522373,'Lawler':5522374,'Sleeper':5522372,
 'Szemplinski':5351971,'Calabro':5399738,'Rogers':5360215,'Driscoll':5421212,'Garrison':5440533,'Kyhos':5509604,
 'Daly':5489738,'Halvorsen':5489739,'Campbell':5460316,'Lindsey':5332227,'Sales':5522376,
}
FULL = {'Salemi':'Michael Salemi','Wilkinson':'Hannah Wilkinson','Madden':'Paige Madden','Nash':'James Nash','Endres':'Jason Endres',
 "O'Donnell":"Brendan O'Donnell",'McCabe':'Charlotte McCabe','LeRoy':'Eli LeRoy','Vaydik':'Bryn Vaydik','Keane':'Gertrude Olivia Keane',
 'Gomez':'Zoe Gomez','Lawler':'Ryan Lawler','Sleeper':'Peter Sleeper','Buleha':'Jillian Buleha','Jenkins':'Chris Jenkins','Reyes':'Kenia Reyes',
 'House':'House Account','Szemplinski':'Reed Szemplinski','Calabro':'Joseph Calabro','Rogers':'Connor Rogers','Driscoll':'Kyle Driscoll',
 'Garrison':'Aaron Garrison','Kyhos':'Justin Kyhos','Daly':'Ian Daly','Halvorsen':'Mary Halvorsen','Campbell':'Camryn Campbell',
 'Lindsey':'Samuel Lindsey','Eames':'Allison Eames','Cote':'Davis Cote','Sales':'Zach Sales','Kunuthur':'Siri Kunuthur','Smithwick':'Julie Smithwick'}
FORMER = {'Buleha','Jenkins','Reyes','Eames','Cote'}
SALES = {'Salemi','Wilkinson','Madden','Nash','Endres',"O'Donnell",'McCabe','LeRoy','Vaydik','Keane','Gomez','Lawler','Sleeper','Buleha','Jenkins','Reyes','House'}
RECR = {'Szemplinski','Calabro','Rogers','Driscoll','Garrison','Kyhos','Daly','Halvorsen','Campbell','Lindsey','Eames','Cote','House','Sales'}
SYSTEM = {'API','Account',None}
MIT_AE = 'Wilkinson'   # MIT Lincoln Laboratory reqs loaded by the web import belong to Hannah's account

CALL_ACTIONS = 'action:(call OR "moat call" OR "recontact call" OR "job qualification call" OR "req qualification call" OR "video call" OR "business conversation")'

# ---- payroll months --------------------------------------------------------
def saturday_of(d):            # week ending Saturday for a date
    return d + dt.timedelta(days=(5 - d.weekday()) % 7)
def month_key(d):
    s = saturday_of(d); return f"{s.year}-{s.month:02d}"
def month_range(key):          # (first day, last day) inclusive
    y, m = map(int, key.split('-'))
    d = dt.date(y, m, 1); first_sat = d + dt.timedelta(days=(5 - d.weekday()) % 7)
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1); last = nxt - dt.timedelta(days=1)
    last_sat = last - dt.timedelta(days=(last.weekday() - 5) % 7)
    return first_sat - dt.timedelta(days=6), last_sat
def prev_key(key):
    s, _ = month_range(key); return month_key(s - dt.timedelta(days=1))
def local(ms):
    return dt.datetime.fromtimestamp(ms / 1000, ET).replace(tzinfo=None)
def key_of_ms(ms):
    return month_key(local(ms).date()) if ms else None

def plan(today):
    cur = month_key(today); prv = prev_key(cur)
    out = {'today': today.isoformat(), 'months': []}
    for k in (prv, cur):
        a, b = month_range(k)
        out['months'].append({'key': k, 'start': a.isoformat(), 'end': b.isoformat(),
                              'lucene': f"dateAdded:[{a:%Y%m%d} TO {(b + dt.timedelta(days=1)):%Y%m%d}}}"})
    out['callQuery'] = 'commentingPerson:<ID> AND ' + CALL_ACTIONS + ' AND <lucene range>'
    ps, _ = month_range(prv); _, ce = month_range(cur)
    out['visitNotesQuery'] = ('action:("new meeting" OR "existing meeting" OR "in-person meeting" OR meeting) AND isDeleted:false AND '
                              f"dateAdded:[{(ps - dt.timedelta(days=120)):%Y%m%d} TO {(ce + dt.timedelta(days=1)):%Y%m%d}}}")
    out['interviewNotesQuery'] = ('action:("interview" OR "interview prep" OR "interview debrief") AND isDeleted:false AND '
                                  f"dateAdded:[{(today - dt.timedelta(days=365)):%Y%m%d} TO {(today + dt.timedelta(days=1)):%Y%m%d}}}")
    out['roster'] = ROSTER
    print(json.dumps(out, indent=1))

# ---- spread from the MTD sheet --------------------------------------------
def parse_mtd(text):
    m = re.search(r"=== Sheet: Dashboard - Month To Date ===(.*?)(=== Sheet:|\Z)", text, re.S)
    block = m.group(1) if m else text
    rows = [ln.split('\t') for ln in block.splitlines()]
    res = {'rm': {}, 'ae': {}}
    mode = None
    for r in rows:
        c = [x.strip() for x in r]
        if len(c) > 5 and c[1] == 'Week Ending' and 'weekEnding' not in res:
            try:
                res['weekEnding'] = (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(c[2])))).isoformat()
                res['revenue'] = float(c[3]); res['gp'] = float(c[5])
            except ValueError:
                pass
        if len(c) > 2 and c[1] == 'Month' and 'month' not in res and c[2] in MONTHNAME:
            res['month'] = c[2]
        if len(c) > 3 and c[1] == 'Recruiter' and 'Gross Profit' in c[3]:
            mode = 'rm'; continue
        if len(c) > 3 and c[1] == 'AE' and 'Gross Profit' in c[3]:
            mode = 'ae'; continue
        if mode and len(c) > 3 and c[1]:
            if c[1] == 'Grand Total':
                res[mode + 'Total'] = float(c[3]); mode = None; continue
            try:
                res[mode][c[1]] = float(c[3])
            except ValueError:
                mode = None
    wk = re.search(r"Week (\d+) of (\d+)", block)
    if wk: res['weekOf'] = [int(wk.group(1)), int(wk.group(2))]
    if res.get('weekEnding'):
        we = dt.date.fromisoformat(res['weekEnding']); res['key'] = month_key(we)
    return res

# ---- Bullhorn helpers ------------------------------------------------------
def ln(p):
    if not p: return None
    if p.get('firstName') == 'Webdeveloper' or p.get('lastName') == 'API': return 'API'
    if p.get('firstName') == 'House' and p.get('lastName') == 'Account': return 'House'
    return p.get('lastName')
def ae_of_job(jo):
    if not jo: return None
    o = ln(jo.get('owner')); cl = ((jo.get('clientCorporation') or {}).get('name') or '')
    if 'MIT Lincoln' in cl and o not in SALES: return MIT_AE
    if o == 'API': return None
    return o
def load(raw, pat):
    out = {}
    for f in sorted(glob.glob(os.path.join(raw, pat))):
        d = json.load(open(f))
        for r in (d.get('data') if isinstance(d, dict) else d) or []:
            out[r['id']] = r
    return list(out.values())

def build(a):
    today = dt.date.fromisoformat(a.today) if a.today else dt.datetime.now(ET).date()
    cur = month_key(today); keys = [prev_key(cur), cur]
    existing = {}
    for f in glob.glob(os.path.join(a.existing, '**', '*.json'), recursive=True):
        if os.path.basename(f) == 'meta.json': continue
        d = json.load(open(f)); d = d.get('data', d) if isinstance(d, dict) and 'data' in d and 'key' not in d else d
        if isinstance(d, dict) and d.get('key'): existing[d['key']] = d
    mtd = parse_mtd(open(a.mtd).read()) if a.mtd else {}
    if mtd: print('MTD parsed:', {k: v for k, v in mtd.items() if k not in ('rm', 'ae')}, file=sys.stderr)

    js = load(a.raw, 'js*.json'); jo = load(a.raw, 'jo*.json'); pl = load(a.raw, 'pl*.json')
    mt = load(a.raw, 'mt*.json'); iv = load(a.raw, 'iv*.json')
    calls = json.load(open(a.calls)) if a.calls and os.path.exists(a.calls) else {}
    for r in js + jo + pl + mt:
        for p in (r.get('sendingUser'), (r.get('jobOrder') or {}).get('owner'), r.get('owner'), r.get('commentingPerson')):
            l = ln(p)
            if l and l not in FULL and l not in SYSTEM and p.get('firstName'):
                FULL[l] = (p['firstName'].strip() + ' ' + p['lastName'].strip())

    C = lambda: collections.defaultdict(lambda: collections.defaultdict(int))
    jobs = C(); sendouts = C(); subs = C(); visits = C(); deals_ae = C(); deals_rc = C(); starts = C(); iv_ae = C(); iv_rc = C()
    deal_list = collections.defaultdict(list)
    for r in jo:
        k = key_of_ms(r['dateAdded'])
        if k in keys: jobs[k][ae_of_job(r) or '_other'] += 1
    for r in js:
        if r.get('status') == 'New Lead': continue
        k = key_of_ms(r['dateAdded'])
        if k not in keys: continue
        sendouts[k][ae_of_job(r.get('jobOrder')) or '_other'] += 1
        s = ln(r.get('sendingUser')); subs[k][s if s not in SYSTEM else '_other'] += 1
    for r in mt:
        if (r.get('personReference') or {}).get('_subtype') != 'ClientContact': continue
        k = key_of_ms(r['dateAdded'])
        if k in keys: visits[k][ln(r['commentingPerson']) or '_other'] += 1
    def rec_of_pl(r):
        s = ln((r.get('jobSubmission') or {}).get('sendingUser'))
        if s and s not in SYSTEM: return s
        o = ln((r.get('candidate') or {}).get('owner'))
        return o if o and o not in SYSTEM else '_other'
    for r in pl:
        k = key_of_ms(r['dateAdded'])
        if k in keys:
            ae = ae_of_job(r.get('jobOrder')) or '_other'; rc = rec_of_pl(r)
            deals_ae[k][ae] += 1; deals_rc[k][rc] += 1
            cand = r.get('candidate') or {}
            deal_list[k].append({'candidate': ((cand.get('firstName') or '').strip() + ' ' + (cand.get('lastName') or '').strip()).strip(),
                'client': ((r.get('jobOrder') or {}).get('clientCorporation') or {}).get('name'), 'title': (r.get('jobOrder') or {}).get('title'),
                'ae': ae, 'recruiter': rc, 'start': local(r['dateBegin']).strftime('%Y-%m-%d') if r.get('dateBegin') else None,
                'status': r.get('status'), 'added': local(r['dateAdded']).strftime('%Y-%m-%d')})
        ks = key_of_ms(r.get('dateBegin'))
        if ks in keys and r.get('status') != 'Never Started':
            starts[ks][ae_of_job(r.get('jobOrder')) or '_other'] += 1
    by_cand = collections.defaultdict(list)
    for r in js:
        c = (r.get('candidate') or {}).get('id')
        if c: by_cand[c].append(r)
    seen = set()
    for r in sorted(iv, key=lambda x: x['dateAdded']):
        pr = r.get('personReference') or {}
        if pr.get('_subtype') != 'Candidate': continue
        t = local(r['dateAdded']).date(); key = (pr['id'], saturday_of(t))
        if key in seen: continue
        seen.add(key)
        k = key_of_ms(r['dateAdded'])
        if k not in keys: continue
        cands = [s for s in by_cand.get(pr['id'], []) if s['dateAdded'] <= r['dateAdded'] + 3 * 86400000]
        author = ln(r.get('commentingPerson'))
        if cands:
            s = max(cands, key=lambda x: x['dateAdded']); rc = ln(s.get('sendingUser')); ae = ae_of_job(s.get('jobOrder'))
        else:
            rc = author if author not in SALES else None; ae = author if author in SALES else None
        iv_rc[k][rc if rc and rc not in SYSTEM else (author or '_other')] += 1
        iv_ae[k][ae or '_other'] += 1

    os.makedirs(a.out, exist_ok=True)
    seen_people = set()
    for k in keys:
        for dd in (subs[k], jobs[k], visits[k], deals_rc[k]):
            seen_people |= {n for n, v in dd.items() if v and n not in SYSTEM and n != '_other'}
    missing = sorted(n for n in seen_people if n not in calls and n not in FORMER and n != 'House')
    if missing: print('WARNING no call counts for:', ', '.join(missing), '(look up their CorporateUser id and add them)', file=sys.stderr)
    for k in keys:
        old = existing.get(k, {})
        s0, s1 = month_range(k)
        has_mtd = mtd.get('key') == k
        if has_mtd:
            sp_ae, sp_rm, gp, rev, has_sp = mtd['ae'], mtd['rm'], mtd.get('gp'), mtd.get('revenue'), True
        else:
            sp_ae = {r['name']: r['spread'] for r in old.get('sales', []) if r.get('spread') is not None}
            sp_rm = {r['name']: r['spread'] for r in old.get('recruiting', []) if r.get('spread') is not None}
            gp, rev, has_sp = old.get('gp'), old.get('revenue'), bool(old.get('spread'))
        callsof = lambda n: int((calls.get(n) or {}).get(k, 0))
        names = set(SALES) | set(sp_ae)
        rows = []
        for n in sorted(names):
            if n in ('Perm', None): continue
            row = {'name': n, 'full': FULL.get(n, n), 'former': n in FORMER,
                   'spread': round(sp_ae.get(n, 0), 2) if has_sp else None, 'calls': callsof(n),
                   'visits': visits[k].get(n, 0), 'jobOrders': jobs[k].get(n, 0), 'sendOuts': sendouts[k].get(n, 0),
                   'interviews': iv_ae[k].get(n, 0), 'deals': deals_ae[k].get(n, 0), 'starts': starts[k].get(n, 0)}
            if any(row[x] for x in ('spread', 'calls', 'visits', 'jobOrders', 'sendOuts', 'interviews', 'deals', 'starts')): rows.append(row)
        oth = {'name': '_other', 'full': 'Unassigned / system-owned', 'former': False, 'spread': None, 'calls': 0, 'visits': visits[k].get('_other', 0),
               'jobOrders': sum(v for n, v in jobs[k].items() if n not in names), 'sendOuts': sum(v for n, v in sendouts[k].items() if n not in names),
               'interviews': sum(v for n, v in iv_ae[k].items() if n not in names), 'deals': sum(v for n, v in deals_ae[k].items() if n not in names),
               'starts': sum(v for n, v in starts[k].items() if n not in names)}
        if any(oth[x] for x in ('jobOrders', 'sendOuts', 'interviews', 'deals', 'starts')): rows.append(oth)
        rnames = set(RECR) | set(sp_rm) | {n for n, v in subs[k].items() if v >= 3 and n != '_other'}
        rrows = []
        for n in sorted(rnames):
            if n in ('Perm', None, '_other'): continue
            row = {'name': n, 'full': FULL.get(n, n), 'former': n in FORMER, 'ae': n in SALES and n != 'House',
                   'spread': round(sp_rm.get(n, 0), 2) if has_sp else None, 'calls': callsof(n),
                   'submittals': subs[k].get(n, 0), 'interviews': iv_rc[k].get(n, 0), 'placements': deals_rc[k].get(n, 0)}
            if any(row[x] for x in ('spread', 'calls', 'submittals', 'interviews', 'placements')): rrows.append(row)
        roth = {'name': '_other', 'full': 'Other / unassigned', 'former': False, 'ae': False, 'spread': None, 'calls': 0,
                'submittals': sum(v for n, v in subs[k].items() if n not in rnames or n == '_other'),
                'interviews': sum(v for n, v in iv_rc[k].items() if n not in rnames or n == '_other'),
                'placements': sum(v for n, v in deals_rc[k].items() if n not in rnames or n == '_other')}
        if any(roth[x] for x in ('submittals', 'interviews', 'placements')): rrows.append(roth)
        y, mo = map(int, k.split('-'))
        doc = {'key': k, 'label': f"{MONTHNAME[mo-1]} {y}", 'short': MONTHNAME[mo-1][:3], 'start': s0.isoformat(), 'end': s1.isoformat(),
               'weeks': ((s1 - s0).days + 1) // 7, 'spread': has_sp, 'gp': round(gp, 2) if (has_sp and gp is not None) else None,
               'revenue': round(rev, 2) if (has_sp and rev is not None) else None, 'sales': rows, 'recruiting': rrows,
               'deals': sorted(deal_list[k], key=lambda x: x['added'])}
        if has_mtd and mtd.get('weekOf'): doc['spreadWeeks'] = mtd['weekOf']
        elif old.get('spreadWeeks'): doc['spreadWeeks'] = old['spreadWeeks']
        json.dump(doc, open(os.path.join(a.out, k + '.json'), 'w'), separators=(',', ':'))
        tot = lambda rs, f: sum((x.get(f) or 0) for x in rs)
        print(k, 'gp', doc['gp'], 'spreadAE', round(tot(rows, 'spread')), 'spreadRM', round(tot(rrows, 'spread')),
              'jobOrders', tot(rows, 'jobOrders'), 'sendOuts', tot(rows, 'sendOuts'), 'interviews', tot(rows, 'interviews'),
              'deals', tot(rows, 'deals'), 'starts', tot(rows, 'starts'), 'visits', tot(rows, 'visits'), 'calls', tot(rrows, 'calls'))
    mf = glob.glob(os.path.join(a.existing, '**', 'meta.json'), recursive=True)
    meta = json.load(open(mf[0])) if mf else {}
    meta = meta.get('data', meta) if isinstance(meta, dict) and 'data' in meta and 'generated' not in meta else meta
    meta['generated'] = dt.datetime.now(ET).strftime('%Y-%m-%dT%H:%M'); meta['bullhornAsOf'] = today.isoformat()
    if mtd.get('weekEnding'):
        meta['spreadWeekEnding'] = mtd['weekEnding']
        we = dt.date.fromisoformat(mtd['weekEnding'])
        meta['spreadReport'] = (a.subject or f"Weekly Spread Dashboard - {we:%m.%d.%y}").replace('FW: ', '').replace('Fw: ', '').strip()
    json.dump(meta, open(os.path.join(a.out, 'meta.json'), 'w'))
    print('meta', meta)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('--today')
    b = sub.add_parser('build')
    for x in ('--raw', '--existing', '--out'): b.add_argument(x, required=True)
    b.add_argument('--calls'); b.add_argument('--mtd'); b.add_argument('--subject'); b.add_argument('--today')
    a = ap.parse_args()
    if a.cmd == 'plan': plan(dt.date.fromisoformat(a.today) if a.today else dt.datetime.now(ET).date())
    else: build(a)
