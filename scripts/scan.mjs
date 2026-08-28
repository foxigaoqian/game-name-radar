import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, normalizeGameName, calculateCandidateScore, candidateLevel } from '../lib/scanner.mjs';
import { scanSteamSource } from '../lib/steam-discovery.mjs';
import { discoverRisingGameQueries } from '../lib/rising-discovery.mjs';
import { verifyGameKeyword, cleanGameName, estimateNameRisk } from '../lib/seo-verifier.mjs';
import { verifyTrendDemand } from '../lib/trend-verifier.mjs';
import { calculateFastSignals, verifyYoutubeSignals, FAST_MODEL_VERSION } from '../lib/fast-signals.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourcesPath=path.join(root,'config','sources.json');
const statePath=path.join(root,'data','state.json');
const candidatesPath=path.join(root,'data','candidates.json');
const reportPath=path.join(root,'data','latest-report.json');
const VERIFY_LIMIT=Math.max(0,Math.min(50,Number(process.env.SEO_VERIFY_LIMIT ?? 30)));
const TREND_LIMIT=Math.max(0,Math.min(10,Number(process.env.TRENDS_VERIFY_LIMIT ?? 3)));
const YOUTUBE_LIMIT=Math.max(0,Math.min(10,Number(process.env.YOUTUBE_VERIFY_LIMIT||3)));
const YOUTUBE_API_KEY=process.env.YOUTUBE_API_KEY||'';
const TARGET_MARKET=process.env.TARGET_MARKET||'US_GLOBAL';
const VERIFY_MAX_AGE=3*86400000;
const TREND_MAX_AGE=86400000;
const TREND_ERROR_RETRY=3600000;
const TREND_BATCH_INTERVAL=30*60000;
const RISING_DISCOVERY_INTERVAL=3*3600000;
const YOUTUBE_MAX_AGE=6*3600000;
const SEO_MODEL_VERSION=5;
const TREND_MODEL_VERSION=4;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
function sourceKinds(candidate){return new Set((candidate.sources||[]).map(source=>source.kind))}
function hasCurrentSeo(candidate){return candidate.seo?.modelVersion===SEO_MODEL_VERSION}

function updateDiscovery(candidate){
  const kinds=sourceKinds(candidate);
  let score=calculateCandidateScore(candidate);
  if(kinds.has('trends-rising-7d'))score+=8;
  if(kinds.has('trends-rising-30d'))score+=6;
  if(kinds.has('steam-popular-new'))score+=4;
  if(kinds.has('itch-jam-popular'))score+=4;
  if(kinds.has('itch-jam-new'))score+=2;
  if(kinds.has('newgrounds-top'))score+=2;
  candidate.discoveryScore=Math.min(20,score);
  candidate.discoveryLevel=candidateLevel(candidate.discoveryScore);
}

function normalizeCandidateName(candidate){
  const cleaned=cleanGameName(candidate.gameName||'');
  if(!cleaned)return false;
  const normalized=normalizeGameName(cleaned);
  if(!normalized)return false;
  candidate.sources=candidate.sources||[];
  for(const source of candidate.sources){
    source.firstSeen=source.firstSeen||candidate.firstSeen;
    source.lastSeen=source.lastSeen||candidate.lastSeen||candidate.firstSeen;
    if(source.currentRank&&!source.bestRank)source.bestRank=source.currentRank;
  }
  if(cleaned!==candidate.gameName||normalized!==candidate.normalizedName){
    candidate.gameName=cleaned;
    candidate.normalizedName=normalized;
    delete candidate.seo;
    delete candidate.fast;
    delete candidate.trend;
    delete candidate.youtube;
    delete candidate.social;
    delete candidate.wikiPrelaunch;
    delete candidate.marketFreshness;
    delete candidate.opportunity;
    candidate.score=0;
    candidate.level='pending';
    candidate.recommendation='pending';
  }
  return true;
}

function dedupeCandidates(items){
  const map=new Map();
  for(const item of items){
    if(!normalizeCandidateName(item))continue;
    const existing=map.get(item.normalizedName);
    if(!existing){map.set(item.normalizedName,item);continue}
    const sourceKeys=new Set((existing.sources||[]).map(source=>source.key));
    for(const source of item.sources||[])if(!sourceKeys.has(source.key)){existing.sources.push(source);sourceKeys.add(source.key)}
    if(Date.parse(item.firstSeen)<Date.parse(existing.firstSeen))existing.firstSeen=item.firstSeen;
    if(Date.parse(item.lastSeen)>Date.parse(existing.lastSeen))existing.lastSeen=item.lastSeen;
    if(!existing.seo&&item.seo)existing.seo=item.seo;
    if(!existing.fast&&item.fast)existing.fast=item.fast;
    if(!existing.trend&&item.trend)existing.trend=item.trend;
    if(!existing.youtube&&item.youtube)existing.youtube=item.youtube;
    if(!existing.social&&item.social)existing.social=item.social;
    if(!existing.wikiPrelaunch&&item.wikiPrelaunch)existing.wikiPrelaunch=item.wikiPrelaunch;
    if(!existing.marketFreshness&&item.marketFreshness)existing.marketFreshness=item.marketFreshness;
    if(!existing.opportunity&&item.opportunity)existing.opportunity=item.opportunity;
  }
  return [...map.values()];
}

function mergeCandidate(candidates,gameName,source,entry,now){
  const cleanedName=cleanGameName(gameName);
  const normalizedName=normalizeGameName(cleanedName);
  if(!normalizedName||normalizedName.length<2)return false;
  let candidate=candidates.find(item=>item.normalizedName===normalizedName);
  if(!candidate){
    candidate={id:`auto-${Buffer.from(normalizedName).toString('base64url').slice(0,24)}`,gameName:cleanedName,normalizedName,firstSeen:now,lastSeen:now,status:'new',sources:[],recommendation:'pending'};
    candidates.push(candidate);
  }
  const key=`${source.id}|${entry.url}`;
  const rank=Number(entry.rank||0);
  let sourceRecord=candidate.sources.find(item=>item.key===key);
  if(!sourceRecord){
    sourceRecord={
      key,sourceId:source.id,name:source.name,kind:source.kind,url:entry.url,date:entry.date||'',
      growth:entry.growth||'',seed:entry.seed||'',windowDays:entry.windowDays||null,
      firstSeen:now,lastSeen:now,currentRank:rank||null,previousRank:null,bestRank:rank||null,
    };
    candidate.sources.push(sourceRecord);
  }else{
    sourceRecord.lastSeen=now;
    sourceRecord.date=entry.date||sourceRecord.date||'';
    if(rank){
      sourceRecord.previousRank=sourceRecord.currentRank||rank;
      sourceRecord.currentRank=rank;
      sourceRecord.bestRank=Math.min(Number(sourceRecord.bestRank||rank),rank);
    }
  }
  candidate.lastSeen=now;
  updateDiscovery(candidate);
  return true;
}

function needsSeoCheck(candidate){
  if(!hasCurrentSeo(candidate))return true;
  const checked=Date.parse(candidate.seo?.checkedAt||'');
  if(!Number.isFinite(checked))return true;
  if(candidate.seo?.status==='error')return Date.now()-checked>12*3600000;
  return Date.now()-checked>VERIFY_MAX_AGE;
}

function shouldAutoVerify(candidate){
  const kinds=sourceKinds(candidate);
  const risk=estimateNameRisk(candidate.gameName);
  return kinds.has('trends-rising-7d')||kinds.has('trends-rising-30d')||kinds.has('steam-popular-new')||
    candidate.sources?.length>=2||kinds.has('itch-featured')||kinds.has('itch-popular')||kinds.has('itch-jam-popular')||
    kinds.has('newgrounds-top')||(kinds.has('steam-new')&&risk<=12)||(kinds.has('itch-new')&&risk<=12)||
    ((candidate.discoveryScore||0)>=7&&risk<=16);
}

function verifyPriority(candidate){
  const kinds=sourceKinds(candidate);
  let score=(candidate.discoveryScore||0)+(30-estimateNameRisk(candidate.gameName));
  if(kinds.has('trends-rising-7d'))score+=35;
  if(kinds.has('trends-rising-30d'))score+=25;
  if(kinds.has('itch-featured'))score+=16;
  if(kinds.has('itch-popular'))score+=12;
  if(kinds.has('newgrounds-top'))score+=10;
  if(kinds.has('steam-popular-new'))score+=10;
  if(kinds.has('itch-new'))score+=4;
  if((candidate.sources||[]).length>=2)score+=10;
  return score;
}

function isFastPassed(candidate){return hasCurrentSeo(candidate)&&candidate.fast?.modelVersion===FAST_MODEL_VERSION&&candidate.fast?.classification==='pass'}
function isTrendEligible(candidate){
  if(!hasCurrentSeo(candidate))return false;
  if(!['independent','page'].includes(candidate.seo?.classification))return false;
  if(Number(candidate.seo?.score||0)<42)return false;
  if(Number(candidate.seo?.nameRisk??30)>14)return false;
  if(candidate.seo?.entityConflict)return false;
  return isFastPassed(candidate);
}

function needsTrendCheck(candidate){
  if(!isTrendEligible(candidate))return false;
  if(candidate.trend?.modelVersion!==TREND_MODEL_VERSION)return true;
  const checked=Date.parse(candidate.trend?.checkedAt||'');
  if(!Number.isFinite(checked))return true;
  if(candidate.trend?.status==='error')return Date.now()-checked>TREND_ERROR_RETRY;
  return Date.now()-checked>TREND_MAX_AGE;
}

function trendPriority(candidate){
  const kinds=sourceKinds(candidate);
  let score=(candidate.seo?.score||0)+(candidate.discoveryScore||0)*2+(candidate.fast?.score||0)*2;
  if(kinds.has('trends-rising-7d'))score+=45;
  if(kinds.has('trends-rising-30d'))score+=32;
  if(kinds.has('itch-featured'))score+=18;
  if(kinds.has('itch-popular'))score+=14;
  if(kinds.has('newgrounds-top'))score+=12;
  if(kinds.has('steam-popular-new'))score+=10;
  if(candidate.seo?.classification==='independent')score+=18;
  const age=Date.now()-Date.parse(candidate.firstSeen||0);
  if(Number.isFinite(age)&&age<2*86400000)score+=8;
  return score;
}

function youtubeNeedsCheck(candidate){
  if(!YOUTUBE_API_KEY||YOUTUBE_LIMIT<=0||!hasCurrentSeo(candidate))return false;
  if(!['independent','page'].includes(candidate.seo?.classification))return false;
  if(!['pass','watch'].includes(candidate.fast?.classification))return false;
  const checked=Date.parse(candidate.youtube?.checkedAt||'');
  return !Number.isFinite(checked)||Date.now()-checked>YOUTUBE_MAX_AGE;
}

function recommendationRank(candidate){return {independent:7,'test-now':6,page:5,watch:4,pending:3,reject:2,error:1}[candidate.recommendation||'pending']||0}

async function processSourceResult({source,result,candidates,radarState,logs,now}){
  const previous=radarState.snapshots[source.id];
  const previousUrls=new Set(previous?.urls||[]);
  const firstScan=!previous;
  const entries=result.entries.map((entry,index)=>({...entry,rank:entry.rank||index+1}));
  const newEntries=firstScan&&source.baselineOnly?[]:entries.filter(entry=>!previousUrls.has(entry.url));
  const newUrls=new Set(newEntries.map(entry=>entry.url));
  let added=0;
  if(!(firstScan&&source.baselineOnly)){
    for(const entry of entries){const merged=mergeCandidate(candidates,entry.gameName,source,entry,now);if(merged&&newUrls.has(entry.url))added+=1}
  }
  radarState.snapshots[source.id]={urls:entries.map(entry=>entry.url),positions:Object.fromEntries(entries.map(entry=>[entry.url,entry.rank])),scannedAt:result.scannedAt||now,detectedType:result.detectedType||source.kind};
  logs.push({ok:true,sourceId:source.id,sourceName:source.name,total:entries.length,added});
  console.log(`✓ ${source.name}: ${entries.length} entries, ${added} new`);
  return added;
}

const sources=(await readJson(sourcesPath,[])).filter(source=>source.enabled!==false);
const radarState=await readJson(statePath,{snapshots:{},lastScan:null,lastRisingDiscovery:null,lastTrendBatch:null});
const candidatePayload=await readJson(candidatesPath,{candidates:[]});
let candidates=dedupeCandidates(Array.isArray(candidatePayload)?candidatePayload:candidatePayload.candidates||[]);
const previousFastById=new Map(candidates.map(candidate=>[candidate.id,candidate.fast||{}]));
const now=new Date().toISOString();
const logs=[];
let totalAdded=0;

for(const source of sources){
  try{
    const result=source.fetchKind==='steam-listing'?await scanSteamSource(source):await scanSource({...source,kind:source.fetchKind||(source.kind?.includes('sitemap')?'sitemap':source.kind?.includes('itch')?'itch-listing':source.kind||'auto')});
    totalAdded+=await processSourceResult({source,result,candidates,radarState,logs,now});
  }catch(error){logs.push({ok:false,sourceId:source.id,sourceName:source.name,error:error.message});console.error(`✗ ${source.name}: ${error.message}`)}
}

let risingDiscoveryRan=false;
const lastRising=Date.parse(radarState.lastRisingDiscovery||'');
if(!Number.isFinite(lastRising)||Date.now()-lastRising>=RISING_DISCOVERY_INTERVAL){
  risingDiscoveryRan=true;
  const risingResults=await discoverRisingGameQueries();
  for(const item of risingResults){
    const source=item.source;
    if(!item.ok){logs.push({ok:false,sourceId:source.id,sourceName:source.name,error:item.error||'Trends related queries failed'});continue}
    const result={entries:item.entries.slice(0,30),detectedType:'trends-related-rising',scannedAt:now};
    totalAdded+=await processSourceResult({source,result,candidates,radarState,logs,now});
  }
  radarState.lastRisingDiscovery=now;
}

candidates=dedupeCandidates(candidates);
for(const candidate of candidates)updateDiscovery(candidate);
const verifyQueue=candidates.filter(candidate=>needsSeoCheck(candidate)&&shouldAutoVerify(candidate)).sort((a,b)=>verifyPriority(b)-verifyPriority(a)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen)).slice(0,VERIFY_LIMIT);
let seoVerified=0,seoErrors=0;
for(const candidate of verifyQueue){
  try{
    console.log(`SEO verify: ${candidate.gameName}`);
    candidate.seo={modelVersion:SEO_MODEL_VERSION,...await verifyGameKeyword(candidate.gameName,candidate.discoveryScore||0)};
    seoVerified+=1;
  }catch(error){
    candidate.seo={modelVersion:SEO_MODEL_VERSION,checkedAt:new Date().toISOString(),status:'error',classification:'error',score:0,reasons:[`自动验证失败：${error.message}`]};
    seoErrors+=1;
    console.error(`SEO verify failed: ${candidate.gameName}: ${error.message}`);
  }
  await sleep(850);
}

for(const candidate of candidates){
  if(!candidate.seo)candidate.seo={modelVersion:SEO_MODEL_VERSION,status:'pending',classification:'pending',score:0,reasons:['等待自动搜索意图验证']};
  if(hasCurrentSeo(candidate)&&['independent','page','reject','watch'].includes(candidate.seo.classification))candidate.fast=calculateFastSignals(candidate,previousFastById.get(candidate.id)||{});
  else candidate.fast={modelVersion:FAST_MODEL_VERSION,status:'pending',classification:'pending',score:0,reasons:['等待最新SEO验证后计算快速热度']};
}

let youtubeVerified=0,youtubeErrors=0;
if(YOUTUBE_API_KEY&&YOUTUBE_LIMIT>0){
  const youtubeQueue=candidates.filter(youtubeNeedsCheck).sort((a,b)=>(b.fast?.score||0)-(a.fast?.score||0)).slice(0,YOUTUBE_LIMIT);
  for(const candidate of youtubeQueue){
    try{candidate.youtube=await verifyYoutubeSignals(candidate.gameName,YOUTUBE_API_KEY);youtubeVerified+=1}
    catch(error){candidate.youtube={checkedAt:new Date().toISOString(),status:'error',error:error.message};youtubeErrors+=1}
    candidate.fast=calculateFastSignals(candidate,previousFastById.get(candidate.id)||{});
    await sleep(500);
  }
}

const trendEligibleBefore=candidates.filter(isTrendEligible);
const urgentModelUpgrade=trendEligibleBefore.some(candidate=>candidate.trend?.modelVersion!==TREND_MODEL_VERSION);
let trendsVerified=0,trendErrors=0,trendBatchRan=false,trendQueueSize=0;
const lastTrendBatch=Date.parse(radarState.lastTrendBatch||'');
const trendBatchDue=urgentModelUpgrade||!Number.isFinite(lastTrendBatch)||Date.now()-lastTrendBatch>=TREND_BATCH_INTERVAL;
if(trendBatchDue){
  trendBatchRan=true;
  const limit=risingDiscoveryRan?Math.min(2,TREND_LIMIT):TREND_LIMIT;
  const trendQueue=candidates.filter(needsTrendCheck).sort((a,b)=>trendPriority(b)-trendPriority(a)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen)).slice(0,limit);
  trendQueueSize=trendQueue.length;
  for(const candidate of trendQueue){
    const previousTrend=candidate.trend;
    try{console.log(`Trends verify: ${candidate.gameName}`);candidate.trend=await verifyTrendDemand(candidate.gameName);trendsVerified+=1}
    catch(error){
      const previousIsValid=previousTrend&&!['error','pending'].includes(previousTrend.classification);
      candidate.trend=previousIsValid?{...previousTrend,stale:true,lastError:error.message,lastErrorAt:new Date().toISOString()}:{modelVersion:TREND_MODEL_VERSION,checkedAt:new Date().toISOString(),status:'error',classification:'error',score:0,reasons:[`趋势验证失败：${error.message}`]};
      trendErrors+=1;
      console.error(`Trends verify failed: ${candidate.gameName}: ${error.message}`);
    }
    await sleep(8000);
  }
  if(trendQueue.length)radarState.lastTrendBatch=now;
}

for(const candidate of candidates){
  if(isTrendEligible(candidate)&&!candidate.trend)candidate.trend={modelVersion:TREND_MODEL_VERSION,status:'pending',classification:'pending',score:0,reasons:['等待Google Trends需求验证']};
  applyFinalRecommendation(candidate);
}

candidates.sort((a,b)=>recommendationRank(b)-recommendationRank(a)||(b.finalScore||0)-(a.finalScore||0)||(b.fast?.score||0)-(a.fast?.score||0)||(b.trend?.score||0)-(a.trend?.score||0)||(b.seo?.score||0)-(a.seo?.score||0)||(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
if(candidates.length>3000)candidates.length=3000;

const recommendationCounts={independent:0,'test-now':0,page:0,watch:0,reject:0,pending:0,error:0};
for(const candidate of candidates)recommendationCounts[candidate.recommendation||'pending']=(recommendationCounts[candidate.recommendation||'pending']||0)+1;
const seoPassedCount=candidates.filter(candidate=>hasCurrentSeo(candidate)&&['independent','page'].includes(candidate.seo?.classification)).length;
const fastPassedCount=candidates.filter(candidate=>candidate.fast?.classification==='pass').length;
const fastWatchCount=candidates.filter(candidate=>candidate.fast?.classification==='watch').length;
const fastRejectedCount=candidates.filter(candidate=>['weak','reject'].includes(candidate.fast?.classification)).length;
const trendEligibleCount=candidates.filter(isTrendEligible).length;
const trendPendingCount=candidates.filter(candidate=>isTrendEligible(candidate)&&needsTrendCheck(candidate)).length;
const trendValidatedCount=candidates.filter(candidate=>isTrendEligible(candidate)&&candidate.trend?.modelVersion===TREND_MODEL_VERSION&&!['pending','error'].includes(candidate.trend?.classification)).length;
const risingCount=candidates.filter(candidate=>['rising','breakout'].includes(candidate.trend?.classification)).length;
const globalRisingCount=candidates.filter(candidate=>['rising','breakout'].includes(candidate.trend?.globalClassification)).length;
radarState.lastScan=now;
await fs.writeFile(statePath,JSON.stringify(radarState,null,2)+'\n');
await fs.writeFile(candidatesPath,JSON.stringify({updatedAt:now,candidates},null,2)+'\n');
await fs.writeFile(reportPath,JSON.stringify({scannedAt:now,targetMarket:TARGET_MARKET,primaryMarket:'US',referenceMarket:'WORLDWIDE',totalAdded,sources:logs,seoVerified,seoErrors,fastModelVersion:FAST_MODEL_VERSION,fastPassedCount,fastWatchCount,fastRejectedCount,youtubeEnabled:Boolean(YOUTUBE_API_KEY),youtubeConfigured:Boolean(YOUTUBE_API_KEY),youtubeVerified,youtubeErrors,trendsVerified,trendErrors,trendBatchRan,trendQueueSize,risingDiscoveryRan,seoModelVersion:SEO_MODEL_VERSION,trendModelVersion:TREND_MODEL_VERSION,seoPassedCount,trendEligibleCount,trendPendingCount,trendValidatedCount,risingCount,globalRisingCount,recommendationCounts},null,2)+'\n');
console.log(`Scan complete. Market ${TARGET_MARKET}; YouTube ${YOUTUBE_API_KEY?'enabled':'disabled'}; ${totalAdded} names added; ${seoVerified} SEO checks; ${fastPassedCount} fast-pass; ${trendsVerified} Trends checks; ${trendPendingCount} trend candidates pending.`);
