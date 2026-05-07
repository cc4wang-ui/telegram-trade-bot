# Emergency Mobile Recovery — 推播斷線時手機 SOP

> 三天沒收到推播時用這份。完全手機可做，**不需要電腦**。

## 30 秒分流

照順序問自己：

| # | 問題 | 怎麼驗 | 結論 |
|---|---|---|---|
| 1 | Bot 本身活著嗎？ | 手機瀏覽器開 `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=ping` | 收到 ping → bot OK，跳 #2；401 → token revoke 了；404 → URL 格式或 bot 被刪 |
| 2 | GAS 有人在打嗎？ | 手機桌面模式開 [script.google.com](https://script.google.com) → 你的專案 → ☰ → Executions | 完全沒紀錄 → Routine 沒打進來，跳 #3；有紀錄但 Failed → 看 stack trace |
| 3 | Routine 還活著嗎？ | 手機開 [claude.ai/code/routines](https://claude.ai/code/routines) | 「Auto disabled」→ 連續失敗被砍，跳「修法 A」；不在清單 → 被刪了，照 `deploy-runbook.md` Phase 8 重建 |

## 修法 A — Routine auto-disabled

**通常代表 GAS 那邊回了 5xx 連續多次**。順序很重要：

### A1. 先修 GAS code（不修就 re-enable 也會再被砍）

最常見的 bug：`doPost` fall-through 呼叫不存在的函數（line 34 那個 `handleTelegramUpdate`）。本 repo 已修掉，**但你 GAS console 上的 code 可能還是舊版**。

手機桌面模式開 Apps Script editor → 找 `function doPost(e)` → **最後一行**：

```js
// 壞的（會 ReferenceError）：
return handleTelegramUpdate(e);

// 改成：
return jsonResp({ error: 'unknown_endpoint', endpoint: endpoint || null });
```

按右上 💾 存檔。

### A2. 重新部署 — **關鍵：URL 不能換**

新 deployment 會給新 URL，Routine 設定就要全部重設，很煩。**用 edit 既有 deployment 的方式更新 version**：

1. 右上 **Deploy** → **Manage deployments**
2. 找清單裡 type 是 **Web app** 那條 → 點右上 **✏️ Edit**（鉛筆）
3. **Version** 下拉 → 選 **New version**
4. Description 隨便寫（例：`fix doPost fallthrough 5/7`）
5. **Deploy**

→ 完成後 URL **完全沒變**，Routine 不用動。

> 如果你不小心按了 **New deployment**（在最上面），會給新 URL — 這時要去 Routines 兩條 secret 改 `GAS_WEBHOOK_URL`。

### A3. 同步 Routine 的 token（只在這次 fallback 401 出現時）

當 Routine log 出現 `Telegram Fallback: 401 Unauthorized`，代表 Routine secret 裡的 `TELEGRAM_BOT_TOKEN` 跟 GAS Script Properties 裡的真 token 不一致。

1. Apps Script → ⚙️ Project Settings → Script Properties
2. 複製 `TELEGRAM_BOT_TOKEN` 值
3. Routines → `daily-macro-snapshot` → Secrets → 改 `TELEGRAM_BOT_TOKEN` → 貼上
4. 同樣改 `earnings-watchlist`

### A4. Re-enable + Run now

兩條 routine 都 toggle 回 enabled → 各按一次 **Run now**：

| Routine | 1-2 min 內預期 |
|---|---|
| `daily-macro-snapshot` | Telegram 收到 🟢/🟡/🔴 燈號訊息 |
| `earnings-watchlist` | 收到 📅 財報訊息，或 log 顯示 `hits=0`（當天沒命中也算 OK）|

## 防呆：未來別讓它三天才知道

| 動作 | 設在哪 | 防什麼 |
|---|---|---|
| GAS time-driven trigger 每天 06:00 跑 `pingHealth` 推一句 `🟢 alive` | Apps Script Triggers | Routine 又掛了，至少有心跳能對照 |
| Routine secret rotate token 時，GAS + Routine **同時**更新（兩邊都改才算完） | 操作 SOP | token mismatch 像這次 fallback 401 |
| 每月 1 號手動 Run now 兩條 routine 一次 | 行事曆 reminder | 提早發現 auto-disable |

## 完全沒救時的 nuclear option

如果以上都試過還是沒推：

1. 確認 GAS Web App 的 **Who has access** 是 **Anyone**（不是 Anyone with Google account）
2. Apps Script → 選 `setupCheck` 函數 → Run → console 應印 `✅ 所有 Script Properties 已設定`；缺什麼補什麼
3. 跑 `testMacroSnapshot` → 應收到範例黃燈快照；沒收到代表 bot/token 端壞了，回到分流 #1

---

**這份的目的是讓你（沒電腦時）3 分鐘恢復推播**。長期穩定要靠「防呆」那節。
