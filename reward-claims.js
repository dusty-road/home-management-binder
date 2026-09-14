// Reward milestone claim flow for James and Grace.
(function(){
  const milestoneConfig={
    7:{label:'Small Reward',type:'regular'},
    14:{label:'Medium Reward',type:'large'},
    30:{label:'Pocket Money',type:'pocket'}
  };

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
    if(cfg.type==='pocket')return ['Pocket Money'];
    return (rewards[child]||[]).filter(x=>x&&x.type===cfg.type&&x.text).map(x=>x.text);
  }

  window.showRewardChooser=function(child,milestone){
    const target=document.getElementById(`${child}Milestone${milestone}`);
    if(!target)return;
    const choices=rewardChoices(child,milestone);
    if(!choices.length){alert('Add a reward to the reward list first.');return;}
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

  window.renderRewardProgress=function(child){
    const n=getApprovedDays(child),pct=n/30*100,el=$(child+'RewardProgress');
    if(!el)return;
    const milestoneHtml=[7,14,30].map(m=>{
      const cfg=milestoneConfig[m],claim=claimRecord(child,m);
      if(claim){
        return `<div id="${child}Milestone${m}" class="milestone unlocked"><b>${m} Days</b><br>✅ Reward claimed<div style="margin-top:5px;font-size:11px;font-weight:700">${claim.reward}</div><div style="font-size:10px;font-weight:600;color:#666">${formatClaimDate(claim.claimedAt)}</div></div>`;
      }
      if(n>=m){
        return `<div id="${child}Milestone${m}" class="milestone unlocked"><b>${m} Days — ${cfg.label}</b><button class="action" style="display:block;width:100%;margin-top:7px;padding:7px 5px;font-size:11px" onclick="showRewardChooser('${child}',${m})">🎁 Unlock Reward</button></div>`;
      }
      return `<div id="${child}Milestone${m}" class="milestone locked"><b>${m} Days</b><br>🔒 ${cfg.label}</div>`;
    }).join('');
    el.innerHTML=`<div class="reward-meter"><div class="reward-meter-head"><div><b>Reward Progress</b><div class="reward-meter-days">${n} / 30 days</div></div></div><div class="reward-bar-shell"><div class="reward-bar-fill" style="width:${pct}%"></div></div><div class="milestones">${milestoneHtml}</div><p class="placeholder" style="font-size:12px">Progress only advances after Parent Verify.</p><button class="smallbtn" style="margin-left:0" onclick="changeParentPin()">Change Parent PIN</button></div>`;
  };

  renderRewardProgress('james');
  renderRewardProgress('grace');
})();
