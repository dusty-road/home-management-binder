import './supabase-sync-core.js';

const rewardScript=document.createElement('script');
rewardScript.src='./reward-claims.js';
rewardScript.defer=true;
document.body.appendChild(rewardScript);
