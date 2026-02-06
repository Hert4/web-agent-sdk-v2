# Các điểm học hỏi từ browser-use để apply vào web-agent-sdk-v2

## 1. Loop Detection và Anti-Stuck Mechanisms

### browser-use có:
- `loop_detection_window`: Track N steps gần nhất
- `loop_detector.record_action()`: Ghi nhận mỗi action thực hiện
- `loop_detector.record_page_state()`: Track URL + DOM fingerprint
- `get_nudge_message()`: Inject warning vào prompt khi detect loop
- `max_repetition_count`: Đếm số lần action lặp lại
- `consecutive_stagnant_pages`: Đếm số pages không thay đổi

### Cần apply:
```typescript
// Thêm LoopDetector class
class LoopDetector {
  private actionHistory: Array<{name: string, params: object}> = [];
  private pageStates: Array<{url: string, domHash: string}> = [];
  
  recordAction(name: string, params: object): void;
  recordPageState(url: string, domText: string): void;
  detectLoop(): boolean;
  getNudgeMessage(): string | null;
}
```

## 2. Planning với Plan Items

### browser-use có:
- `enable_planning`: Flag bật/tắt planning
- `plan_update`: Model có thể output plan mới
- `current_plan_item`: Index của item đang làm
- `PlanItem` với status: 'done' | 'current' | 'pending' | 'skipped'
- `_render_plan_description()`: Render plan thành text cho context
- `planning_replan_on_stall`: Trigger replan sau N failures
- `planning_exploration_limit`: Yêu cầu plan sau N steps không có plan

### Cần apply:
- Cho phép navigator output plan và track progress
- Inject plan status vào mỗi step

## 3. Self-Evaluation Previous Goal

### browser-use có:
- `evaluation_previous_goal`: Model tự đánh giá action trước
- Phải explicit state: "Success", "Failure", hoặc "Uncertain"
- Log với màu khác nhau: Green (success), Red (failure)

### Cần apply:
- Yêu cầu model output `evaluationPreviousAction` trong mỗi step
- Parse và log với màu

## 4. Memory System

### browser-use có:
- `memory` field trong output: 1-3 câu về progress
- `long_term_memory` trong ActionResult
- File system để persist data giữa các steps

### Cần apply:
- Thêm memory field vào navigator output
- Accumulate memory qua các steps

## 5. Budget Warning và Force Done

### browser-use có:
- `_inject_budget_warning()`: Warn khi dùng >= 75% steps
- `_force_done_after_last_step()`: Ép model gọi done ở step cuối
- `_force_done_after_failure()`: Ép done sau max_failures

### Cần apply:
```typescript
if (currentStep >= maxSteps * 0.75) {
  context += `\nBUDGET WARNING: You have used ${currentStep}/${maxSteps} steps...`;
}
```

## 6. Consecutive Failures Tracking

### browser-use có:
- `state.consecutive_failures`: Đếm failures liên tiếp
- Reset về 0 khi success
- Abort sau `max_failures + 1` (extra cho final response)

### Đã apply: ✅

## 7. Action Execution với Page Change Detection

### browser-use có:
- `multi_act()`: Execute multiple actions sequentially
- Capture `pre_action_url` và `pre_action_focus` trước action
- So sánh sau action -> abort remaining nếu page changed
- `terminates_sequence` flag cho actions như navigate, go_back

### Cần apply:
- Track page state trước/sau mỗi action
- Skip remaining actions nếu page changed

## 8. Popup/Modal Handling

### browser-use trong prompt:
> "Handle popups, modals, cookie banners, and overlays immediately before attempting other actions"

### Cần apply:
- Thêm instruction trong prompt
- Có thể auto-detect và handle

## 9. Fallback LLM

### browser-use có:
- `fallback_llm`: Backup LLM khi primary fail
- `_try_switch_to_fallback_llm()`: Auto switch on rate limit/error
- Track `_using_fallback_llm` flag

### Cần apply:
```typescript
config: {
  llm: {...},
  fallbackLlm?: {...},
}
```

## 10. Step Timeout

### browser-use có:
- `step_timeout`: Timeout cho mỗi step (default 180s)
- `llm_timeout`: Timeout riêng cho LLM call
- Wrap step execution trong `asyncio.wait_for()`

### Cần apply:
```typescript
const result = await Promise.race([
  this.executeStep(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Step timeout')), this.config.stepTimeout)
  )
]);
```

## 11. Demo Mode / Debug Logging

### browser-use có:
- `demo_mode`: Show overlay trong browser
- `_demo_mode_log()`: Send logs to browser overlay
- Detailed step logging với emoji và colors

### Cần apply:
- Improve debug logging
- Event emitter cho real-time updates

## 12. Judge / Self-Verification

### browser-use có:
- `use_judge`: Flag để enable judge
- `_run_simple_judge()`: Quick check if agent overclaims success
- `_judge_trace()`: Full evaluation của entire run

### Cần apply:
- Thêm verification step trước khi return success
- Check if model's claimed success matches reality

## 13. System Prompt Best Practices

### Các sections hay:
- `<browser_rules>`: Chi tiết cách interact với browser
- `<efficiency_guidelines>`: Khi nào chain actions
- `<error_recovery>`: Explicit error handling instructions
- `<pre_done_verification>`: Checklist trước khi done
- `<critical_reminders>`: Numbered list các điểm quan trọng

### Key insights từ prompt:
1. "NEVER assume success - always verify from screenshot or browser state"
2. "If blocked by captcha/login/403, try alternative approaches rather than retrying"
3. "Track progress in memory to avoid loops"
4. "If action fails repeatedly (2-3 times), try an alternative approach"
5. "Detect and break out of unproductive loops"

## Priority để Apply

### High Priority (nên làm ngay):
1. ✅ Consecutive failures tracking (đã có từ trước)
2. ✅ Loop detection (đã có: noProgressCount + isDuplicateAction)
3. ✅ Budget warning injection (đã apply: warn khi >=75% steps)
4. ✅ Self-evaluation previous action (đã apply: evaluationPreviousAction field)
5. ✅ Memory tracking (đã apply: memory field trong response)
6. ✅ Error recovery strategies (đã apply: chi tiết trong prompt)

### Medium Priority (có thể làm sau):
7. Step/LLM timeout
8. Fallback LLM
9. Judge/verification

### Low Priority:
11. Planning system phức tạp
12. Demo mode overlay
13. File system persistence

---

## Đã Apply (2026-02-06)

### BrowserNavigationAgent.ts:

1. **ActionDecision interface**: Thêm 3 fields mới
   - `evaluationPreviousAction`: Self-eval Success/Failure/Uncertain
   - `memory`: Track progress 1-3 sentences
   - `nextGoal`: Statement of immediate goal

2. **System prompt cải tiến**:
   - Yêu cầu output evaluationPreviousAction, memory, nextGoal
   - Chi tiết error recovery strategies
   - NEVER ASSUME SUCCESS rule
   - Loop detection warning

3. **Budget warning**:
   - Inject warning khi dùng >= 75% steps
   - Hiển thị steps còn lại
   - Khuyến khích fail sớm nếu không thể hoàn thành

4. **Prompt improvements**:
   - Đánh dấu failed actions rõ ràng hơn
   - Warning khi có nhiều failures
   - Structured decision section

5. **Page change detection**:
   - Track preActionUrl trước khi execute
   - So sánh với postActionUrl sau action
   - Log khi page changed

### Example 02-ecommerce-playwright.ts:

1. **Screenshot sau mỗi action**:
   - Sử dụng Playwright `page.screenshot()` trực tiếp
   - Lưu vào thư mục `screenshots/` với format `step_XXX_action_timestamp.png`
   - Log filename ra console
