from pathlib import Path

p = Path('index.html')
s = p.read_text()

old_cards = '''<div class="card big accent-red"><h2>Needs Attention</h2><p class="placeholder">Appointments and urgent tasks will go here.</p></div>
<div class="card side accent-green"><h2>Money to Protect</h2><div class="money">$0</div><p class="placeholder">Upcoming bills.</p></div>
<div class="card half accent-blue"><h2>Coming Up</h2><p class="placeholder">Next few days.</p></div>'''

new_cards = '''<div class="card big accent-red"><h2>Needs Attention</h2><div id="needsAttentionList"></div><div class="controls"><input id="needsAttentionInput" placeholder="Add appointment or urgent task"><button class="action" onclick="addNeedsAttention()">Add</button></div></div>
<div class="card half accent-blue"><h2>Coming Up</h2><div id="comingUpList"></div><div class="controls"><input id="comingUpInput" placeholder="Add something coming up"><button class="action" onclick="addComingUp()">Add</button></div></div>'''

if old_cards in s:
    s = s.replace(old_cards, new_cards, 1)
elif 'Money to Protect' in s:
    raise SystemExit('Today cards changed unexpectedly; stopping without modifying the file')

anchor = "const $=id=>document.getElementById(id);"
feature_js = r'''

// ---------- Needs Attention + Coming Up ----------
let needsAttentionItems=JSON.parse(localStorage.getItem('needsAttentionItems')||'[]');
let comingUpItems=JSON.parse(localStorage.getItem('comingUpItems')||'[]');
function renderSimpleTodayList(targetId,items,emptyText,saveFn){
  const target=$(targetId);if(!target)return;target.innerHTML='';
  if(!items.length){let p=document.createElement('p');p.className='placeholder';p.textContent=emptyText;target.appendChild(p);return;}
  items.forEach((x,i)=>{let d=document.createElement('div');d.className='task'+(x.done?' done':'');d.innerHTML=`<input type="checkbox" ${x.done?'checked':''}><span></span><button class="smallbtn">×</button>`;d.querySelector('span').textContent=x.text;d.querySelector('input').onchange=e=>{x.done=e.target.checked;saveFn()};d.querySelector('button').onclick=()=>{items.splice(i,1);saveFn()};target.appendChild(d)});
}
function saveNeedsAttention(){localStorage.setItem('needsAttentionItems',JSON.stringify(needsAttentionItems));renderSimpleTodayList('needsAttentionList',needsAttentionItems,'Nothing urgent right now.',saveNeedsAttention)}
function addNeedsAttention(){let input=$('needsAttentionInput');let v=(input?.value||'').trim();if(!v)return;if(!needsAttentionItems.some(x=>x.text.toLowerCase()===v.toLowerCase()))needsAttentionItems.push({text:v,done:false});if(input)input.value='';saveNeedsAttention()}
function saveComingUp(){localStorage.setItem('comingUpItems',JSON.stringify(comingUpItems));renderSimpleTodayList('comingUpList',comingUpItems,'Nothing coming up yet.',saveComingUp)}
function addComingUp(){let input=$('comingUpInput');let v=(input?.value||'').trim();if(!v)return;if(!comingUpItems.some(x=>x.text.toLowerCase()===v.toLowerCase()))comingUpItems.push({text:v,done:false});if(input)input.value='';saveComingUp()}
renderSimpleTodayList('needsAttentionList',needsAttentionItems,'Nothing urgent right now.',saveNeedsAttention);
renderSimpleTodayList('comingUpList',comingUpItems,'Nothing coming up yet.',saveComingUp);
'''

if 'function addNeedsAttention()' not in s:
    if anchor not in s:
        raise SystemExit('Script anchor not found; stopping without modifying the file')
    s = s.replace(anchor, anchor + feature_js, 1)

sync_tag = '<script type="module" src="./supabase-sync.js"></script>'
if sync_tag not in s:
    if '</body>' not in s:
        raise SystemExit('Closing body tag not found; stopping without modifying the file')
    s = s.replace('</body>', sync_tag + '\n</body>', 1)

p.write_text(s)
