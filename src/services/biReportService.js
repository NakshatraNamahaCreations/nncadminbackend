/**
 * BI Report Service
 * Generates a comprehensive 10-15 page financial intelligence report
 * and sends it as a rich HTML email with PDF attachment.
 */
import PDFDocument  from "pdfkit";
import nodemailer   from "nodemailer";
import sendEmail    from "../utils/sendEmail.js";
import Lead         from "../models/Lead.js";
import Expense      from "../models/Expense.js";
import MonthlyTarget from "../models/MonthlyTarget.js";
import FinancialConfig from "../models/FinancialConfig.js";
import SalaryRecord  from "../models/SalaryRecord.js";
import FundTransaction from "../models/FundTransaction.js";
import { Readable } from "stream";

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CLOSED_STAGES = ["closed","won","deal closed","closed won","job completed","completed","closed - won"];
const closedExpr = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED_STAGES] };

function r(n){ return Math.round(n||0); }
function pct(a,b){ return b>0?Math.round(a/b*100):0; }
function fmtINR(n){
  const v=Number(n)||0;
  if(v>=10000000) return `₹${(v/10000000).toFixed(1)}Cr`;
  if(v>=100000)   return `₹${(v/100000).toFixed(1)}L`;
  if(v>=1000)     return `₹${(v/1000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}
function fmtFull(n){ return `₹${(Number(n)||0).toLocaleString("en-IN")}`; }
function signedPct(v){ return v>0?`▲ +${v}%`:v<0?`▼ ${v}%`:"— 0%"; }
function statusColor(v, good=80, warn=50){
  return v>=good?"#10b981":v>=warn?"#f59e0b":"#ef4444";
}

// ── Collect all BI data ───────────────────────────────────────────────────────
async function collectData() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth()+1;
  const prevMonth = month===1?12:month-1;
  const prevYear  = month===1?year-1:year;

  const monthStart = new Date(year,month-1,1);
  const monthEnd   = new Date(year,month,1);
  const yearStart  = new Date(year,0,1);
  const yearEnd    = new Date(year+1,0,1);
  const prevStart  = new Date(prevYear,prevMonth-1,1);
  const prevEnd    = new Date(year,month-1,1);

  // Last 12 months for trend
  const trend12 = Array.from({length:12},(_,i)=>{
    const d = new Date(year,month-1-11+i,1);
    return {y:d.getFullYear(),m:d.getMonth()+1};
  });
  const trendStart = new Date(trend12[0].y,trend12[0].m-1,1);

  const cfg = await FinancialConfig.findOne({branch:""}).lean() || {
    cogsPercent:30, taxRatePercent:30, bufferMonths:5, emergencyPct:15, growthFundPct:15,
    bufferBalance:0, emergencyBalance:0, taxReserveBalance:0, growthBalance:0,
  };

  const [
    revMonth, expMonth, expCatMonth,
    revYTD, expYTD,
    revPrev, expPrev,
    closedMonth, closedYTD,
    trendRev, trendExp,
    sourceAgg, repAgg,
    allLeads, openPipeline,
    targetDoc,
    salaryYTD,
    fundTx,
  ] = await Promise.all([
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:monthStart,$lt:monthEnd},advanceReceived:{$gt:0}}},{$group:{_id:null,total:{$sum:"$advanceReceived"},count:{$sum:1}}}]),
    Expense.aggregate([{$match:{year,month}},{$group:{_id:null,total:{$sum:"$amount"}}}]),
    Expense.aggregate([{$match:{year,month}},{$group:{_id:"$category",total:{$sum:"$amount"}}}]),
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:yearStart,$lt:yearEnd},advanceReceived:{$gt:0}}},{$group:{_id:null,total:{$sum:"$advanceReceived"}}}]),
    Expense.aggregate([{$match:{year}},{$group:{_id:null,total:{$sum:"$amount"}}}]),
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:prevStart,$lt:prevEnd},advanceReceived:{$gt:0}}},{$group:{_id:null,total:{$sum:"$advanceReceived"}}}]),
    Expense.aggregate([{$match:{year:prevYear,month:prevMonth}},{$group:{_id:null,total:{$sum:"$amount"}}}]),
    Lead.aggregate([{$match:{$expr:closedExpr,$or:[{advanceReceivedDate:{$gte:monthStart,$lt:monthEnd}},{updatedAt:{$gte:monthStart,$lt:monthEnd}}]}},{$group:{_id:null,count:{$sum:1},totalVal:{$sum:"$value"},totalAdv:{$sum:"$advanceReceived"}}}]),
    Lead.aggregate([{$match:{$expr:closedExpr,$or:[{advanceReceivedDate:{$gte:yearStart,$lt:yearEnd}},{updatedAt:{$gte:yearStart,$lt:yearEnd}}]}},{$group:{_id:null,count:{$sum:1},totalVal:{$sum:"$value"}}}]),
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:trendStart,$lt:monthEnd},advanceReceived:{$gt:0}}},{$group:{_id:{y:{$year:"$advanceReceivedDate"},m:{$month:"$advanceReceivedDate"}},rev:{$sum:"$advanceReceived"},cnt:{$sum:1}}}]),
    Expense.aggregate([{$match:{$or:trend12.map(t=>({year:t.y,month:t.m}))}},{$group:{_id:{y:"$year",m:"$month"},exp:{$sum:"$amount"}}}]),
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:trendStart,$lt:monthEnd},advanceReceived:{$gt:0}}},{$group:{_id:{$ifNull:["$source","Unknown"]},count:{$sum:1},revenue:{$sum:"$advanceReceived"},avgVal:{$avg:"$value"}}},{$sort:{revenue:-1}},{$limit:8}]),
    Lead.aggregate([{$match:{advanceReceivedDate:{$gte:trendStart,$lt:monthEnd},advanceReceived:{$gt:0}}},{$group:{_id:{$ifNull:["$repName","Unassigned"]},deals:{$sum:1},revenue:{$sum:"$advanceReceived"}}},{$sort:{revenue:-1}},{$limit:8}]),
    Lead.countDocuments(),
    Lead.aggregate([{$match:{$expr:{$not:closedExpr},value:{$gt:0}}},{$group:{_id:null,total:{$sum:"$value"},count:{$sum:1}}}]),
    MonthlyTarget.findOne({year,month}).lean(),
    SalaryRecord.aggregate([{$match:{year}},{$group:{_id:null,total:{$sum:"$netSalary"}}}]),
    FundTransaction.find({}).sort({date:-1}).lean(),
  ]);

  // Compute fund balances
  const fundBalances = {buffer:0,emergency:0,tax:0,growth:0};
  ["buffer","emergency","tax","growth"].forEach(fid=>{
    const txs = fundTx.filter(t=>t.fundId===fid);
    fundBalances[fid] = Math.max(0,txs.reduce((s,t)=>s+(t.type==="deposit"?t.amount:-t.amount),0));
  });

  const revenue     = revMonth[0]?.total||0;
  const opex        = expMonth[0]?.total||0;
  const ytdRev      = revYTD[0]?.total||0;
  const ytdOpex     = expYTD[0]?.total||0;
  const prevRev     = revPrev[0]?.total||0;
  const prevOpex    = expPrev[0]?.total||0;
  const cogs        = r(revenue*cfg.cogsPercent/100);
  const grossProfit = r(revenue-cogs);
  const ebitda      = r(grossProfit-opex);
  const taxProv     = ebitda>0?r(ebitda*cfg.taxRatePercent/100):0;
  const netProfit   = r(ebitda-taxProv);
  const ytdCogs     = r(ytdRev*cfg.cogsPercent/100);
  const ytdGP       = r(ytdRev-ytdCogs);
  const ytdEB       = r(ytdGP-ytdOpex);
  const ytdTax      = ytdEB>0?r(ytdEB*cfg.taxRatePercent/100):0;
  const ytdNP       = r(ytdEB-ytdTax);
  const momRevPct   = prevRev>0?r((revenue-prevRev)/prevRev*100):null;
  const momOpexPct  = prevOpex>0?r((opex-prevOpex)/prevOpex*100):null;
  const grossMargin = pct(grossProfit,revenue);
  const netMargin   = pct(netProfit,revenue);
  const tgt         = targetDoc?.targetRevenue||0;
  const tgtPct      = pct(revenue,tgt);

  const expByCat = {};
  ["rent","salary","electricity","internet","maintenance","other"].forEach(c=>{expByCat[c]=0;});
  expCatMonth.forEach(({_id,total})=>{expByCat[_id]=total;});

  const closedCount = closedMonth[0]?.count||0;
  const closedYTDCount = closedYTD[0]?.count||0;
  const avgDealRev = closedYTDCount>0?r(ytdRev/closedYTDCount):0;
  const directCostPerDeal = r(avgDealRev*cfg.cogsPercent/100);

  // 12-month trend
  const revMap={},expMap={};
  trendRev.forEach(({_id,rev})=>{revMap[`${_id.y}-${_id.m}`]=rev;});
  trendExp.forEach(({_id,exp})=>{expMap[`${_id.y}-${_id.m}`]=exp;});
  const trendData = trend12.map(({y,m})=>{
    const key=`${y}-${m}`;
    const rev=revMap[key]||0;
    const exp=expMap[key]||0;
    const cg=r(rev*cfg.cogsPercent/100);
    const gp=r(rev-cg);
    const eb=r(gp-exp);
    const np=eb>0?r(eb*(1-cfg.taxRatePercent/100)):eb;
    return {label:`${MN[m-1]} ${y}`,rev,exp,cg,gp,eb,np,margin:rev>0?pct(np,rev):0};
  });

  // Rep leaderboard
  const repData = repAgg.map(r=>({
    name: r._id||"Unassigned", deals:r.deals, revenue:r.revenue,
    avgDeal: r.deals>0?Math.round(r.revenue/r.deals):0,
  }));

  // Source breakdown
  const sourceData = sourceAgg.map(s=>({
    source:s._id||"Unknown", count:s.count, revenue:s.revenue,
  }));

  // Alerts
  const alerts=[];
  if(netProfit<0) alerts.push({level:"critical",msg:`Net Loss of ${fmtFull(Math.abs(netProfit))} this month — expenses exceed gross profit.`});
  if(tgt>0&&tgtPct<50) alerts.push({level:"critical",msg:`Revenue at only ${tgtPct}% of monthly target (${fmtFull(tgt)}). Urgent sales push needed.`});
  if(tgt>0&&tgtPct>=50&&tgtPct<80) alerts.push({level:"warning",msg:`Revenue at ${tgtPct}% of target. ${fmtFull(tgt-revenue)} more needed to hit goal.`});
  if(momRevPct!==null&&momRevPct<-15) alerts.push({level:"critical",msg:`Revenue dropped ${Math.abs(momRevPct)}% vs last month. Investigate pipeline.`});
  if(momOpexPct!==null&&momOpexPct>20) alerts.push({level:"warning",msg:`Operating expenses rose ${momOpexPct}% vs last month. Review cost increases.`});
  if(fundBalances.buffer<cfg.bufferMonths*opex*0.5) alerts.push({level:"warning",msg:`Operating Buffer below 50% of target. Recommend increasing monthly contributions.`});
  if(fundBalances.tax<taxProv*0.7) alerts.push({level:"warning",msg:`Tax reserve may be underfunded. Current: ${fmtFull(fundBalances.tax)} vs provision: ${fmtFull(taxProv)}.`});
  if(closedCount===0) alerts.push({level:"warning",msg:`No deals closed this month. Pipeline velocity at risk.`});
  if(ebitda>0&&netProfit>0) alerts.push({level:"info",msg:`Profitable month. Allocate ${fmtFull(r(netProfit*cfg.growthFundPct/100))} to Growth Fund this month.`});
  if(tgt>0&&tgtPct>=100) alerts.push({level:"success",msg:`Target achieved! Revenue ${tgtPct}% of goal. Consider raising next month's target.`});

  // Recommendations
  const recs=[];
  if(netMargin<10) recs.push("Review COGS: direct project costs are compressing margins below 10%. Negotiate vendor rates or increase pricing.");
  if(closedYTDCount>0&&avgDealRev<50000) recs.push(`Average deal size is ${fmtINR(avgDealRev)}. Focus on larger projects or upsell existing clients to improve unit economics.`);
  if(opex>0&&expByCat.salary/opex>0.6) recs.push("Salary costs are >60% of OpEx. Ensure team utilization is optimized before next hire.");
  if(fundBalances.buffer<opex*2) recs.push(`Operating buffer covers less than 2 months. Prioritize building it to ${fmtINR(opex*cfg.bufferMonths)}.`);
  if(sourceData.length>0){
    const top = sourceData[0];
    recs.push(`"${top.source}" is your top revenue source (${fmtINR(top.revenue)}). Double down on this channel.`);
  }
  recs.push(`Next 15-day focus: close ${Math.max(1,Math.ceil(closedCount*0.5))} more deals to maintain monthly momentum.`);

  return {
    period:{ month, year, monthLabel:`${MN[month-1]} ${year}`, generated: new Date().toLocaleString("en-IN") },
    config: cfg,
    is:{ revenue,cogs,grossProfit,grossMargin,opex,expByCat,ebitda,taxProv,netProfit,netMargin,momRevPct,momOpexPct },
    ytd:{ revenue:ytdRev,cogs:ytdCogs,grossProfit:ytdGP,opex:ytdOpex,ebitda:ytdEB,taxProv:ytdTax,netProfit:ytdNP },
    target:{ value:tgt, achieved:tgtPct },
    unitEcon:{ avgDealRev, directCostPerDeal, closedCount, closedYTDCount },
    trendData,
    repData, sourceData,
    pipeline:{ value:openPipeline[0]?.total||0, count:openPipeline[0]?.count||0 },
    totalLeads: allLeads,
    funds:{ balances:fundBalances, config:cfg },
    alerts, recs,
  };
}

// ── Build HTML Report ─────────────────────────────────────────────────────────
function buildHTML(d) {
  const { period:P, is:IS, ytd:YTD, target:TGT, unitEcon:UE,
          trendData, repData, sourceData, pipeline, totalLeads,
          funds:FUNDS, alerts:ALERTS, recs:RECS, config:CFG } = d;

  const trendRows = trendData.map(t=>`
    <tr>
      <td>${t.label}</td>
      <td style="text-align:right">${fmtFull(t.rev)}</td>
      <td style="text-align:right;color:#ef4444">${fmtFull(t.cg)}</td>
      <td style="text-align:right;color:${t.gp>=0?"#10b981":"#ef4444"}">${fmtFull(t.gp)}</td>
      <td style="text-align:right;color:#f59e0b">${fmtFull(t.exp)}</td>
      <td style="text-align:right;color:${t.eb>=0?"#10b981":"#ef4444"}">${fmtFull(t.eb)}</td>
      <td style="text-align:right;color:${t.np>=0?"#10b981":"#ef4444"}">${fmtFull(t.np)}</td>
      <td style="text-align:right"><span style="background:${statusColor(t.margin)};color:#fff;padding:2px 7px;border-radius:4px;font-size:11px">${t.margin}%</span></td>
    </tr>`).join("");

  const repRows = repData.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${r.name}</strong></td>
      <td style="text-align:right">${r.deals}</td>
      <td style="text-align:right;color:#3b82f6"><strong>${fmtFull(r.revenue)}</strong></td>
      <td style="text-align:right">${fmtFull(r.avgDeal)}</td>
    </tr>`).join("");

  const srcRows = sourceData.map((s,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${s.source}</strong></td>
      <td style="text-align:right">${s.count}</td>
      <td style="text-align:right;color:#3b82f6"><strong>${fmtFull(s.revenue)}</strong></td>
      <td style="text-align:right">${s.count>0?fmtFull(Math.round(s.revenue/s.count)):"—"}</td>
    </tr>`).join("");

  const alertRows = ALERTS.map(a=>{
    const col = a.level==="critical"?"#ef4444":a.level==="warning"?"#f59e0b":a.level==="success"?"#10b981":"#3b82f6";
    const bg  = a.level==="critical"?"#450a0a":a.level==="warning"?"#451a03":a.level==="success"?"#064e3b":"#1e3a5f";
    const icon= a.level==="critical"?"⛔":a.level==="warning"?"⚠️":a.level==="success"?"✅":"ℹ️";
    return `<div style="background:${bg};border-left:4px solid ${col};border-radius:6px;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#e2e8f0">${icon} ${a.msg}</div>`;
  }).join("");

  const recItems = RECS.map(r=>`<li style="margin-bottom:10px;color:#e2e8f0;font-size:14px">${r}</li>`).join("");

  const expRows = Object.entries(IS.expByCat).filter(([,v])=>v>0).map(([k,v])=>`
    <tr>
      <td style="text-transform:capitalize">${k}</td>
      <td style="text-align:right">${fmtFull(v)}</td>
      <td style="text-align:right">${pct(v,IS.opex)}%</td>
      <td>
        <div style="background:#1e293b;border-radius:4px;height:8px;overflow:hidden">
          <div style="background:#3b82f6;height:100%;width:${pct(v,IS.opex)}%"></div>
        </div>
      </td>
    </tr>`).join("");

  const FUND_LABELS = { buffer:"Operating Buffer", emergency:"Emergency / Accident Fund", tax:"Tax Reserve", growth:"Growth / Investment Fund" };
  const FUND_COLORS = { buffer:"#3b82f6", emergency:"#f59e0b", tax:"#8b5cf6", growth:"#10b981" };
  const fundCards = ["buffer","emergency","tax","growth"].map(fid=>`
    <div style="background:#1e293b;border-radius:10px;padding:16px;flex:1;min-width:180px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${FUND_LABELS[fid]}</div>
      <div style="font-size:22px;font-weight:800;color:${FUND_COLORS[fid]}">${fmtFull(FUNDS.balances[fid])}</div>
      <div style="font-size:11px;color:#475569;margin-top:4px">Current balance</div>
    </div>`).join("");

  const momRevStyle = IS.momRevPct==null?"color:#64748b":IS.momRevPct>=0?"color:#10b981":"color:#ef4444";
  const momExpStyle = IS.momOpexPct==null?"color:#64748b":IS.momOpexPct<=0?"color:#10b981":"color:#ef4444";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NNC Business Intelligence Report — ${P.monthLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',Arial,sans-serif;background:#0a0f1e;color:#e2e8f0;line-height:1.6}
  table{border-collapse:collapse;width:100%}
  th{background:#1e293b;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:10px 14px;text-align:left;font-weight:600}
  td{padding:9px 14px;color:#94a3b8;font-size:13px;border-bottom:1px solid #0f172a}
  tr:last-child td{border-bottom:none}
  .page{max-width:900px;margin:0 auto;padding:20px}
  .section{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:24px;margin-bottom:24px}
  .section-title{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid #1e293b}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:0}
  .kpi{background:#1e293b;border-radius:8px;padding:14px 16px}
  .kpi-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
  .kpi-val{font-size:20px;font-weight:800;color:#f1f5f9}
  .kpi-sub{font-size:11px;color:#475569;margin-top:3px}
  .is-row{display:grid;grid-template-columns:1fr 140px 140px;padding:8px 0;border-bottom:1px solid #1e293b22;font-size:13px}
  .is-row:last-child{border-bottom:none}
  .is-bold{font-weight:700;color:#f1f5f9}
  .is-indent{padding-left:20px;color:#64748b}
  .divider{height:1px;background:#1e293b;margin:12px 0}
</style>
</head>
<body>
<div class="page">

<!-- ══ COVER ══════════════════════════════════════════════════════════════ -->
<div style="background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 100%);border-radius:16px;padding:40px;margin-bottom:24px;text-align:center">
  <div style="font-size:13px;color:#64748b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Nakshatra Namaaha Creations</div>
  <div style="font-size:32px;font-weight:800;color:#f1f5f9;margin-bottom:6px">Business Intelligence Report</div>
  <div style="font-size:18px;color:#3b82f6;font-weight:600;margin-bottom:16px">${P.monthLabel} — Bi-Weekly Financial Review</div>
  <div style="display:inline-block;background:#1e293b;border-radius:8px;padding:8px 20px;font-size:13px;color:#64748b">
    Generated: ${P.generated} &nbsp;|&nbsp; Confidential — Internal Use Only
  </div>
</div>

<!-- ══ PAGE 1: EXECUTIVE SUMMARY ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">01 — Executive Summary</div>
  <div class="kpi-grid">
    <div class="kpi" style="border-left:3px solid #3b82f6">
      <div class="kpi-label">Revenue</div>
      <div class="kpi-val">${fmtFull(IS.revenue)}</div>
      <div class="kpi-sub" style="${momRevStyle}">${IS.momRevPct!=null?signedPct(IS.momRevPct):"vs last month"}</div>
    </div>
    <div class="kpi" style="border-left:3px solid ${IS.grossProfit>=0?'#10b981':'#ef4444'}">
      <div class="kpi-label">Gross Profit</div>
      <div class="kpi-val" style="color:${IS.grossProfit>=0?'#10b981':'#ef4444'}">${fmtFull(IS.grossProfit)}</div>
      <div class="kpi-sub">${IS.grossMargin}% margin</div>
    </div>
    <div class="kpi" style="border-left:3px solid ${IS.ebitda>=0?'#10b981':'#ef4444'}">
      <div class="kpi-label">EBITDA</div>
      <div class="kpi-val" style="color:${IS.ebitda>=0?'#10b981':'#ef4444'}">${fmtFull(IS.ebitda)}</div>
      <div class="kpi-sub">Before tax provision</div>
    </div>
    <div class="kpi" style="border-left:3px solid ${IS.netProfit>=0?'#10b981':'#ef4444'}">
      <div class="kpi-label">Net Profit</div>
      <div class="kpi-val" style="color:${IS.netProfit>=0?'#10b981':'#ef4444'}">${fmtFull(IS.netProfit)}</div>
      <div class="kpi-sub">${IS.netMargin}% net margin</div>
    </div>
    <div class="kpi" style="border-left:3px solid #f59e0b">
      <div class="kpi-label">Operating Expenses</div>
      <div class="kpi-val">${fmtFull(IS.opex)}</div>
      <div class="kpi-sub" style="${momExpStyle}">${IS.momOpexPct!=null?signedPct(IS.momOpexPct):"vs last month"}</div>
    </div>
    <div class="kpi" style="border-left:3px solid #8b5cf6">
      <div class="kpi-label">Deals Closed</div>
      <div class="kpi-val">${UE.closedCount}</div>
      <div class="kpi-sub">${UE.closedYTDCount} YTD</div>
    </div>
    <div class="kpi" style="border-left:3px solid #14b8a6">
      <div class="kpi-label">Open Pipeline</div>
      <div class="kpi-val">${fmtINR(pipeline.value)}</div>
      <div class="kpi-sub">${pipeline.count} deals</div>
    </div>
    <div class="kpi" style="border-left:3px solid ${statusColor(TGT.achieved)}">
      <div class="kpi-label">Target Achievement</div>
      <div class="kpi-val" style="color:${statusColor(TGT.achieved)}">${TGT.achieved}%</div>
      <div class="kpi-sub">${TGT.value>0?`of ${fmtFull(TGT.value)}`:"No target set"}</div>
    </div>
  </div>
</div>

<!-- ══ PAGE 2: P&L INCOME STATEMENT ═══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">02 — Profit & Loss Statement</div>
  <div style="display:grid;grid-template-columns:1fr 140px 140px;padding:6px 0;font-size:11px;color:#475569;font-weight:600;text-transform:uppercase;border-bottom:1px solid #334155;margin-bottom:4px">
    <span></span><span style="text-align:right">This Month</span><span style="text-align:right">YTD</span>
  </div>
  <div class="is-row is-bold"><span>Revenue (Advance Collected)</span><span style="text-align:right">${fmtFull(IS.revenue)}</span><span style="text-align:right;color:#64748b">${fmtFull(YTD.revenue)}</span></div>
  <div class="is-row is-indent"><span>Cost of Goods Sold (${CFG.cogsPercent}%)</span><span style="text-align:right;color:#ef4444">(${fmtFull(IS.cogs)})</span><span style="text-align:right;color:#64748b">(${fmtFull(YTD.cogs)})</span></div>
  <div class="divider"></div>
  <div class="is-row is-bold" style="color:${IS.grossProfit>=0?'#10b981':'#ef4444'}"><span>Gross Profit</span><span style="text-align:right">${fmtFull(IS.grossProfit)}</span><span style="text-align:right;color:#64748b">${fmtFull(YTD.grossProfit)}</span></div>
  <div style="font-size:11px;color:#475569;padding:4px 0 10px">Gross Margin: <strong style="color:#94a3b8">${IS.grossMargin}%</strong></div>
  <div class="is-row is-bold"><span>Operating Expenses</span><span style="text-align:right;color:#f59e0b">(${fmtFull(IS.opex)})</span><span style="text-align:right;color:#64748b">(${fmtFull(YTD.opex)})</span></div>
  ${Object.entries(IS.expByCat).filter(([,v])=>v>0).map(([k,v])=>`
  <div class="is-row is-indent"><span style="text-transform:capitalize">${k}</span><span style="text-align:right;color:#ef4444">(${fmtFull(v)})</span><span style="text-align:right;color:#64748b">—</span></div>`).join("")}
  <div class="divider"></div>
  <div class="is-row is-bold" style="color:${IS.ebitda>=0?'#10b981':'#ef4444'}"><span>EBITDA</span><span style="text-align:right">${fmtFull(IS.ebitda)}</span><span style="text-align:right;color:#64748b">${fmtFull(YTD.ebitda)}</span></div>
  <div class="is-row is-indent"><span>Tax Provision (${CFG.taxRatePercent}%)</span><span style="text-align:right;color:#ef4444">(${fmtFull(IS.taxProv)})</span><span style="text-align:right;color:#64748b">(${fmtFull(YTD.taxProv)})</span></div>
  <div class="divider"></div>
  <div class="is-row is-bold" style="color:${IS.netProfit>=0?'#10b981':'#ef4444'}"><span>Net Profit</span><span style="text-align:right">${fmtFull(IS.netProfit)}</span><span style="text-align:right;color:#64748b">${fmtFull(YTD.netProfit)}</span></div>
  <div style="font-size:11px;color:#475569;padding:4px 0">Net Margin: <strong style="color:#94a3b8">${IS.netMargin}%</strong> &nbsp;|&nbsp; YTD Net Margin: <strong style="color:#94a3b8">${pct(YTD.netProfit,YTD.revenue)}%</strong></div>
</div>

<!-- ══ PAGE 3: OPERATING EXPENSE BREAKDOWN ════════════════════════════════ -->
<div class="section">
  <div class="section-title">03 — Operating Expense Breakdown</div>
  <table>
    <thead><tr><th>Category</th><th style="text-align:right">Amount</th><th style="text-align:right">% of OpEx</th><th style="width:200px">Distribution</th></tr></thead>
    <tbody>${expRows||"<tr><td colspan='4' style='text-align:center;color:#475569'>No expenses recorded this month</td></tr>"}</tbody>
    <tfoot><tr style="background:#1e293b"><td><strong>Total</strong></td><td style="text-align:right"><strong>${fmtFull(IS.opex)}</strong></td><td style="text-align:right"><strong>100%</strong></td><td></td></tr></tfoot>
  </table>
</div>

<!-- ══ PAGE 4: UNIT ECONOMICS & BREAK-EVEN ════════════════════════════════ -->
<div class="section">
  <div class="section-title">04 — Unit Economics & Break-Even Analysis</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div>
      <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:12px">Per Deal Economics (YTD Average)</div>
      ${[
        ["Avg Deal Revenue",    fmtFull(UE.avgDealRev),    "#3b82f6"],
        ["Direct Cost (COGS)",  `(${fmtFull(UE.directCostPerDeal)})`, "#ef4444"],
        ["Contribution Margin", fmtFull(UE.avgDealRev-UE.directCostPerDeal), "#10b981"],
        ["Contribution %",      `${UE.avgDealRev>0?pct(UE.avgDealRev-UE.directCostPerDeal,UE.avgDealRev):0}%`, "#10b981"],
      ].map(([l,v,c])=>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px">
        <span style="color:#94a3b8">${l}</span><strong style="color:${c}">${v}</strong>
      </div>`).join("")}
    </div>
    <div>
      <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:12px">Monthly Break-Even</div>
      ${[
        ["Fixed OpEx (this month)", fmtFull(IS.opex), "#f59e0b"],
        ["Break-Even Revenue",      UE.avgDealRev>0?fmtFull(Math.ceil(IS.opex/(UE.avgDealRev>0?(UE.avgDealRev-UE.directCostPerDeal)/UE.avgDealRev:1)*UE.avgDealRev)):"—", "#f59e0b"],
        ["Break-Even Deals",        UE.avgDealRev>0?`${Math.ceil(IS.opex/Math.max(1,UE.avgDealRev-UE.directCostPerDeal))} deals`:"—", "#f59e0b"],
        ["Deals Closed This Month", `${UE.closedCount} deals`, UE.closedCount>0?"#10b981":"#ef4444"],
      ].map(([l,v,c])=>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px">
        <span style="color:#94a3b8">${l}</span><strong style="color:${c}">${v}</strong>
      </div>`).join("")}
    </div>
  </div>
</div>

<!-- ══ PAGE 5: RESERVE FUND STATUS ════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">05 — Reserve Fund Status</div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px">${fundCards}</div>
  <table>
    <thead><tr><th>Fund</th><th style="text-align:right">Balance</th><th style="text-align:right">Target</th><th style="text-align:right">Funded %</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Operating Buffer (${CFG.bufferMonths}× monthly opex)</td><td style="text-align:right;color:#3b82f6">${fmtFull(FUNDS.balances.buffer)}</td><td style="text-align:right">${fmtFull(IS.opex*CFG.bufferMonths)}</td><td style="text-align:right">${pct(FUNDS.balances.buffer,IS.opex*CFG.bufferMonths)}%</td><td><span style="background:${statusColor(pct(FUNDS.balances.buffer,IS.opex*CFG.bufferMonths))};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">${pct(FUNDS.balances.buffer,IS.opex*CFG.bufferMonths)>=100?"Funded":pct(FUNDS.balances.buffer,IS.opex*CFG.bufferMonths)>=50?"Partial":"Critical"}</span></td></tr>
      <tr><td>Emergency / Accident Fund</td><td style="text-align:right;color:#f59e0b">${fmtFull(FUNDS.balances.emergency)}</td><td style="text-align:right">—</td><td style="text-align:right">—</td><td><span style="background:${FUNDS.balances.emergency>50000?"#064e3b":"#450a0a"};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">${FUNDS.balances.emergency>50000?"Active":"Build Up"}</span></td></tr>
      <tr><td>Tax Reserve (${CFG.taxRatePercent}% of EBITDA)</td><td style="text-align:right;color:#8b5cf6">${fmtFull(FUNDS.balances.tax)}</td><td style="text-align:right">${fmtFull(IS.taxProv)}</td><td style="text-align:right">${pct(FUNDS.balances.tax,IS.taxProv)}%</td><td><span style="background:${statusColor(pct(FUNDS.balances.tax,IS.taxProv))};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">${pct(FUNDS.balances.tax,IS.taxProv)>=100?"Funded":pct(FUNDS.balances.tax,IS.taxProv)>=70?"Partial":"Critical"}</span></td></tr>
      <tr><td>Growth / Investment Fund (${CFG.growthFundPct}% of profit)</td><td style="text-align:right;color:#10b981">${fmtFull(FUNDS.balances.growth)}</td><td style="text-align:right">${IS.netProfit>0?fmtFull(r(IS.netProfit*CFG.growthFundPct/100)):"—"}</td><td style="text-align:right">—</td><td><span style="background:#1e293b;color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:11px">Ongoing</span></td></tr>
    </tbody>
  </table>
</div>

<!-- ══ PAGE 6: REVENUE SOURCE INTELLIGENCE ════════════════════════════════ -->
<div class="section">
  <div class="section-title">06 — Revenue Source Intelligence (Last 12 Months)</div>
  ${sourceData.length>0?`
  <table>
    <thead><tr><th>#</th><th>Source / Channel</th><th style="text-align:right">Leads</th><th style="text-align:right">Revenue</th><th style="text-align:right">Avg per Lead</th></tr></thead>
    <tbody>${srcRows}</tbody>
  </table>`:`<div style="color:#475569;font-size:13px;padding:20px 0">No source data available yet. Ensure leads have source fields filled.</div>`}
</div>

<!-- ══ PAGE 7: TEAM PERFORMANCE ═══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">07 — Team Performance — Sales Rep Leaderboard</div>
  ${repData.length>0?`
  <table>
    <thead><tr><th>#</th><th>Sales Rep</th><th style="text-align:right">Deals</th><th style="text-align:right">Revenue</th><th style="text-align:right">Avg Deal Size</th></tr></thead>
    <tbody>${repRows}</tbody>
  </table>`:`<div style="color:#475569;font-size:13px;padding:20px 0">No rep data for this period.</div>`}
  <div style="margin-top:12px;font-size:12px;color:#475569">Total leads in system: <strong style="color:#94a3b8">${totalLeads}</strong> &nbsp;|&nbsp; Open pipeline: <strong style="color:#3b82f6">${fmtFull(pipeline.value)}</strong> (${pipeline.count} deals)</div>
</div>

<!-- ══ PAGE 8: 12-MONTH FINANCIAL TREND ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">08 — 12-Month Financial Trend</div>
  <div style="overflow-x:auto">
  <table style="min-width:700px">
    <thead><tr><th>Month</th><th style="text-align:right">Revenue</th><th style="text-align:right">COGS</th><th style="text-align:right">Gross Profit</th><th style="text-align:right">OpEx</th><th style="text-align:right">EBITDA</th><th style="text-align:right">Net Profit</th><th style="text-align:right">Margin</th></tr></thead>
    <tbody>${trendRows}</tbody>
  </table>
  </div>
</div>

<!-- ══ PAGE 9: MONTH-OVER-MONTH COMPARISON ════════════════════════════════ -->
<div class="section">
  <div class="section-title">09 — Month-over-Month Comparison</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
    ${[
      ["Revenue",      IS.revenue,  0,             IS.momRevPct],
      ["Gross Profit", IS.grossProfit, 0,           null],
      ["Net Profit",   IS.netProfit, 0,             null],
      ["OpEx",         IS.opex,     0,              IS.momOpexPct!=null?-IS.momOpexPct:null],
      ["Gross Margin", IS.grossMargin, 0,           null, "%"],
      ["Deals Closed", UE.closedCount, 0,           null, ""],
    ].map(([label,cur,prev,trend,suffix=""])=>`
    <div style="background:#1e293b;border-radius:8px;padding:14px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:4px">${label}</div>
      <div style="font-size:18px;font-weight:700;color:#f1f5f9">${suffix==="%"?cur+"%":suffix===""?cur:fmtFull(cur)}</div>
      ${trend!=null?`<div style="font-size:12px;margin-top:3px;color:${trend>=0?"#10b981":"#ef4444"}">${signedPct(trend)} MoM</div>`:""}
    </div>`).join("")}
  </div>
</div>

<!-- ══ PAGE 10: YTD SUMMARY ═══════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">10 — Year-to-Date (${new Date().getFullYear()}) Summary</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
    ${[
      ["YTD Revenue",       fmtFull(YTD.revenue),      "#3b82f6"],
      ["YTD Gross Profit",  fmtFull(YTD.grossProfit),  "#10b981"],
      ["YTD EBITDA",        fmtFull(YTD.ebitda),       YTD.ebitda>=0?"#10b981":"#ef4444"],
      ["YTD Net Profit",    fmtFull(YTD.netProfit),     YTD.netProfit>=0?"#10b981":"#ef4444"],
      ["YTD OpEx",          fmtFull(YTD.opex),          "#f59e0b"],
      ["YTD Tax Provision", fmtFull(YTD.taxProv),       "#8b5cf6"],
      ["YTD Deals Closed",  UE.closedYTDCount+" deals", "#14b8a6"],
      ["YTD Avg Deal",      fmtFull(UE.avgDealRev),     "#6366f1"],
    ].map(([l,v,c])=>`
    <div style="background:#1e293b;border-radius:8px;padding:14px">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:4px">${l}</div>
      <div style="font-size:17px;font-weight:700;color:${c}">${v}</div>
    </div>`).join("")}
  </div>
</div>

<!-- ══ PAGE 11: ALERTS & RISK FLAGS ═══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">11 — Alerts & Risk Flags</div>
  ${ALERTS.length>0?alertRows:`<div style="background:#064e3b;border-left:4px solid #10b981;border-radius:6px;padding:12px 16px;color:#10b981;font-size:14px">✅ No critical alerts this period. Business is performing within healthy parameters.</div>`}
</div>

<!-- ══ PAGE 12: RECOMMENDATIONS ═══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">12 — Recommendations & Action Items</div>
  <ol style="padding-left:20px">${recItems}</ol>
</div>

<!-- ══ PAGE 13: FINANCIAL CONFIGURATION ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">13 — Financial Configuration Used in This Report</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
    ${[
      ["COGS Rate", CFG.cogsPercent+"%"],
      ["Tax Rate (Firm/LLP)", CFG.taxRatePercent+"%"],
      ["Buffer Target", CFG.bufferMonths+" months of OpEx"],
      ["Emergency Fund", CFG.emergencyPct+"% of annual rev"],
      ["Growth Fund Alloc", CFG.growthFundPct+"% of net profit"],
      ["Report Frequency", "Every 15 days"],
    ].map(([l,v])=>`
    <div style="background:#1e293b;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:3px">${l}</div>
      <div style="font-size:14px;font-weight:600;color:#f1f5f9">${v}</div>
    </div>`).join("")}
  </div>
</div>

<!-- ══ FOOTER ══════════════════════════════════════════════════════════════ -->
<div style="text-align:center;padding:20px;color:#334155;font-size:12px;border-top:1px solid #1e293b;margin-top:8px">
  This report is auto-generated by NNC CRM Business Intelligence System.<br/>
  Sent every 15 days to nn.creations7@gmail.com &nbsp;|&nbsp; ${P.generated}<br/>
  <span style="color:#1e293b">────────────────────────────────────────────────</span>
</div>

</div>
</body>
</html>`;
}

// ── Generate PDF (text-based summary for attachment) ─────────────────────────
function generatePDF(d) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin:50, size:"A4" });

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end",  ()    => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { period:P, is:IS, ytd:YTD, target:TGT, unitEcon:UE, trendData, repData,
            sourceData, pipeline, funds:FUNDS, config:CFG, alerts:ALERTS, recs:RECS } = d;

    const W = doc.page.width - 100; // usable width
    const COL2 = 300;

    function heading(text, size=14, color="#000000") {
      doc.moveDown(0.5).fontSize(size).fillColor(color).font("Helvetica-Bold").text(text).fillColor("#000000");
    }
    function sub(label, value, x2=COL2) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333333").text(label, {continued:true, width:x2-50})
         .font("Helvetica").fillColor("#000000").text(`  ${value}`);
    }
    function hline() { doc.moveDown(0.3).moveTo(50,doc.y).lineTo(545,doc.y).stroke("#cccccc").moveDown(0.3); }
    function pageBreak() { doc.addPage(); }

    // Cover
    doc.rect(0,0,595,200).fill("#1e3a5f");
    doc.fontSize(22).fillColor("#ffffff").font("Helvetica-Bold")
       .text("NNC Business Intelligence Report", 50, 60, {width:495, align:"center"});
    doc.fontSize(14).fillColor("#93c5fd")
       .text(`${P.monthLabel} — Bi-Weekly Financial Review`, 50, 95, {width:495, align:"center"});
    doc.fontSize(10).fillColor("#64748b")
       .text(`Generated: ${P.generated}  |  Confidential`, 50, 130, {width:495, align:"center"});
    doc.fillColor("#000000").moveDown(6);

    // P1: Executive Summary
    heading("1. Executive Summary", 14, "#1e3a5f");
    hline();
    sub("Revenue", fmtFull(IS.revenue));
    sub("Gross Profit", `${fmtFull(IS.grossProfit)} (${IS.grossMargin}% margin)`);
    sub("EBITDA", fmtFull(IS.ebitda));
    sub("Net Profit", `${fmtFull(IS.netProfit)} (${IS.netMargin}% margin)`);
    sub("Operating Expenses", fmtFull(IS.opex));
    sub("Deals Closed", `${UE.closedCount} this month / ${UE.closedYTDCount} YTD`);
    sub("Target Achievement", TGT.value>0?`${TGT.achieved}% of ${fmtFull(TGT.value)}`:"No target set");
    sub("Open Pipeline", `${fmtFull(pipeline.value)} (${pipeline.count} deals)`);

    pageBreak();

    // P2: P&L
    heading("2. Profit & Loss Statement", 14, "#1e3a5f");
    hline();
    const isRows = [
      ["Revenue", IS.revenue, YTD.revenue],
      ["  COGS ("+CFG.cogsPercent+"%)", -IS.cogs, -YTD.cogs],
      ["Gross Profit", IS.grossProfit, YTD.grossProfit],
      ["  Operating Expenses", -IS.opex, -YTD.opex],
      ["EBITDA", IS.ebitda, YTD.ebitda],
      ["  Tax Provision ("+CFG.taxRatePercent+"%)", -IS.taxProv, -YTD.taxProv],
      ["Net Profit", IS.netProfit, YTD.netProfit],
    ];
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#666666")
       .text("Line Item", 50, doc.y, {width:260,continued:true})
       .text("This Month", {width:110,align:"right",continued:true})
       .text("YTD", {width:100,align:"right"}).fillColor("#000000");
    hline();
    isRows.forEach(([label,cur,ytd])=>{
      const isBold = !label.startsWith(" ");
      doc.fontSize(10).font(isBold?"Helvetica-Bold":"Helvetica")
         .fillColor(isBold?(cur>=0?"#000000":"#cc0000"):"#333333")
         .text(label,50,doc.y,{width:260,continued:true})
         .fillColor(cur>=0?"#000000":"#cc0000").text(fmtFull(cur),{width:110,align:"right",continued:true})
         .fillColor("#666666").text(fmtFull(ytd),{width:100,align:"right"}).fillColor("#000000");
    });

    pageBreak();

    // P3: Expense breakdown
    heading("3. Expense Breakdown", 14, "#1e3a5f");
    hline();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#666666")
       .text("Category",50,doc.y,{width:250,continued:true})
       .text("Amount",{width:120,align:"right",continued:true})
       .text("% of OpEx",{width:100,align:"right"}).fillColor("#000000");
    hline();
    Object.entries(IS.expByCat).filter(([,v])=>v>0).forEach(([k,v])=>{
      doc.fontSize(10).font("Helvetica").fillColor("#333333")
         .text(k.charAt(0).toUpperCase()+k.slice(1),50,doc.y,{width:250,continued:true})
         .text(fmtFull(v),{width:120,align:"right",continued:true})
         .text(pct(v,IS.opex)+"%",{width:100,align:"right"});
    });
    doc.fontSize(10).font("Helvetica-Bold").text("Total",50,doc.y+4,{width:250,continued:true})
       .text(fmtFull(IS.opex),{width:120,align:"right",continued:true})
       .text("100%",{width:100,align:"right"});

    pageBreak();

    // P4: Unit Economics
    heading("4. Unit Economics & Break-Even", 14, "#1e3a5f");
    hline();
    sub("Avg Deal Revenue (YTD)", fmtFull(UE.avgDealRev));
    sub("Direct Cost per Deal", fmtFull(UE.directCostPerDeal));
    const contrib = UE.avgDealRev-UE.directCostPerDeal;
    sub("Contribution per Deal", fmtFull(contrib));
    sub("Contribution Margin %", UE.avgDealRev>0?pct(contrib,UE.avgDealRev)+"%":"—");
    const beDeals = contrib>0?Math.ceil(IS.opex/contrib):0;
    sub("Break-Even Deals/Month", beDeals>0?`${beDeals} deals`:"N/A");
    sub("Break-Even Revenue",     beDeals>0?fmtFull(beDeals*UE.avgDealRev):"N/A");
    sub("Deals Closed This Month",UE.closedCount.toString()+" deals");
    hline();
    const status = UE.closedCount>=beDeals?"PROFITABLE":"BELOW BREAK-EVEN";
    doc.fontSize(12).font("Helvetica-Bold")
       .fillColor(UE.closedCount>=beDeals?"#10b981":"#ef4444")
       .text(`Profitability Status: ${status}`).fillColor("#000000");

    pageBreak();

    // P5: Reserve funds
    heading("5. Reserve Fund Status", 14, "#1e3a5f");
    hline();
    [
      ["Operating Buffer", FUNDS.balances.buffer, IS.opex*CFG.bufferMonths],
      ["Emergency Fund",   FUNDS.balances.emergency, 0],
      ["Tax Reserve",      FUNDS.balances.tax, IS.taxProv],
      ["Growth Fund",      FUNDS.balances.growth, 0],
    ].forEach(([label,bal,tgt])=>{
      const p = tgt>0?pct(bal,tgt):null;
      doc.fontSize(10).font("Helvetica-Bold").text(label,{continued:true,width:200})
         .font("Helvetica").text(`  Balance: ${fmtFull(bal)}${tgt>0?`  |  Target: ${fmtFull(tgt)}  |  ${p}% funded`:""}`);
    });

    pageBreak();

    // P6: 12-month trend
    heading("6. 12-Month Financial Trend", 14, "#1e3a5f");
    hline();
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#666666")
       .text("Month",50,doc.y,{width:80,continued:true})
       .text("Revenue",{width:70,align:"right",continued:true})
       .text("Gross Profit",{width:80,align:"right",continued:true})
       .text("OpEx",{width:70,align:"right",continued:true})
       .text("EBITDA",{width:70,align:"right",continued:true})
       .text("Net",{width:65,align:"right",continued:true})
       .text("Margin",{width:45,align:"right"}).fillColor("#000000");
    hline();
    trendData.forEach(t=>{
      doc.fontSize(9).font("Helvetica")
         .text(t.label,50,doc.y,{width:80,continued:true})
         .text(fmtINR(t.rev),{width:70,align:"right",continued:true})
         .fillColor(t.gp>=0?"#000000":"#cc0000").text(fmtINR(t.gp),{width:80,align:"right",continued:true})
         .fillColor("#333333").text(fmtINR(t.exp),{width:70,align:"right",continued:true})
         .fillColor(t.eb>=0?"#000000":"#cc0000").text(fmtINR(t.eb),{width:70,align:"right",continued:true})
         .fillColor(t.np>=0?"#000000":"#cc0000").text(fmtINR(t.np),{width:65,align:"right",continued:true})
         .fillColor("#333333").text(t.margin+"%",{width:45,align:"right"}).fillColor("#000000");
    });

    pageBreak();

    // P7: Rep leaderboard
    heading("7. Sales Team Leaderboard", 14, "#1e3a5f");
    hline();
    if(repData.length>0){
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#666666")
         .text("#",50,doc.y,{width:25,continued:true})
         .text("Rep Name",{width:180,continued:true})
         .text("Deals",{width:60,align:"right",continued:true})
         .text("Revenue",{width:100,align:"right",continued:true})
         .text("Avg Deal",{width:100,align:"right"}).fillColor("#000000");
      hline();
      repData.forEach((r,i)=>{
        doc.fontSize(10).font(i===0?"Helvetica-Bold":"Helvetica")
           .text(`${i+1}`,50,doc.y,{width:25,continued:true})
           .text(r.name,{width:180,continued:true})
           .text(r.deals.toString(),{width:60,align:"right",continued:true})
           .fillColor("#1e3a5f").text(fmtFull(r.revenue),{width:100,align:"right",continued:true})
           .fillColor("#333333").text(fmtFull(r.avgDeal),{width:100,align:"right"}).fillColor("#000000");
      });
    } else {
      doc.fontSize(10).font("Helvetica").fillColor("#666666").text("No rep data for this period.");
    }

    pageBreak();

    // P8: Alerts
    heading("8. Alerts & Recommendations", 14, "#1e3a5f");
    hline();
    if(ALERTS.length>0){
      ALERTS.forEach(a=>{
        const icon=a.level==="critical"?"⛔ ":a.level==="warning"?"⚠️ ":a.level==="success"?"✅ ":"ℹ️ ";
        doc.fontSize(10).font(a.level==="critical"?"Helvetica-Bold":"Helvetica")
           .fillColor(a.level==="critical"?"#cc0000":a.level==="warning"?"#d97706":"#000000")
           .text(icon+a.msg).fillColor("#000000").moveDown(0.2);
      });
    } else {
      doc.fontSize(10).font("Helvetica").fillColor("#10b981").text("✅ No critical alerts this period.").fillColor("#000000");
    }
    hline();
    heading("Action Items:", 11, "#1e3a5f");
    RECS.forEach((r,i)=>{
      doc.fontSize(10).font("Helvetica").fillColor("#333333").text(`${i+1}. ${r}`).moveDown(0.2);
    });

    doc.end();
  });
}

// ── Main: send report ─────────────────────────────────────────────────────────
export async function sendBIReport(to = "nn.creations7@gmail.com") {
  console.log(`[BIReport] Generating report → ${to}`);
  const data = await collectData();
  const html  = buildHTML(data);
  const pdf   = await generatePDF(data);

  const { period:P } = data;
  const subject = `📊 NNC BI Report — ${P.monthLabel} | Net: ${data.is.netProfit>=0?"":"LOSS "}`
    + `${(Number(data.is.netProfit)||0).toLocaleString("en-IN")} | Rev: ${(Number(data.is.revenue)||0).toLocaleString("en-IN")}`;

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
    port: Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 465),
    secure: Number(process.env.EMAIL_PORT||465) === 465,
    auth: {
      user: process.env.EMAIL_USER || process.env.SMTP_USER,
      pass: process.env.EMAIL_PASS || process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"NNC CRM BI" <${process.env.EMAIL_USER || process.env.SMTP_FROM}>`,
    to,
    subject,
    html,
    attachments: [{
      filename: `NNC_BI_Report_${P.monthLabel.replace(" ","_")}.pdf`,
      content:  pdf,
      contentType: "application/pdf",
    }],
  });

  console.log(`[BIReport] Sent successfully to ${to}`);
  return { success:true, period:P.monthLabel };
}
