# Dexter Web 測試計劃

## 測試目標
- 達到 >70% 程式碼覆蓋率
- 確保前後端整合穩定
- 驗證 UI/UX 功能完整性
- 保證 WebSocket 實時通訊可靠性

## 測試環境
- **Node Runtime**: Bun v1.0+
- **測試框架**:
  - Jest + ts-jest (單元測試/整合測試)
  - Playwright (E2E 測試)
  - React Testing Library (組件測試)
- **測試工具**:
  - Supertest (API 測試)
  - MSW (Mock Service Worker - API mocking)
  - @testing-library/jest-dom
  - @testing-library/user-event

---

## Phase 1: 前端單元測試 (Week 1 開始)

### 1.1 Store 測試
**檔案**: `src/stores/__tests__/`

#### sessionStore.test.ts
- ✅ 初始狀態驗證
- ✅ setCurrentSession() - 設定當前會話
- ✅ addSession() - 新增會話
- ✅ addMessage() - 新增訊息
- ✅ updateMessage() - 更新訊息狀態
- ✅ setProcessing() - 更新處理狀態
- ✅ clearMessages() - 清空訊息
- ✅ 不可變性測試 (immutability)

#### uiStore.test.ts
- ✅ 初始狀態驗證
- ✅ toggleSidebar() - 切換側邊欄
- ✅ 響應式行為測試

### 1.2 Hooks 測試
**檔案**: `src/hooks/__tests__/`

#### useAuth.test.ts
- ✅ 註冊流程
- ✅ 登入流程
- ✅ 登出流程
- ✅ Token 刷新邏輯
- ✅ 錯誤處理
- ✅ Loading 狀態管理

#### useSessions.test.ts
- ✅ 取得會話列表
- ✅ 建立新會話
- ✅ 切換會話
- ✅ 刪除會話
- ✅ React Query 快取行為

#### useQuery.test.ts
- ✅ 提交查詢
- ✅ WebSocket 連線
- ✅ 實時事件接收
- ✅ 錯誤處理
- ✅ 取消查詢
- ✅ 重新連線邏輯

#### useModels.test.ts
- ✅ 取得模型列表
- ✅ 按 provider 分組
- ✅ 快取策略

### 1.3 組件測試
**檔案**: `src/components/**/__tests__/`

#### Chat/MessageItem.test.tsx
- ✅ 渲染 UserMessage
- ✅ 渲染 AgentMessage
- ✅ Markdown 內容渲染
- ✅ 程式碼語法高亮
- ✅ 時間戳格式化

#### Chat/InputBox.test.tsx
- ✅ 輸入功能
- ✅ Enter 送出訊息
- ✅ Shift+Enter 換行
- ✅ 禁用狀態 (isProcessing)
- ✅ 清空輸入欄位

#### Chat/WorkingIndicator.test.tsx
- ✅ 顯示/隱藏邏輯
- ✅ 動畫效果

#### Agent/AgentEventItem.test.tsx
- ✅ thinking 事件渲染
- ✅ tool_start 事件渲染
- ✅ tool_end 事件渲染 (含執行時間)
- ✅ tool_error 事件渲染
- ✅ done 事件渲染 (含統計資訊)

#### Sidebar/Sidebar.test.tsx
- ✅ 會話列表渲染
- ✅ 新增會話按鈕
- ✅ 切換會話
- ✅ 刪除會話確認
- ✅ 空狀態顯示

#### MainLayout.test.tsx
- ✅ 側邊欄切換
- ✅ 響應式佈局
- ✅ 子組件整合

### 1.4 Services 測試
**檔案**: `src/services/__tests__/`

#### api.test.ts
- ✅ API client 初始化
- ✅ JWT token 注入
- ✅ Token 自動刷新
- ✅ 錯誤攔截器
- ✅ Retry 邏輯

#### websocket.test.ts
- ✅ WebSocket 連線
- ✅ 認證流程
- ✅ 訂閱事件
- ✅ 取消訂閱
- ✅ 自動重連
- ✅ 錯誤處理

---

## Phase 2: 後端 API 測試 (Week 2 開始 - 等後端完成)

### 2.1 認證端點測試
**檔案**: `backend/__tests__/auth.test.ts`

- ✅ POST /api/auth/register - 註冊新用戶
- ✅ POST /api/auth/login - 登入
- ✅ POST /api/auth/logout - 登出
- ✅ POST /api/auth/refresh - 刷新 token
- ✅ 錯誤情境:
  - 重複註冊
  - 錯誤密碼
  - 無效 token
  - 過期 token

### 2.2 會話端點測試
**檔案**: `backend/__tests__/sessions.test.ts`

- ✅ GET /api/sessions - 取得會話列表
- ✅ POST /api/sessions - 建立會話
- ✅ GET /api/sessions/:id - 取得單一會話
- ✅ PATCH /api/sessions/:id - 更新會話
- ✅ DELETE /api/sessions/:id - 刪除會話
- ✅ 權限驗證 (只能操作自己的會話)

### 2.3 查詢端點測試
**檔案**: `backend/__tests__/queries.test.ts`

- ✅ POST /api/queries - 提交查詢
- ✅ GET /api/queries/:id - 查詢狀態
- ✅ DELETE /api/queries/:id - 取消查詢
- ✅ GET /api/queries/:id/events - 取得事件記錄

### 2.4 模型端點測試
**檔案**: `backend/__tests__/models.test.ts`

- ✅ GET /api/models - 取得模型列表
- ✅ GET /api/models/:provider/:modelId - 模型詳情

### 2.5 用戶端點測試
**檔案**: `backend/__tests__/users.test.ts`

- ✅ GET /api/users/me - 取得用戶資訊
- ✅ PATCH /api/users/me - 更新用戶資訊
- ✅ POST /api/users/me/api-keys - 新增 API key
- ✅ DELETE /api/users/me/api-keys/:keyId - 刪除 API key

### 2.6 WebSocket 測試
**檔案**: `backend/__tests__/websocket.test.ts`

- ✅ 連線認證
- ✅ subscribe 事件
- ✅ unsubscribe 事件
- ✅ cancel 事件
- ✅ 實時事件推送
- ✅ 多客戶端同時連線
- ✅ 錯誤處理

---

## Phase 3: 整合測試 (Week 2)

### 3.1 前後端整合測試
**檔案**: `integration/__tests__/`

#### query-flow.test.ts
- ✅ 完整查詢流程:
  1. 用戶提交查詢
  2. 建立 WebSocket 連線
  3. 接收實時事件
  4. 顯示 agent 執行過程
  5. 完成並顯示結果

#### session-management.test.ts
- ✅ 建立會話
- ✅ 多會話切換
- ✅ 訊息持久化
- ✅ 刪除會話

#### auth-flow.test.ts
- ✅ 註冊 → 登入 → 使用 API → 登出
- ✅ Token 過期後自動刷新
- ✅ 刷新失敗後重新登入

---

## Phase 4: E2E 測試 (Week 2)

### 4.1 Playwright E2E 測試
**檔案**: `e2e/`

#### auth.spec.ts
- ✅ 註冊新用戶
- ✅ 登入/登出
- ✅ 未登入時重定向

#### chat.spec.ts
- ✅ 發送查詢
- ✅ 查看實時回應
- ✅ Markdown 渲染正確
- ✅ 程式碼區塊顯示

#### sessions.spec.ts
- ✅ 建立新會話
- ✅ 切換會話
- ✅ 刪除會話
- ✅ 側邊欄展開/收合

#### agent-events.spec.ts
- ✅ 顯示 thinking 事件
- ✅ 顯示 tool call 事件
- ✅ 顯示執行統計

#### keyboard-shortcuts.spec.ts
- ✅ Enter 送出
- ✅ Shift+Enter 換行
- ✅ Esc 取消 (if implemented)

#### responsive.spec.ts
- ✅ 手機版佈局
- ✅ 平板版佈局
- ✅ 桌面版佈局
- ✅ 側邊欄響應式行為

---

## Phase 5: 性能測試 (Week 2 後期)

### 5.1 負載測試
- ✅ 同時 100 個 WebSocket 連線
- ✅ 每秒 1000 個 API 請求
- ✅ 長時間運行穩定性

### 5.2 前端性能測試
- ✅ 初始載入時間
- ✅ 大量訊息渲染性能
- ✅ WebSocket 事件處理延遲
- ✅ 記憶體洩漏檢測

---

## 測試執行計劃

### Week 1 (前端完成後 - 現在可開始)
- [ ] 安裝測試依賴
- [ ] 設定 Jest 配置
- [ ] 撰寫 Store 測試
- [ ] 撰寫 Hooks 測試
- [ ] 撰寫組件測試
- [ ] 撰寫 Services 測試 (with mocks)

### Week 2 (後端完成後)
- [ ] 後端 API 測試
- [ ] WebSocket 測試
- [ ] 前後端整合測試
- [ ] E2E 測試
- [ ] 性能測試

---

## 測試覆蓋率目標

| 類別 | 目標覆蓋率 |
|-----|---------|
| Store | >90% |
| Hooks | >85% |
| Components | >80% |
| Services | >90% |
| API Routes | >85% |
| 整體專案 | >70% |

---

## 測試報告

測試完成後將產生:
1. **覆蓋率報告**: `coverage/lcov-report/index.html`
2. **E2E 測試報告**: `playwright-report/index.html`
3. **性能測試報告**: `performance-report.md`

---

## CI/CD 整合

### GitHub Actions
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test
      - run: bun run test:e2e
      - uses: codecov/codecov-action@v3
```

---

## 工具和依賴清單

### 需安裝的測試依賴
```json
{
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.1.0",
    "@testing-library/user-event": "^14.5.0",
    "msw": "^2.0.0",
    "supertest": "^6.3.0",
    "vitest": "^1.0.0" // 或繼續使用 Jest
  }
}
```

---

## 測試原則

1. **隔離性**: 每個測試獨立執行，不依賴其他測試
2. **可重複性**: 測試結果一致，不受執行順序影響
3. **快速執行**: 單元測試 < 10s，整合測試 < 1min，E2E < 5min
4. **清晰命名**: 測試名稱描述測試內容和預期結果
5. **適當 Mock**: 外部依賴使用 mock，避免網路請求

---

## 聯絡資訊

**測試專員**: tester
**開始日期**: 2026-02-11
**預計完成**: Week 2 結束 (約 2 週)
