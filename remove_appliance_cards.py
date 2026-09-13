from pathlib import Path
p=Path('index.html')
s=p.read_text()
old='<div class="cat"><h3>Slow Cooker</h3><p class="placeholder">Slow cooking tasks.</p></div><div class="cat"><h3>Air Fryer</h3><p class="placeholder">Air fryer tasks.</p></div><div class="cat"><h3>Oven</h3><p class="placeholder">Oven tasks.</p></div><div class="cat"><h3>Rice Cooker</h3><p class="placeholder">Rice cooker tasks.</p></div>'
if old not in s:
    raise SystemExit('Target block not found; no changes made')
p.write_text(s.replace(old,'',1))
