# ADR 0011 — AI 任务信封、上下文身份与帮助闸门

日期：2026-10-03 ｜ 状态：已接受 ｜ 关联：docs/18、docs/19 §6 G1/G2/G6、docs/21 U23、TODO 111-01

## 背景
讲解类 AI 调用此前是"发消息、收文本"：响应期间切题/改答后，旧讲解会被当作当前反馈展示；strictMock 与未提交状态没有题目级帮助的统一拒绝点；通道错误以裸异常栈呈现；"实际发送了什么"不可核验。

## 决策
1. **任务信封**（`ai/task.ts`，docs/18 §2 协议子集）：每次调用产出 `{ taskId, templateId/version, status: ok|needsEvidence|needsReview|unsupported|failed, summary, data, contextHash, tokens }`——失败/超支/拒绝都是有类型结果，不抛出。
2. **G1 上下文身份**：`contextHash` 绑定 qid + 题面指纹（stem+options）+ 作答快照 + 提交状态 + 模式；改答/切题/改题后旧响应 `applyResult` 判 stale，不应用（历史按 qid 留草稿）。
3. **G6 帮助闸门**：strictMock 拒绝一切题目级帮助；未提交拒绝揭示型任务（explain），提示型（hint/socratic）放行。闸门在执行器内生效，UI 不可能绕过。
4. **发送可核验**：实际 payload（信封+完整消息）本地留存最近 20 次（`ai/task-log`），AI 视图可查看；预算闸门 `maxCalls` 超限直接拒绝不发请求。

## 后果
- 讲解/提示/苏格拉底三模板已接入；出题管线（gen.ts）与目标宿主接入点仍按 docs/19 Q5/Q6 演进，不强制同一时刻全覆盖。
- 结构化产物（needsEvidence 补槽、citations 校验）与输入预览 UI 属后续切片；模型自报信心不作为正确性证据。
- 发送记录仅存本地（同 AI 数据流承诺），不构成遥测。
