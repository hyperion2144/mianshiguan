# Requirements: mianshiguan

> Populated during grill phase. New milestones append to the top, completed milestones remain as history.
> Format: `## M<number>-<name> [CURRENT | COMPLETED]` — one section per milestone.

---

## M1-Initial [CURRENT]

### Functional Requirements

#### FR-1: Architecture — CLI 数据层 + Agent AI 层
- **Description**: CLI (`mi` 命令) 只做数据存储、题库管理、配置、本地网站服务。CLI 不调用任何 LLM。所有 AI 能力（出题、点评、评分、报告生成）通过 coding agent 自身的 LLM 能力实现。Agent skill 是薄壳，编排面试流程，通过 CLI 命令存取数据
- **Priority**: critical
- **Acceptance criteria**: CLI 可完全脱离 agent 独立运行（数据查询/网站）；agent skill 可通过 CLI 存储和读取面试数据

#### FR-2: CLI 命令集
- **Description**: 核心 CLI 命令：`mi interview`（开始面试/记录回答/结束）、`mi question`（题库增删查）、`mi resume`（简历增删改）、`mi report`（报告存取）、`mi dashboard`（启动本地网站）、`mi config`（配置管理）
- **Priority**: critical
- **Acceptance criteria**: 覆盖完整面试流程的 CLI 操作能力


#### FR-3: Skill/Command Agent Integration
- **Description**: mianshiguan 作为 CLI 核心 + 薄 agent skill 壳，通过 `/mianshi` 或自然语言触发。首批支持 omp, claude code, opencode
- **Priority**: critical
- **Acceptance criteria**: 在三种 agent 中均可通过 `/mianshi` 触发面试流程

#### FR-4: Interview Engine
- **Description**: 基于简历、岗位描述、项目经历的 AI 驱动真实面试。agent 扮演面试官提问并点评回答。混合模式：默认结构化（分阶段），可切换自由对话
- **Priority**: critical
- **Acceptance criteria**: 能根据简历生成个性化问题，面试官角色点评反馈

#### FR-5: Question Bank (Pluggable + Online Platform Adapters)
- **Description**: 可插拔题库系统。三层来源：① AI 实时生成（无配置时默认）② 本地题库文件/DB ③ 在线平台适配器（LeetCode、牛客网等）。Agent 在出题时可 `mi question search --source leetcode --tags array,difficulty:medium` 查询题目。在线平台适配器通过 API/爬虫获取题目摘要
- **Priority**: high
- **Acceptance criteria**: 支持至少一个在线平台（LeetCode）的题目搜索；适配器可插拔新增；未配置时全部 AI 生成

#### FR-6: Interview Recording & Storage
- **Description**: 所有面试过程、问题、回答、评分通过 CLI 存入 SQLite
- **Priority**: critical
- **Acceptance criteria**: 面试数据持久化，可回顾、查询

#### FR-7: Post-Interview Report
- **Description**: 面试结束后生成整体报告和优化方案，指出不足与改进方向。包含简历、项目问答、表述优化建议
- **Priority**: critical
- **Acceptance criteria**: 报告包含能力评估、知识点缺口、优化建议

#### FR-8: Local Dashboard Website
- **Description**: `mi dashboard` 启动本地静态网站，浏览面试记录、错题、优化建议、简历档案、生成报告
- **Priority**: high
- **Acceptance criteria**: 本地浏览器打开后可浏览所有历史数据

#### FR-9: Multi-Profile Support
- **Description**: 支持多 Profile 管理，每个 Profile 有独立的简历、目标岗位、面试记录。支持 Profile 间交叉对比（同方向不同时间的进步趋势）
- **Priority**: medium
- **Acceptance criteria**: 可切换 Profile、按 Profile 查看面试记录、交叉对比报告

#### FR-10: Interview Pause & Resume
- **Description**: 面试过程可随时中断，CLI 保存状态。再次触发 `/mianshi` 时 agent 检查是否有未完成的面试，询问是否继续
- **Priority**: medium
- **Acceptance criteria**: 中断后恢复可继续未完成的面试

#### FR-11: Resume Import & Management
- **Description**: 支持 Markdown 文件导入简历，也支持 PDF 简历（PDF 文本提取）。简历可增删改查
- **Priority**: high
- **Acceptance criteria**: `mi resume import --file` 支持 .md 和 .pdf；简历列表查看和管理

#### FR-12: Multi-Dimension Scoring
- **Description**: 多维度雷达图评分（技术深度、沟通表达、项目能力、系统思维、匹配度等）。每题评分 + 汇总雷达图展示在 dashboard 上
- **Priority**: high
- **Acceptance criteria**: 面试报告包含各维度分数和雷达图

#### FR-13: Mixed Question Types
- **Description**: 支持开放问答 + 代码题（agent 出编程场景，用户写代码）+ 选择题。Agent 根据面试阶段自动切换题型
- **Priority**: medium
- **Acceptance criteria**: 面试中出现至少两种题型

#### FR-14: Dashboard Detailed Views
- **Description**: Dashboard 包含 6+ 页面：总览统计、面试历史列表、面试详情、错题本（按知识点分类）、成绩趋势（雷达图时间序列）、Profile 管理、能力图谱热力图、成绩预测、导出 PDF 报告
- **Priority**: medium
- **Acceptance criteria**: Dashboard 可通过浏览器浏览所有预设视图

#### FR-15: Auto-Install to Coding Agents
- **Description**: `mi init` 自动检测当前环境（omp/claude code/opencode）并将 skill 文件安装到对应目录。`mi init --platform` 可强制指定。`--dry-run` 预览
- **Priority**: high
- **Acceptance criteria**: 三种平台自动安装到位，用户无需手动复制 skill 文件

#### FR-16: Database Migration
- **Description**: SQLite 使用 schema_version 表管理版本，CLI 升级时自动运行增量迁移脚本。用户无感知
- **Priority**: medium
- **Acceptance criteria**: CLI 版本升级后旧数据库自动迁移到新 schema

#### FR-17: Configurable Interviewer Style
- **Description**: 支持配置面试官风格：strict（严格）/ coaching（引导）/ friendly（友好）。`mi config set interviewer-style` 设置，skill prompt 据此调整语气
- **Priority**: low
- **Acceptance criteria**: 切换风格后 agent 面试语气相应变化


### Non-Functional Requirements

#### NFR-1: Tech Stack
- **Description**: CLI 用 Bun/Node.js 实现，SQLite (better-sqlite3) 存储。CLI 不调用任何 LLM。Dashboard 为 Bun 内置 HTTP 服务 + SPA。多维度雷达图评分。CLI 通过 npm 分发，附带多平台 skill 模板

### Constraints
- 数据全本地存储，不依赖云端服务（LLM API 除外）
- CLI 可脱离 agent 独立运行

### Success Criteria
- [ ] 三种 coding agent 中均可触发面试
- [ ] 完成一次完整面试流程（出题→回答→点评→报告）
- [ ] CLI 独立运行可查数据、开网站
- [ ] 题库可插拔配置


