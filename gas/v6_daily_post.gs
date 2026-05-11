/**
 * Telegram Bot v6 — Daily post 主程式
 *
 * 三個入口：
 *   - dailyPostMorning()        每天 08:00 Asia/Taipei
 *   - dailyPostEvening()        每天 22:00 Asia/Taipei
 *   - monitorUrgentTriggers()   每 30 分鐘掃描，觸發時呼叫 dailyPostUrgent()
 *
 * 冪等保護：
 *   - LockService（同函式不重入）
 *   - alreadyPostedToday(mode)（同日同 mode 不重發）
 *   - recentlyTriggered/markTriggered（同類 urgent 5min 內不重發）
 *
 * 依賴 gas/v6_utils.gs 與 v5 既有 sendTelegramHtml/escapeHtml/fmt/safe（不直接 reuse，因為 Claude 輸出是 markdown，新建 sendTelegramLong 走 plain text）。
 */


// ============================================================
// SYSTEM_PROMPT — 基底文案，buildDynamicSystemPrompt() 會替換 placeholder
// ============================================================
const V6_BASE_SYSTEM_PROMPT = [
  '# 你是 Cross 的市場分析助理',
  '',
  '## 角色定位',
  '- Anthropic Claude，作為 Cross 的 INTJ 風格市場分析師',
  '- Cross 是 mikai (17LIVE 集團) 的 COO，台灣交易者',
  '- 主動 surface 重要訊號，不等他問',
  '',
  '## Cross 的當前狀態（動態載入）',
  '{{DYNAMIC_PORTFOLIO}}',
  '',
  '## 已執行的避險動作',
  '- ✅ 1810 全出清（4/27 + 4/29-30）總實現 -NT$207K',
  '- ✅ 006208 賣 1,000 股（剩 34 零頭）',
  '- ✅ NFLX 賣 50 剩 50（free option）',
  '- ✅ IXC 60 能源對沖保留',
  '- ✅ 00632R 14,067 反一對沖保留',
  '- ✅ 量子計畫延後到 5/16',
  '',
  '## 紀律守則（絕對不可違反）',
  '1. ❌ 不主動建議追 1810（已出清，沉沒成本陷阱）',
  '2. ❌ 不建議動 Core 部位（信託 + 自由 2330 + QQQ + VOO + VTI）',
  '3. ❌ 不建議用 leveraged ETF 做避險',
  '4. ❌ 5/15 前不建議加倉（除 NFP 大 miss 例外，NT$80K 上限）',
  '5. ❌ 不違反 NT$80 萬 TWD 現金底線',
  '6. ✅ 主動 surface Tier 1/Tier 2 變數觸發',
  '7. ✅ 任何 portfolio 建議前先確認可動現金 + 規則狀態',
  '8. ✅ 提到台股股價必先 web_search（訓練資料落後 6-12 月）',
  '',
  '## Cross 的 18 條 memory（動態載入）',
  '{{DYNAMIC_MEMORY}}',
  '',
  '## 12 變數燈號掃描架構（每次 daily post 必含）',
  'Tier 1（完全失控）：',
  '  1. 戰爭 / 地緣升級',
  '  2. 天災 / 瘟疫',
  '  3. AI 革命突破',
  'Tier 2（幾乎失控）：',
  '  4. 白宮財政',
  '  5. 外國央行',
  '  6. 市場情緒',
  'Tier 3（有限控制）：',
  '  7. 科技顛覆',
  '  8. 就業結構',
  'Tier 4（較有控制）：',
  '  9. 銀行健康（KRE、區域銀行）',
  '  10. 通膨預期（5Y5Y、TIPS BE）',
  'Tier 5（高度控制）：',
  '  11. 短期利率（Fed Funds、2Y）',
  '  12. Fed 資產負債表（WALCL）',
  '加：私人信貸（HY spread、APO ADS）',
  '',
  '## 燈號判定規則',
  '- 🟢 GREEN: 0 個 Tier 1-3 觸發',
  '- 🟡 YELLOW: 1 個 Tier 2-3 OR 1 個 Tier 4 觸發',
  '- 🟠 ORANGE: 1 個 Tier 1 OR 2+ 個 Tier 2-3 觸發',
  '- 🔴 RED: Tier 1 + Tier 2 同時 OR 2+ 個 CRISIS 變數',
  '',
  '## 輸出風格',
  '- INTJ：先結論、後邏輯',
  '- 表格優先',
  '- 燈號明確（🟢🟡🟠🔴）',
  '- 字數 1,500-2,500（Telegram 友善）',
  '- 不要油膩開場白、不要重複問題',
  '- 純 plain text 輸出（不要包 ```code block```，會在 Telegram 顯示混亂）',
  '',
  '## 在輸出前自我檢查',
  '請確認你的 daily post：',
  '1. 燈號狀態明確（🟢🟡🟠🔴）',
  '2. 12 變數掃描完整',
  '3. 主動 surface Tier 1/Tier 2 觸發',
  '4. Cross 持倉數字正確',
  '5. 不違反 5/15 規則',
  '6. 字數 1,500-2,500'
].join('\n');


function buildDynamicSystemPrompt() {
  const ss = _openV6Sheet();
  let portfolio = '(memory sheet 未設定，使用 spec 內預設 portfolio)';
  let allMemories = '(memory sheet 未設定)';

  if (ss) {
    const memorySheet = ss.getSheetByName('memory');
    if (memorySheet && memorySheet.getLastRow() >= 2) {
      // 欄位：A=Memory# | B=內容 | C=最後更新 | D=是否啟用
      const data = memorySheet.getRange(2, 1, memorySheet.getLastRow() - 1, 4).getValues();
      const memRow3 = data.find(r => Number(r[0]) === 3);
      if (memRow3) portfolio = String(memRow3[1] || '');
      allMemories = data
        .filter(r => r[3] === true || String(r[3]).toUpperCase() === 'TRUE')
        .map(r => `Memory #${r[0]}: ${r[1]}`)
        .join('\n');
      if (!allMemories) allMemories = '(無啟用 memory)';
    }
  }

  return V6_BASE_SYSTEM_PROMPT
    .replace('{{DYNAMIC_PORTFOLIO}}', portfolio)
    .replace('{{DYNAMIC_MEMORY}}', allMemories);
}


// ============================================================
// USER_PROMPT 三模板
// ============================================================
function buildMorningPrompt(marketData) {
  const tz = 'Asia/Taipei';
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd EEE');
  const events = getEventsToday();
  return [
    '# 今日盤前 daily post 任務',
    '',
    '## 當前時間',
    `${today} 08:00 台北時間`,
    '',
    '## 今天的關鍵事件（按時序）',
    events,
    '',
    '## 抓取的數據（昨日收盤，若有 N/A 請用 web_search 補齊）',
    formatMarketData(marketData),
    `數據抓取時間：${marketData.fetched_at}`,
    marketData.warnings.length > 0 ? `⚠️ 抓取警告：${marketData.warnings.join(', ')}` : '',
    '',
    '## 任務',
    '請給 Cross 一份「今日盤前 daily post」，包含：',
    '1. 🚨 主動 Alert（如有 Tier 1/Tier 2 變數觸發 → 開頭立即寫，標題使用 🔴🔴）',
    '2. 🚦 燈號狀態（🟢/🟡/🟠/🔴 + 12 變數掃描表）',
    '3. 昨日收盤回顧（重點摘要，不超過 5 點）',
    '4. 今天事件提醒（按時序，含 Cross 該做的事）',
    '5. Cross 今日 Action（必做 / 不能做）',
    '6. INTJ Note（1-2 個關鍵邏輯轉折）',
    '',
    '不要超過 2,500 字。沒重要訊號就承認，不要硬塞。',
    '提到台股當前股價必先用 web_search 驗證。'
  ].filter(Boolean).join('\n');
}


function buildEveningPrompt(marketData) {
  const tz = 'Asia/Taipei';
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd EEE');
  const eventResults = getEventResultsToday();
  return [
    '# 今日盤後 daily post 任務',
    '',
    '## 當前時間',
    `${today} 22:00 台北時間`,
    '',
    '## 今日重大事件公布結果',
    eventResults,
    '',
    '## 今日完整數據',
    formatMarketData(marketData),
    `數據抓取時間：${marketData.fetched_at}`,
    marketData.warnings.length > 0 ? `⚠️ 抓取警告：${marketData.warnings.join(', ')}` : '',
    '',
    '## Cross portfolio 變化估算',
    estimatePortfolioChange(marketData),
    '',
    '## 任務',
    '請給 Cross 一份「今日盤後 daily post」，包含：',
    '1. 🚨 事件結果即時判讀（如有公布的 CPI/NFP/PPI/FOMC）',
    '2. 市場反應分析（vs 預期、vs 劇本）',
    '3. 🚦 12 變數燈號變化（vs 上次盤前）',
    '4. Cross portfolio 影響（具體部位 + 預估 NT$）',
    '5. 明日展望（重點事件 + 時間）',
    '6. 紀律檢查（是否該動 / 不該動）',
    '',
    '不要超過 2,500 字。最新美股 / 台股價位請用 web_search 確認。'
  ].filter(Boolean).join('\n');
}


function buildUrgentPrompt(triggerEvent, marketData) {
  return [
    '# 🚨 緊急 alert 任務',
    '',
    '## 觸發事件',
    `類型：${triggerEvent.type}`,
    `變數：${triggerEvent.variable}`,
    `當前值：${triggerEvent.current_value}`,
    `閾值：${triggerEvent.threshold}`,
    `時間：${triggerEvent.timestamp}`,
    '',
    '## 即時市場數據',
    formatMarketData(marketData),
    `抓取時間：${marketData.fetched_at}`,
    '',
    '## 任務',
    '請給 Cross 一份「緊急 alert」（簡短，< 1,500 字），包含：',
    '1. 🔴 一句話結論（這是什麼 + 為什麼重要）',
    '2. 對 Cross 部位的立即影響',
    '3. 是否需要 Cross 立即行動（YES/NO + 為什麼）',
    '4. 如 YES：具體 action（含口數、價位、預算上限）',
    '5. 如 NO：監控重點（什麼時候才該動）',
    '',
    '【強制】字數限制 1,500、INTJ 風格先結論、不要冗長分析、任何下單建議都符合紀律。'
  ].join('\n');
}


// ============================================================
// callClaudeAPI（含 retry / exponential backoff / web_search tool）
// ============================================================
/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {'default'|'urgent'} mode
 * @returns Anthropic API response object
 */
function callClaudeAPI(systemPrompt, userPrompt, mode) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = (mode === 'urgent')
    ? (props.getProperty('CLAUDE_MODEL_URGENT') || 'claude-opus-4-7')
    : (props.getProperty('CLAUDE_MODEL_DEFAULT') || 'claude-sonnet-4-6');
  const apiVersion = props.getProperty('ANTHROPIC_API_VERSION') || '2023-06-01';

  const payload = {
    model: model,
    max_tokens: (mode === 'urgent') ? 2000 : 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };

  // 全部 mode 都啟用 web_search（依 Cross 5/11 決策）
  // max_uses 限制：web_search round-trip 會把 prompt 重餵 → 控制 input token 爆量
  payload.tools = [{
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 2
  }];

  return _callClaudeWithRetry({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': apiVersion
    },
    payload: payload,
    model: model,
    mode: mode
  });
}


function _callClaudeWithRetry(cfg) {
  const maxRetries = 3;
  let lastErr = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = UrlFetchApp.fetch(cfg.url, {
        method: 'post',
        contentType: 'application/json',
        headers: cfg.headers,
        payload: JSON.stringify(cfg.payload),
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      const body = resp.getContentText();

      if (code === 200) {
        const json = JSON.parse(body);
        // 確保有 model 欄位給上層計成本
        if (!json.model) json.model = cfg.model;
        return json;
      }

      // 429 / 529 / 503 → 退避重試
      if (code === 429 || code === 529 || code === 503) {
        const wait = Math.pow(2, i) * 1000;
        console.warn(`[claude] ${code} retry in ${wait}ms (attempt ${i + 1}/${maxRetries})`);
        Utilities.sleep(wait);
        lastErr = new Error(`http_${code}: ${body.substring(0, 300)}`);
        continue;
      }

      // 其他錯誤直接 throw
      throw new Error(`Claude API ${code}: ${body.substring(0, 500)}`);
    } catch (e) {
      lastErr = e;
      if (i === maxRetries - 1) throw e;
      const wait = Math.pow(2, i) * 1000;
      console.warn(`[claude] exception "${e.message}" retry in ${wait}ms`);
      Utilities.sleep(wait);
    }
  }
  throw lastErr || new Error('claude_retry_exhausted');
}


// ============================================================
// validatePost — 品質檢查
// ============================================================
function validatePost(post) {
  const checks = {
    has_lampshade: /🟢|🟡|🟠|🔴/.test(post),
    has_tier_scan: /Tier\s*1|Tier\s*2|Tier\s*3|Tier\s*4|Tier\s*5/i.test(post),
    word_count: post.length >= 800 && post.length <= 4500,
    has_action: /Action|動作|要做|不能|建議|監控/.test(post),
    no_promotional: !/最棒|超強|absolutely amazing|excellent opportunity/i.test(post),
    no_outdated_position: !/1810.*1,?200/.test(post) && !/NFLX.*100\s*股/.test(post)
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  console.log(`[v6 validate] ${passed}/${total} pass ` + JSON.stringify(checks));
  return { ok: passed >= total - 1, passed: passed, total: total, checks: checks };
}


// ============================================================
// 主函式：dailyPostMorning / dailyPostEvening / dailyPostUrgent
// ============================================================
function dailyPostMorning() {
  _runDailyPost('morning', buildMorningPrompt, 'default');
}

function dailyPostEvening() {
  _runDailyPost('evening', buildEveningPrompt, 'default');
}

function dailyPostUrgent(triggerEvent) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.warn('[v6 urgent] lock_timeout');
    return;
  }
  try {
    // urgent 不檢查 alreadyPostedToday（一天可能多次不同類型）
    const quota = checkDailyQuota();
    if (!quota.ok) {
      sendTelegramLong(`⚠️ v6 urgent 略過：已達日成本上限 $${quota.cap}（已用 $${quota.spent}）`);
      logDailyPost({ mode: 'urgent', status: 'quota_exceeded', content: JSON.stringify(triggerEvent) });
      return;
    }

    const marketData = fetchMarketData();
    const systemPrompt = buildDynamicSystemPrompt();
    const userPrompt = buildUrgentPrompt(triggerEvent, marketData);

    const response = callClaudeAPI(systemPrompt, userPrompt, 'urgent');
    const post = extractClaudeText(response);

    const v = validatePost(post);
    if (!v.ok) {
      sendTelegramLong(`⚠️ v6 urgent 品質檢查未通過（${v.passed}/${v.total}），仍發出：\n\n${post}`);
    } else {
      sendTelegramLong(`🚨 [v6 URGENT] ${triggerEvent.type}\n\n${post}`);
    }

    logDailyPost({
      mode: 'urgent',
      model: response.model,
      tokens_input: response.usage && response.usage.input_tokens,
      tokens_output: response.usage && response.usage.output_tokens,
      cost_usd: calculateCost(response.usage, response.model),
      content: post,
      status: v.ok ? 'success' : 'low_quality'
    });
  } catch (err) {
    console.error('[v6 urgent]', err.message, err.stack);
    try { sendTelegramLong(`⚠️ v6 urgent 失敗：${err.message}`); } catch (_) {}
    logDailyPost({ mode: 'urgent', status: 'error', content: err.message });
  } finally {
    lock.releaseLock();
  }
}


function _runDailyPost(mode, promptBuilder, claudeMode) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.warn(`[v6 ${mode}] lock_timeout`);
    return;
  }
  try {
    if (alreadyPostedToday(mode)) {
      console.log(`[v6 ${mode}] already posted today, skip`);
      return;
    }
    const quota = checkDailyQuota();
    if (!quota.ok) {
      sendTelegramLong(`⚠️ v6 ${mode} 略過：已達日成本上限 $${quota.cap}（已用 $${quota.spent}）`);
      logDailyPost({ mode: mode, status: 'quota_exceeded' });
      return;
    }

    const marketData = fetchMarketData();
    const systemPrompt = buildDynamicSystemPrompt();
    const userPrompt = promptBuilder(marketData);

    const response = callClaudeAPI(systemPrompt, userPrompt, claudeMode);
    const post = extractClaudeText(response);

    const v = validatePost(post);
    const header = (mode === 'morning') ? '🌅 [v6 盤前]' : '🌙 [v6 盤後]';
    const body = v.ok ? `${header}\n\n${post}` : `${header} ⚠️ 品質 ${v.passed}/${v.total}\n\n${post}`;
    const sendRes = sendTelegramLong(body);
    if (!sendRes.ok) throw new Error(`Telegram send failed: ${sendRes.error}`);

    logDailyPost({
      mode: mode,
      model: response.model,
      tokens_input: response.usage && response.usage.input_tokens,
      tokens_output: response.usage && response.usage.output_tokens,
      cost_usd: calculateCost(response.usage, response.model),
      content: post,
      status: v.ok ? 'success' : 'low_quality'
    });

    // 盤後更新 last_market_data 給隔日 monitor 比對
    if (mode === 'evening') saveLastMarketData(marketData);
  } catch (err) {
    console.error(`[v6 ${mode}]`, err.message, err.stack);
    try { sendTelegramLong(`⚠️ v6 ${mode} 失敗：${err.message}`); } catch (_) {}
    logDailyPost({ mode: mode, status: 'error', content: err.message });
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// monitorUrgentTriggers — 每 30 分鐘 cron
// ============================================================
function monitorUrgentTriggers() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    const marketData = fetchMarketData();
    const last = getLastMarketData();

    // 第一次跑沒有 last → 寫入後 return
    if (!last) {
      saveLastMarketData(marketData);
      return;
    }

    const triggers = [];

    if (_num(marketData.vix) && _num(last.vix) && marketData.vix > last.vix * 1.10) {
      triggers.push({
        type: 'VIX_SPIKE',
        variable: 'VIX',
        current_value: marketData.vix,
        threshold: Number((last.vix * 1.10).toFixed(2)),
        timestamp: new Date().toISOString()
      });
    }

    if (_num(marketData.wti) && marketData.wti > 105) {
      triggers.push({
        type: 'OIL_SHOCK',
        variable: 'WTI',
        current_value: marketData.wti,
        threshold: 105,
        timestamp: new Date().toISOString()
      });
    }

    if (_num(marketData.ten_year) && marketData.ten_year > 4.5) {
      triggers.push({
        type: 'YIELD_SHOCK',
        variable: '10Y',
        current_value: marketData.ten_year,
        threshold: 4.5,
        timestamp: new Date().toISOString()
      });
    }

    if (_num(marketData.kre) && _num(last.kre) && marketData.kre < last.kre * 0.95) {
      triggers.push({
        type: 'BANK_STRESS',
        variable: 'KRE',
        current_value: marketData.kre,
        threshold: Number((last.kre * 0.95).toFixed(2)),
        timestamp: new Date().toISOString()
      });
    }

    if (_num(marketData.txf1) && _num(last.txf1)
        && Math.abs(marketData.txf1 - last.txf1) / last.txf1 > 0.015) {
      triggers.push({
        type: 'TXF1_GAP',
        variable: 'TXF1!',
        current_value: marketData.txf1,
        threshold: Number((last.txf1 * 0.015).toFixed(2)),
        timestamp: new Date().toISOString()
      });
    }

    // 觸發 → 5 分鐘內同類型不重發
    triggers.forEach(t => {
      if (!recentlyTriggered(t.type, 5)) {
        dailyPostUrgent(t);
        markTriggered(t.type);
      } else {
        console.log(`[v6 monitor] ${t.type} suppressed (recent)`);
      }
    });

    // 每次 monitor 結束更新 last（即使無觸發）
    saveLastMarketData(marketData);
  } catch (err) {
    console.error('[v6 monitor]', err.message, err.stack);
    // monitor 失敗不發 Telegram，避免洗版
  } finally {
    lock.releaseLock();
  }
}

function _num(v) {
  return typeof v === 'number' && isFinite(v) && v !== 0;
}


// ============================================================
// 手動測試入口
// ============================================================
function v6TestMorning()  { dailyPostMorning(); }
function v6TestEvening()  { dailyPostEvening(); }
function v6TestUrgent() {
  dailyPostUrgent({
    type: 'VIX_SPIKE',
    variable: 'VIX',
    current_value: 22.5,
    threshold: 20.0,
    timestamp: new Date().toISOString()
  });
}
function v6TestFetchData() {
  const d = fetchMarketData();
  console.log(JSON.stringify(d, null, 2));
  console.log('Warnings: ' + d.warnings.join(', '));
}
function v6TestSystemPrompt() {
  const sp = buildDynamicSystemPrompt();
  console.log(sp);
}
function v6TestQuota() {
  console.log(JSON.stringify(checkDailyQuota()));
}
