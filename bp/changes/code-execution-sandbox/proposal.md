# Proposal: code-execution-sandbox

## Intent

题库已有算法题和测试用例，但 Agent 面试时只能靠主观判断候选人答案质量。本 change 实现 Docker 容器化代码执行沙箱，让候选人写的代码能自动运行测试用例，验证正确性并计算评分。执行结果可融入面试报告，实现客观的算法题评估。

## Scope

### In Scope

- Docker CLI 子进程调用（`docker run <image> <code>`）
- 支持 JavaScript/TypeScript（`node:alpine`）和 Python（`python:alpine`）
- `mi question run <id> --code <file> --language <lang> [--json]` 独立执行命令
- 从题目库读取 `testCases`，运行测试用例，输出通过数/总数
- 自动计算通过率（passed/total）
- 评分结果融入面试报告（新增 `autoScore` 字段）
- 执行超时保护（默认 30s，可配置 `--timeout`）
- 错误输出捕获（编译错误、运行错误、超时）
- Docker 未安装时给出友好中文提示

### Out of Scope

- 容器网络访问
- 持久化容器管理
- 调试器/单步执行
- Java/C++/Go 等其他语言（v2 可加）
- 代码编辑器/IDE 集成

## Approach

通过 `Bun.spawn` 执行 `docker run --rm --network=none -i` 子进程，将用户代码通过 stdin 或挂载临时文件传入容器，在容器内运行测试用例并输出 JSON 格式结果。Docker 镜像预装运行时（node / python）。执行器（CodeRunner）作为独立服务模块，结果以 `CodeExecutionResult` 类型返回。`mi question run` CLI 调用执行器并输出结果。评分由现有 InterviewService 的 `recordAnswer` 或 Report 集成消费。

## Deliverables

### PR-1: Docker code execution engine

- **Source**: specs/code-execution/spec.md (new)
- **Behavior**: 系统 SHALL 通过 Docker CLI 子进程执行用户代码，支持 JS/TS 和 Python，运行测试用例后返回通过数/总数/错误信息/执行耗时
- **Verify**: `bun test src/services/code-runner.test.ts` 通过（mock docker 调用）
- **Files**: `src/services/code-runner.ts`、`src/services/code-runner.test.ts`

### PR-2: CLI command and report integration

- **Source**: specs/code-execution/spec.md (new)
- **Behavior**: 系统 SHALL 提供 `mi question run <id> --code <file> --language <lang>` 命令，执行题目测试用例并输出结果摘要或 JSON；执行结果 SHALL 可写入面试记录
- **Verify**: `mi question run <id> --code solution.py --language python --json` 返回 JSON 结果
- **Files**: `src/commands/question.ts`（修改）、`src/commands/question.test.ts`（追加）

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.4 - Hybrid Interview & Launch
