/**
 * Telegram Bot v6 — 工具函式（market data / cost / Telegram / quota / dedup）
 *
 * 設計原則：
 * - 無外部 API key 必要（FRED 用 public CSV、Yahoo 用 chart endpoint）
 * - 任一數據源失敗回 null，由上層決定要不要 abort
 * - 沒有 throw 在 utils 裡，全部回 {ok, value, error}
 *
 * 依賴：v5 既有 sendTelegramHtml() / escapeHtml() / fmt() / safe() （在 macro_snapshot_handler.gs）
 */


// ============================================================
// fetchMarketData — 從 FRED + Yahoo Finance 抓 11 個變數
// ============================================================
/**
 * 回傳結構：
 *   { spx, nasdaq, vix, wti, ten_year, dxy, kre, tips_be, five_y_five_y,
 *     taiex, hy_spread, txf1, fetched_at, warnings: [] }
 * 任一欄抓不到 → null（不會丟錯）。
 */
function fetchMarketData() {
  const out = {
    spx: null, nasdaq: null, vix: null, wti: null, ten_year: null,
    dxy: null, kre: null, tips_be: null, five_y_five_y: null,
    taiex: null, hy_spread: null, txf1: null,
    fetched_at: new Date().toISOString(),
    warnings: []
  };

  // Yahoo Finance 5 個（即時報價，免 key）
  const yahoo = {
    spx: '%5EGSPC',
    nasdaq: '%5EIXIC',
    vix: '%5EVIX',
    dxy: 'DX-Y.NYB',
    kre: 'KRE',
    taiex: '%5ETWII',
    txf1: 'TXF%3DF',     // TXF1! 期貨（可能無資料 → 落到 warnings）
    wti: 'CL%3DF'        // WTI 期貨
  };
  Object.keys(yahoo).forEach(key => {
    const v = _fetchYahooQuote(yahoo[key]);
    if (v != null) out[key] = v;
    else out.warnings.push(`yahoo_miss:${key}`);
  });

  // FRED 4 個（公開 CSV，免 key）
  const fred = {
    ten_year: 'DGS10',
    tips_be: 'T10YIE',
    five_y_five_y: 'T5YIFR',
    hy_spread: 'BAMLH0A0HYM2'
  };
  Object.keys(fred).forEach(key => {
    const v = _fetchFredLatest(fred[key]);
    if (v != null) out[key] = v;
    else out.warnings.push(`fred_miss:${key}`);
  });

  return out;
}


function _fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`;
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.getResponseCode() !== 200) return null;
    const json = JSON.parse(resp.getContentText());
    const meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
    if (!meta) return null;
    // regularMarketPrice 是即時 / 收盤
    const price = meta.regularMarketPrice;
    return (typeof price === 'number' && isFinite(price)) ? Number(price.toFixed(4)) : null;
  } catch (e) {
    return null;
  }
}


function _fetchFredLatest(seriesId) {
  // 用公開 CSV（無 API key），抓最新 5 筆找最後一個非空
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return null;
    const lines = resp.getContentText().split('\n').filter(Boolean);
    if (lines.length < 2) return null;
    // 從後往前找有效數值
    for (let i = lines.length - 1; i >= 1; i--) {
      const cols = lines[i].split(',');
      if (cols.length < 2) continue;
      const v = parseFloat(cols[1]);
      if (!isNaN(v)) return Number(v.toFixed(4));
    }
    return null;
  } catch (e) {
    return null;
  }
}


function formatMarketData(d) {
  if (!d) return '(無數據)';
  const rows = [
    ['SPX', d.spx],
    ['Nasdaq', d.nasdaq],
    ['VIX', d.vix],
    ['WTI', d.wti],
    ['10Y', d.ten_year],
    ['DXY', d.dxy],
    ['KRE', d.kre],
    ['TIPS BE 10Y', d.tips_be],
    ['5Y5Y forward', d.five_y_five_y],
    ['TAIEX', d.taiex],
    ['HY spread', d.hy_spread],
    ['TXF1!', d.txf1]
  ];
  return rows
    .map(r => `- ${r[0]}: ${r[1] == null ? 'N/A' : r[1]}`)
    .join('\n');
}


// ============================================================
// last_market_data Sheet — 給 monitorUrgentTriggers 比對前一次值
// ============================================================
function getLastMarketData() {
  const ss = _openV6Sheet();
  if (!ss) return null;
  const sh = ss.getSheetByName('last_market_data');
  if (!sh || sh.getLastRow() < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => { obj[h] = values[i]; });
  return obj;
}

function saveLastMarketData(d) {
  const ss = _openV6Sheet();
  if (!ss) return;
  let sh = ss.getSheetByName('last_market_data');
  if (!sh) {
    sh = ss.insertSheet('last_market_data');
    sh.appendRow(['fetched_at', 'spx', 'nasdaq', 'vix', 'wti', 'ten_year',
                  'dxy', 'kre', 'tips_be', 'five_y_five_y', 'taiex',
                  'hy_spread', 'txf1']);
  }
  const row = [d.fetched_at, d.spx, d.nasdaq, d.vix, d.wti, d.ten_year,
               d.dxy, d.kre, d.tips_be, d.five_y_five_y, d.taiex,
               d.hy_spread, d.txf1];
  if (sh.getLastRow() < 2) {
    sh.appendRow(row);
  } else {
    sh.getRange(2, 1, 1, row.length).setValues([row]);
  }
}


// ============================================================
// Events Sheet — 今日事件
// ============================================================
/** 從 events sheet 撈當日事件；沒 sheet 回空字串。 */
function getEventsToday() {
  const ss = _openV6Sheet();
  if (!ss) return '(events sheet 未設定)';
  const sh = ss.getSheetByName('events');
  if (!sh || sh.getLastRow() < 2) return '(今日無預定事件)';
  const tz = 'Asia/Taipei';
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const data = sh.getDataRange().getValues();
  // 預期欄位: date | time | event | importance | note
  const headers = data[0].map(h => String(h).toLowerCase());
  const dateIdx = headers.indexOf('date');
  if (dateIdx < 0) return '(events sheet header 缺 date 欄)';
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const cell = data[i][dateIdx];
    const dateStr = (cell instanceof Date)
      ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
      : String(cell);
    if (dateStr === todayStr) {
      rows.push(`- ${data[i].slice(1).join(' | ')}`);
    }
  }
  return rows.length > 0 ? rows.join('\n') : '(今日無預定事件)';
}

function getEventResultsToday() {
  // 盤後版用，目前與 getEventsToday 相同邏輯；保留分函式以便日後加 actual 欄位
  return getEventsToday();
}


// ============================================================
// Portfolio change estimate（盤後用，輕量估算）
// ============================================================
function estimatePortfolioChange(marketData) {
  // 從 earnings_watchlist 抓持倉 vs 漲跌幅做粗估
  // 目前 v6 無即時部位漲跌數據 → 回 stub，讓 Claude 自行用 marketData 推估
  return '(由 Claude 依持倉與市場讀數推估，無即時漲跌資料)';
}


// ============================================================
// Portfolio 自動同步：earnings_watchlist → memory #3
// ============================================================
/**
 * 從 v5 earnings_watchlist sheet 讀持倉，自動 format 寫到 memory #3 B 欄。
 * 上游：v5 syncFromSnowball() 把 Snowball Drive 匯出 → earnings_watchlist。
 * 下游：dailyPostMorning/Evening/Urgent 開頭自動呼叫此函式 → daily post 永遠拿最新持倉。
 *
 * 容錯：任何 sheet / header 異常 → 印 warning 後 return（不丟錯，不打斷 daily post）。
 */
function syncPortfolioToMemory() {
  const ss = _openV6Sheet();
  if (!ss) { console.warn('[sync] MACRO_SHEET_ID not set'); return; }

  const watchlist = ss.getSheetByName('earnings_watchlist');
  if (!watchlist || watchlist.getLastRow() < 2) {
    console.warn('[sync] earnings_watchlist 不存在或無資料，略過');
    return;
  }
  const memory = ss.getSheetByName('memory');
  if (!memory) { console.warn('[sync] memory sheet 不存在'); return; }

  const headers = watchlist.getRange(1, 1, 1, watchlist.getLastColumn()).getValues()[0];
  const idx = {
    ticker: headers.indexOf('ticker'),
    shares: headers.indexOf('shares'),
    market: headers.indexOf('market'),
    exit_at: headers.indexOf('exit_at'),
    lock_status: headers.indexOf('lock_status'),
    note: headers.indexOf('note')
  };
  if (idx.ticker < 0 || idx.shares < 0 || idx.note < 0) {
    console.warn('[sync] earnings_watchlist header 不符 v1.2 schema，請先跑 migrateWatchlistSchema()');
    return;
  }

  const rows = watchlist.getRange(2, 1, watchlist.getLastRow() - 1, watchlist.getLastColumn()).getValues();
  const tradeable = {};   // note → ['ticker shares', ...]
  const locked = {};
  const exited = [];

  rows.forEach(r => {
    const ticker = String(r[idx.ticker] || '').trim();
    if (!ticker) return;
    const shares = Number(r[idx.shares] || 0);
    const note = String(r[idx.note] || '其他').trim();
    const exitAt = String(r[idx.exit_at] || '').trim();
    const lockStatus = String(r[idx.lock_status] || '').trim();

    if (shares === 0 || exitAt) {
      exited.push(exitAt ? `${ticker}(${exitAt})` : ticker);
      return;
    }
    const target = (lockStatus === 'locked') ? locked : tradeable;
    if (!target[note]) target[note] = [];
    target[note].push(`${ticker} ${shares}`);
  });

  const lines = [];
  Object.keys(tradeable).forEach(note => {
    lines.push(`[${note}] ${tradeable[note].join(' / ')}`);
  });
  Object.keys(locked).forEach(note => {
    lines.push(`[${note} / 鎖倉不能動] ${locked[note].join(' / ')}`);
  });
  if (exited.length > 0) lines.push(`[已出清] ${exited.join(', ')}`);

  const tz = 'Asia/Taipei';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const content = `Portfolio（自動同步自 earnings_watchlist @ ${stamp}）：\n` + lines.join('\n');

  // 找 Memory #3 列
  const memData = memory.getRange(2, 1, memory.getLastRow() - 1, 4).getValues();
  let targetRow = -1;
  for (let i = 0; i < memData.length; i++) {
    if (Number(memData[i][0]) === 3) { targetRow = i + 2; break; }
  }
  if (targetRow < 0) {
    console.warn('[sync] Memory #3 列不存在於 memory sheet');
    return;
  }

  memory.getRange(targetRow, 2).setValue(content);
  memory.getRange(targetRow, 3).setValue(stamp);
  console.log(`✅ Memory #3 已更新：${Object.keys(tradeable).length} tradeable group / ${Object.keys(locked).length} locked / ${exited.length} exited`);
}


// ============================================================
// Claude API cost calculator
// ============================================================
/**
 * 依 model 名稱算成本（USD）。
 * 價格表（2026 Q2）：
 *   sonnet 4.6:  input $3 / output $15 / M tokens
 *   opus 4.7:    input $15 / output $75 / M tokens
 *   haiku 4.5:   input $0.8 / output $4 / M tokens
 * cache_creation_input_tokens 不計（v6 暫不用 cache）
 */
function calculateCost(usage, model) {
  if (!usage) return 0;
  const inT = Number(usage.input_tokens || 0);
  const outT = Number(usage.output_tokens || 0);
  const m = String(model || '').toLowerCase();
  let inP = 3, outP = 15;          // default sonnet
  if (m.indexOf('opus') >= 0)  { inP = 15; outP = 75; }
  if (m.indexOf('haiku') >= 0) { inP = 0.8; outP = 4; }
  const cost = (inT * inP + outT * outP) / 1e6;
  return Number(cost.toFixed(6));
}


// ============================================================
// Daily quota — 每日成本上限（防 API 失控）
// ============================================================
/**
 * 預設 $0.30/天；超過回 false → 上層用本地模板退化模式。
 * 從 Script Property V6_DAILY_QUOTA_USD 讀（預設 0.30）。
 */
function checkDailyQuota() {
  const props = PropertiesService.getScriptProperties();
  const cap = parseFloat(props.getProperty('V6_DAILY_QUOTA_USD') || '0.30');
  const ss = _openV6Sheet();
  if (!ss) return { ok: true, spent: 0, cap: cap };
  const sh = ss.getSheetByName('daily_log');
  if (!sh || sh.getLastRow() < 2) return { ok: true, spent: 0, cap: cap };
  const tz = 'Asia/Taipei';
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const data = sh.getDataRange().getValues();
  // 欄位: timestamp | mode | model | tokens_input | tokens_output | cost_usd | content | status
  let spent = 0;
  for (let i = 1; i < data.length; i++) {
    const ts = data[i][0];
    const tsStr = (ts instanceof Date) ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd') : String(ts).substring(0, 10);
    if (tsStr === todayStr) {
      spent += Number(data[i][5] || 0);
    }
  }
  return { ok: spent < cap, spent: Number(spent.toFixed(4)), cap: cap };
}


// ============================================================
// daily_log Sheet — 寫入每次 Claude 呼叫紀錄
// ============================================================
function logDailyPost(entry) {
  const ss = _openV6Sheet();
  if (!ss) return;
  let sh = ss.getSheetByName('daily_log');
  if (!sh) {
    sh = ss.insertSheet('daily_log');
    sh.appendRow(['timestamp', 'mode', 'model', 'tokens_input', 'tokens_output',
                  'cost_usd', 'content', 'status']);
  }
  sh.appendRow([
    entry.timestamp || new Date(),
    entry.mode || '',
    entry.model || '',
    entry.tokens_input || 0,
    entry.tokens_output || 0,
    entry.cost_usd || 0,
    String(entry.content || '').substring(0, 45000),  // GAS cell 50K 上限留 buffer
    entry.status || ''
  ]);
}


// ============================================================
// Telegram 推送（>4096 字自動分段）
// ============================================================
/**
 * v6 daily post 用 plain text（Claude output 是 markdown，HTML escape 太麻煩）。
 * Telegram 單則上限 4096 chars，超過自動切段，段間隔 500ms 避 rate limit。
 */
function sendTelegramLong(text) {
  const MAX = 4000;  // 留 buffer
  const props = PropertiesService.getScriptProperties();
  const botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!botToken || !chatId) return { ok: false, error: 'telegram_credentials_missing' };

  const parts = _splitForTelegram(String(text), MAX);
  for (let i = 0; i < parts.length; i++) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true
    };
    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      if (code !== 200) {
        return { ok: false, error: `http_${code}_part_${i + 1}: ${resp.getContentText().substring(0, 200)}` };
      }
    } catch (err) {
      return { ok: false, error: `part_${i + 1}: ${err.message}` };
    }
    if (i < parts.length - 1) Utilities.sleep(500);
  }
  return { ok: true, parts: parts.length };
}

function _splitForTelegram(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > max) {
    // 優先在段落、換行、句號處切
    let cut = remaining.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(remaining.substring(0, cut));
    remaining = remaining.substring(cut).replace(/^\n+/, '');
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}


// ============================================================
// Trigger dedup（重大事件 5 分鐘內同類型不重發）
// ============================================================
function recentlyTriggered(triggerType, withinMin) {
  const props = PropertiesService.getScriptProperties();
  const key = `V6_TRIGGER_${triggerType}`;
  const lastIso = props.getProperty(key);
  if (!lastIso) return false;
  const last = new Date(lastIso);
  if (isNaN(last.getTime())) return false;
  const diffMin = (Date.now() - last.getTime()) / 60000;
  return diffMin < withinMin;
}

function markTriggered(triggerType) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(`V6_TRIGGER_${triggerType}`, new Date().toISOString());
}


// ============================================================
// Daily post idempotency — 同 mode 同日只發一次
// ============================================================
function alreadyPostedToday(mode) {
  const ss = _openV6Sheet();
  if (!ss) return false;
  const sh = ss.getSheetByName('daily_log');
  if (!sh || sh.getLastRow() < 2) return false;
  const tz = 'Asia/Taipei';
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const ts = data[i][0];
    const tsStr = (ts instanceof Date) ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd') : String(ts).substring(0, 10);
    if (tsStr === todayStr && data[i][1] === mode && data[i][7] === 'success') {
      return true;
    }
  }
  return false;
}


// ============================================================
// 解析 Claude API 回應（含 web_search tool_use 的情況）
// ============================================================
function extractClaudeText(response) {
  if (!response || !response.content) return '';
  // response.content 是 array，可能包含 text / tool_use / tool_result
  const texts = response.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text);
  return texts.join('\n\n');
}


// ============================================================
// 內部 helper
// ============================================================
function _openV6Sheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
  if (!sheetId) return null;
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch (e) {
    return null;
  }
}
