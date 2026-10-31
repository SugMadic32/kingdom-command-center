#!/usr/bin/env python3
"""List every English string the app shows, and check web/src/lib/dict.ts covers them all.
Run: python3 scripts/i18n-keys.py [--missing]"""
import re, os, sys, json
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
keys = set()
lit = r"""'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)\""""
for d, _, fs in os.walk(os.path.join(root, 'web/src')):
    for f in fs:
        if not f.endswith(('.ts', '.tsx')) or f == 'dict.ts': continue
        s = open(os.path.join(d, f), encoding='utf-8').read()
        for m in re.finditer(r"\bt\(\s*(?:" + lit + ")", s):
            k = m.group(1) if m.group(1) is not None else m.group(2)
            keys.add(k.replace("\\'", "'").replace('\\"', '"'))
# Strings passed to t() indirectly (constants mapped at render time)
indirect = ['Kingdom','My progress','Reference','Overview','Alliances','Announcements','Castle & events','KVK preparation',
  'My dashboard','Resources & buildings','Upgrade calculator','Saved plans','Game data library',
  'In-game confirmed','Cross-checked','Single source','Conflicting','Missing',
  'Castle','KVK','Alliance','Other','All','Going','Maybe','Not going','Attended','Absent',
  'published','proposed','draft','cancelled','archived','pending','sent','failed','skipped',
  'Bread','Wood','Stone','Iron','Truegold','Tempered Truegold',
  'Event manager','Publish kingdom events and KVK seasons','Announcements','Publish kingdom announcements','Data curator',
  'Edit and publish game data','Alliance manager','Create alliances and set any rank','Integrations','Discord settings and delivery logs',
  'created','updated','deleted','published','proposed','cancelled','rescheduled','added times','confirmed a time','set attendance',
  'imported','changed role','changed permissions','issued reset link','added member','updated member','removed member','left',
  'viewed shared data','registered','changed password','reset password','deleted account',
  'event','announcement','alliance','member','building level','dataset version','building','KVK season','KVK phase',
  'checklist item','integration','resource type',
  "King's appointments",'Booking open','Booking closed','Appointment manager',"Run King's appointment schedules and assign members",
  'booked a slot','freed a slot','opened booking','closed booking','set to draft','appointment schedule','appointment position','applied','withdrew','appointed','member planning','upgrade plan','General speedups','Construction speedups','Research speedups','Training speedups','Healing speedups','turned email on','turned email off','turned email on for everyone','turned email off for everyone','turned sharing on','turned sharing on for everyone']
keys.update(indirect)
# Messages the server can send (shown through tErr)
for d, _, fs in os.walk(os.path.join(root, 'server/src')):
    for f in fs:
        if not f.endswith('.ts') or 'test' in d: continue
        s = open(os.path.join(d, f), encoding='utf-8').read()
        for m in re.finditer(r"(?:bad|forbidden|assert\([^;]*?,|HttpError\(\d+,)\s*\(?\s*'((?:[^'\\]|\\.)*)'", s):
            keys.add(m.group(1).replace("\\'", "'"))
        for m in re.finditer(r"message: \{ error: '([^']+)'|error: '([^']+)'", s):
            keys.add(m.group(1) or m.group(2))
        for m in re.finditer(r"notFound\('([^']+)'\)", s):
            keys.add(m.group(1))
keys.add('{what} not found.'); keys.add('Record'); keys.add('You do not have permission to do this.')
keys = sorted(k for k in keys if k.strip() and not k.startswith('/') and k not in ('kc',))
if '--missing' in sys.argv:
    dict_src = open(os.path.join(root, 'web/src/lib/dict.ts'), encoding='utf-8').read() if os.path.exists(os.path.join(root, 'web/src/lib/dict.ts')) else ''
    have = set(json.loads(m) for m in re.findall(r'^\s*("(?:[^"\\]|\\.)*")\s*:', dict_src, re.M))
    missing = [k for k in keys if k not in have]
    print(json.dumps(missing, ensure_ascii=False, indent=0)); print(f'# {len(missing)} missing of {len(keys)}', file=sys.stderr)
    sys.exit(1 if missing else 0)
print(json.dumps(keys, ensure_ascii=False, indent=0)); print(f'# {len(keys)} keys', file=sys.stderr)
