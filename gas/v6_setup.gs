/**
 * Telegram Bot v6 — Setup & Cron 安裝
 *
 * 部署後依序執行：
 *   1. setupV6Check()          檢查 Script Properties / 建立 v6 sheets
 *   2. initV6MemorySheet()     從 docs/v6-memory-template.csv 結構初始化（首次部署用，冪等）
 *   3. setupV6Triggers()       裝 cron（08:00 morning、22:00 evening、每 30min monitor）
 *
 * 解除：unsetupV6Triggers() 移除 v6 cron（不影響 v5 webhook / earnings）
 */


// ============================================================
// 1. setupV6Check — 驗證 Script Properties + 建立 v6 sheets
// ============================================================
function setupV6Check() {
  const props = PropertiesService.getScriptProperties();
  const required = [
    'ANTHROPIC_API_KEY',
    'TELEGRAM_BOT_TOKEN',    // 沿用 v5
    'TELEGRAM_CHAT_ID',      // 沿用 v5
    'MACRO_SHEET_ID'         // 沿用 v5
  ];
  const missing = required.filter(k => !props.getProperty(k));
  if (missing.length > 0) {
    console.log('⚠ 缺少 Script Properties:');
    missing.forEach(k => console.log('  - ' + k));
    console.log('\n設定方法：Project Settings → Script properties → Add property');
    return;
  }
  console.log('✅ 必要 Script Properties 已設定');

  // 預設值（若無）
  const defaults = {
    CLAUDE_MODEL_DEFAULT: 'claude-sonnet-4-6',
    CLAUDE_MODEL_URGENT: 'claude-opus-4-7',
    ANTHROPIC_API_VERSION: '2023-06-01',
    V6_DAILY_QUOTA_USD: '0.30'
  };
  Object.keys(defaults).forEach(k => {
    if (!props.getProperty(k)) {
      props.setProperty(k, defaults[k]);
      console.log(`  → 自動設定 ${k} = ${defaults[k]}`);
    } else {
      console.log(`  ✅ ${k} = ${props.getProperty(k)}`);
    }
  });

  // 建立 v6 sheets
  const ss = SpreadsheetApp.openById(props.getProperty('MACRO_SHEET_ID'));
  const sheets = {
    memory: ['memory_num', 'content', 'updated_at', 'enabled'],
    daily_log: ['timestamp', 'mode', 'model', 'tokens_input', 'tokens_output',
                'cost_usd', 'content', 'status'],
    events: ['date', 'time', 'event', 'importance', 'note'],
    last_market_data: ['fetched_at', 'spx', 'nasdaq', 'vix', 'wti', 'ten_year',
                       'dxy', 'kre', 'tips_be', 'five_y_five_y', 'taiex',
                       'hy_spread', 'txf1']
  };
  Object.keys(sheets).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(sheets[name]);
      console.log(`✅ 建立 sheet "${name}"`);
    } else {
      console.log(`✅ Sheet "${name}" OK`);
    }
  });

  console.log('\n下一步：');
  console.log('  1. initV6MemorySheet() 預填 18 條 memory（Cross 自行補內容）');
  console.log('  2. v6TestFetchData() 確認 FRED/Yahoo 抓得到');
  console.log('  3. v6TestMorning() 手動跑一次 morning post');
  console.log('  4. setupV6Triggers() 上線 cron');
}


// ============================================================
// 2. initV6MemorySheet — 預填 18 條 memory（標題 + 占位）
// ============================================================
function initV6MemorySheet() {
  const ss = _openV6Sheet();
  if (!ss) throw new Error('MACRO_SHEET_ID not set');
  const sh = ss.getSheetByName('memory');
  if (!sh) throw new Error('memory sheet 不存在 → 先跑 setupV6Check()');

  if (sh.getLastRow() >= 2) {
    console.log(`ℹ memory sheet 已有 ${sh.getLastRow() - 1} 列資料 → 略過初始化`);
    console.log('  如需重置請手動清空後重跑');
    return;
  }

  // 從附錄 A 抽出的 18 條標題（Cross 自行補完整內容）
  const seed = [
    [1,  '台股價格驗證鐵則（訓練資料落後 6-12 月，必先 web_search）', '2026-05-11', true],
    [2,  '財務分析順序（搜即時價→搜財報→算 PE→跑五條件→建表）',           '2026-05-11', true],
    [3,  'Portfolio 5/3 三筆出清後（自由 NVDA15/NFLX50/QQQ10/VTI10；元大美股 VOO18/IXC60；元大港股 9660 16800；元大台股 2330 1018/006208 34/00632R 14067；信託 2330 ~910/006208 ~3500/QQQ ~28/2382 全/00956 全不能動）',
                                                                          '2026-05-11', true],
    [4,  'Pine 陷阱清單（v10 訊號注意項，詳見 Auto-trade）',                  '2026-05-11', true],
    [5,  '自動化交易計畫（IB 入金中）',                                         '2026-05-11', true],
    [6,  'Project Knowledge 索引（cpi-sop / hedge-decision-tree / playbook / uncontrollable-monitor / warsh-failure / private-credit-watch / earnings-tracking）',
                                                                          '2026-05-11', true],
    [7,  'Telegram Bot v5 已上線（API key 不 rotate 已接受）',                  '2026-05-11', true],
    [8,  '1810 D+ 全程已完成 -NT$207K',                                       '2026-05-11', true],
    [9,  'TradingView Essential 限制（alert 條數、watchlist 上限）',           '2026-05-11', true],
    [10, '5/15 規則補位已執行完畢（NT$80 萬 TWD 現金底線）',                    '2026-05-11', true],
    [11, '量子投資計畫 5/16+ 啟動（預算 NT$50-67 萬）',                          '2026-05-11', true],
    [12, '日期錨定鐵則（提到日期必先確認當前 = 2026-05-11，不要憑訓練資料推斷）', '2026-05-11', true],
    [13, '4/29 市場讀數（基準線，比較今日變化用）',                              '2026-05-11', true],
    [14, '財報追蹤規則 (含 PLTR、NFLX、NVDA)',                                  '2026-05-11', true],
    [15, 'v10 期貨做空訊號（5/12 CPI 是最大 trigger）',                          '2026-05-11', true],
    [16, 'Warsh 12 不可控變數監控（Tier 1-5 燈號）',                             '2026-05-11', true],
    [17, 'portfolio/做多/加倉強制檢查（任何加倉前先確認可動現金 + 規則狀態）',     '2026-05-11', true],
    [18, '主動 Alert 規則（Tier 1/Tier 2 觸發 → 開頭 🔴🔴 立即寫）',              '2026-05-11', true]
  ];
  seed.forEach(row => sh.appendRow(row));
  console.log(`✅ 預填 18 條 memory（D 欄全部 TRUE = 啟用）`);
  console.log('  Cross 請至 sheet 補完整內容，特別 #3 / #6 / #13');
}


// ============================================================
// 3. setupV6Triggers — 安裝 v6 cron
// ============================================================
/**
 * 三個 trigger：
 *   - dailyPostMorning      08:00 Asia/Taipei
 *   - dailyPostEvening      22:00 Asia/Taipei
 *   - monitorUrgentTriggers 每 30 分鐘
 *
 * 不動 v5 既有 trigger（v5 沒有 time-based trigger，純 webhook）。
 * 重複執行此函式不會疊加：先清掉自己安裝過的同名 trigger。
 */
function setupV6Triggers() {
  const v6Funcs = ['dailyPostMorning', 'dailyPostEvening', 'monitorUrgentTriggers'];

  // 清除 v6 既有 trigger（保留其他）
  ScriptApp.getProjectTriggers().forEach(t => {
    if (v6Funcs.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      console.log(`  → 移除舊 trigger ${t.getHandlerFunction()}`);
    }
  });

  // morning 08:00
  ScriptApp.newTrigger('dailyPostMorning')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Taipei')
    .create();
  console.log('✅ dailyPostMorning  @ 08:00 Asia/Taipei');

  // evening 22:00
  ScriptApp.newTrigger('dailyPostEvening')
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .inTimezone('Asia/Taipei')
    .create();
  console.log('✅ dailyPostEvening  @ 22:00 Asia/Taipei');

  // monitor 每 30 分鐘
  ScriptApp.newTrigger('monitorUrgentTriggers')
    .timeBased()
    .everyMinutes(30)
    .create();
  console.log('✅ monitorUrgentTriggers @ every 30 min');

  console.log('\n已安裝 3 個 v6 trigger，可至 Apps Script → Triggers 確認');
}


function unsetupV6Triggers() {
  const v6Funcs = ['dailyPostMorning', 'dailyPostEvening', 'monitorUrgentTriggers'];
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (v6Funcs.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  console.log(`✅ 已移除 ${removed} 個 v6 trigger`);
}


// ============================================================
// listV6Triggers — 列出當前 v6 trigger 狀態
// ============================================================
function listV6Triggers() {
  const v6Funcs = ['dailyPostMorning', 'dailyPostEvening', 'monitorUrgentTriggers'];
  const all = ScriptApp.getProjectTriggers();
  console.log(`Project 共 ${all.length} 個 trigger：`);
  all.forEach(t => {
    const isV6 = v6Funcs.indexOf(t.getHandlerFunction()) >= 0 ? '[v6]' : '    ';
    console.log(`  ${isV6} ${t.getHandlerFunction()} / ${t.getEventType()} / ${t.getUniqueId()}`);
  });
}
