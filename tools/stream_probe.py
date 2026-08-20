import gzip, json, sys

DROP = ('imageUri', 'layoutRotation')

def stream_variants(path):
    f = gzip.open(path, 'rt', encoding='utf-8')
    buf = ''
    while '"variants"' not in buf:
        c = f.read(1 << 16)
        if not c: return
        buf += c
    buf = buf[buf.index('[', buf.index('"variants"')) + 1:]

    pos = 0; depth = 0; start = None; instr = False; esc = False
    while True:
        while pos < len(buf):
            ch = buf[pos]
            if instr:
                if esc: esc = False
                elif ch == '\\': esc = True
                elif ch == '"': instr = False
            elif ch == '"': instr = True
            elif ch == '{':
                if depth == 0: start = pos
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    yield json.loads(buf[start:pos + 1])
                    buf = buf[pos + 1:]; pos = -1; start = None
            pos += 1
        chunk = f.read(1 << 22)
        if not chunk: return
        buf += chunk

n = 0
cards = {}
feats = {}
desc_bytes = 0
prereq_bytes = 0
compact = []
for v in stream_variants(sys.argv[1]):
    n += 1
    ids = []
    for u in v.get('uses', []):
        c = u['card']
        cards.setdefault(c['oracleId'], c['name'])
        ids.append(c['oracleId'])
    for p in v.get('produces', []):
        feats.setdefault(p['feature']['name'], 0)
        feats[p['feature']['name']] += 1
    desc_bytes += len(v.get('description') or '')
    prereq_bytes += len(v.get('notablePrerequisites') or '') + len(v.get('easyPrerequisites') or '')
    compact.append(1)
    if n % 100000 == 0:
        print(f"  ...{n}", file=sys.stderr, flush=True)

print(f"TOTAL VARIANTS:  {n}")
print(f"UNIQUE CARDS:    {len(cards)}")
print(f"UNIQUE FEATURES: {len(feats)}")
print(f"DESCRIPTION MB:  {desc_bytes/1e6:.1f}")
print(f"PREREQ MB:       {prereq_bytes/1e6:.1f}")
