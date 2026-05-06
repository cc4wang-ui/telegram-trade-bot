# telegram-trade-bot

Cross 個人交易系統的 Telegram bot 推播服務。GAS Web App 多 endpoint + Claude Code Routine 排程 + Telegram bot 推播。

## 架構

```
TradingView Pine alert ──┐
                          ▶ GAS Web App (多 endpoint) ──▶ Telegram
Claude Code Routine ─────┘
```

## 入口

- 部署：`docs/deploy-runbook.md`（完整版）/ `docs/deploy-mobile-wf2-5.md`（手機版）
- 設計：`docs/wf234-dispatch.md`
- GAS source：`gas/`
- Routine prompts：`prompts/`

## 相關 repo

- Pine 策略 + Macro Routine prompt：[cc4wang-ui/Auto-trade](https://github.com/cc4wang-ui/Auto-trade)
