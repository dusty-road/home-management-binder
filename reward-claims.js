// Reward milestone claim flow for James and Grace.
(function(){
  const milestoneConfig={
    7:{label:'Mini Reward',type:'mini'},
    14:{label:'Regular Reward',type:'regular'},
    30:{label:'Special Reward',type:'special'}
  };

  // Migrate the previous two-tier reward setup without losing existing rewards:
  // old Small (regular) -> Mini, old Medium (large) -> Regular.
  ['james','grace'].forEach(child=>{
    let changed=false;
    (rewards[child]||[]).forEach(r=>{
      if(!r||r.type==='__claim__')return;
      if(r.type==='large'){r.type='regular';changed=true}
      else if(r.type==='regular'&&!r._rewardTierMigrated){r.type='mini';changed=true}
      if(r.type==='mini'||r.type==='regular'||r.type==='special')r._rewardTierMigrated=true;
    });
    if(changed)localStorage.setItem(child+'Rewards',JSON.stringify(rewards[child]));
  });

  function configureRewardEditor(child){
    const select=document.getElementById(child+'RewardType');
    if(!select)return;
    select.innerHTML='<option value="mini">Mini Reward</option><option value="regular">Regular Reward</option><option value="special">Special Reward</option>';
  }

  function claimRecord(child,milestone){
    return (rewards[child]||[]).find(x=>x&&x.type==='__claim__'&&Number(x.milestone)===Number(milestone));
  }

  function formatClaimDate(iso){
    if(!iso)return '';
    const d=new Date(iso+'T00:00:00');
    return d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
  }

  function rewardChoices(child,milestone){
    const cfg=milestoneConfig[milestone];
    return (rewards[child]||[]).filter(x=>x&&x.type===cfg.type&&x.text).map(x=>x.text);
  }

  window.showRewardChooser=function(child,milestone){
    const target=document.getElementById(`${child}Milestone${milestone}`);
    if(!target)return;
    const choices=rewardChoices(child,milestone);
    if(!choices.length){alert(`Add a ${milestoneConfig[milestone].label.toLowerCase()} to the reward list first.`);return;}
    target.innerHTML=`<b>${milestone} Days — ${milestoneConfig[milestone].label}</b><div style="margin-top:8px"><select class="reward-choice" style="width:100%;padding:8px;border:1px solid #bbb;border-radius:8px"></select><button class="action reward-claim-btn" style="width:100%;margin-top:7px">Claim Reward</button><button class="smallbtn reward-cancel-btn" style="margin:7px 0 0">Cancel</button></div>`;
    const select=target.querySelector('.reward-choice');
    choices.forEach(text=>{const o=document.createElement('option');o.value=text;o.textContent=text;select.appendChild(o)});
    target.querySelector('.reward-claim-btn').onclick=()=>window.claimMilestoneReward(child,milestone,select.value);
    target.querySelector('.reward-cancel-btn').onclick=()=>renderRewardProgress(child);
  };

  window.claimMilestoneReward=function(child,milestone,rewardText){
    if(claimRecord(child,milestone))return;
    if(!parentApprove('Enter parent PIN to claim this reward'))return alert('Incorrect PIN');
    rewards[child].push({type:'__claim__',milestone:Number(milestone),reward:rewardText,claimedAt:todayKey()});
    saveRewards(child);
    renderRewardProgress(child);
  };

  window.renderRewards=function(child){
    const el=document.getElementById(child+'Rewards');
    if(!el)return;
    el.innerHTML='';
    [['mini','Mini Rewards'],['regular','Regular Rewards'],['special','⭐ Special Rewards']].forEach(([type,label])=>{
      const group=document.createElement('div');
      group.className='reward-group';
      const h=document.createElement('h3');
      h.textContent=label;
      group.appendChild(h);
      const items=(rewards[child]||[]).map((r,i)=>({r,i})).filter(x=>x.r&&x.r.type===type);
      if(!items.length){
        const p=document.createElement('p');
        p.className='placeholder';
        p.style.fontSize='12px';
        p.textContent='No rewards added yet.';
        group.appendChild(p);
      }
      items.forEach(({r,i})=>{
        const d=document.createElement('div');
        d.className='reward-item'+(type==='special'?' reward-large':'');
        const s=document.createElement('span');
        s.textContent=r.text;
        const b=document.createElement('button');
        b.className='smallbtn';
        b.textContent='×';
        b.onclick=()=>{rewards[child].splice(i,1);saveRewards(child)};
        d.append(s,b);
        group.appendChild(d);
      });
      el.appendChild(group);
    });
  };

  window.renderRewardProgress=function(child){
    const n=getApprovedDays(child),pct=n/30*100,el=$(child+'RewardProgress');
    if(!el)return;
    const milestoneHtml=[7,14,30].map(m=>{
      const cfg=milestoneConfig[m],claim=claimRecord(child,m);
      if(claim){
        return `<div id="${child}Milestone${m}" class="milestone unlocked"><b>${m} Days — ${cfg.label}</b><br>✅ Reward claimed<div style="margin-top:5px;font-size:11px;font-weight:700">${claim.reward}</div><div style="font-size:10px;font-weight:600;color:#666">${formatClaimDate(claim.claimedAt)}</div></div>`;
      }
      if(n>=m){
        return `<div id="${child}Milestone${m}" class="milestone unlocked"><b>${m} Days — ${cfg.label}</b><button class="action" style="display:block;width:100%;margin-top:7px;padding:7px 5px;font-size:11px" onclick="showRewardChooser('${child}',${m})">🎁 Unlock Reward</button></div>`;
      }
      return `<div id="${child}Milestone${m}" class="milestone locked"><b>${m} Days</b><br>🔒 ${cfg.label}</div>`;
    }).join('');
    el.innerHTML=`<div class="reward-meter"><div class="reward-meter-head"><div><b>Reward Progress</b><div class="reward-meter-days">${n} / 30 days</div></div></div><div class="reward-bar-shell"><div class="reward-bar-fill" style="width:${pct}%"></div></div><div class="milestones">${milestoneHtml}</div><p class="placeholder" style="font-size:12px">Progress only advances after Parent Verify.</p><button class="smallbtn" style="margin-left:0" onclick="changeParentPin()">Change Parent PIN</button></div>`;
  };

  ['james','grace'].forEach(child=>{
    configureRewardEditor(child);
    renderRewards(child);
    renderRewardProgress(child);
  });
})();
