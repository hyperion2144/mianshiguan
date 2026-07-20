# mianshiguan

AI 面试教练 CLI — 通过模拟面试帮助求职者提升面试能力。

## 安装

```bash
npm install -g mianshiguan
```

或使用 Bun：

```bash
bun install -g mianshiguan
```

## 快速开始

```bash
# 初始化
mi init

# 创建 Profile
mi profile create "Senior Frontend Engineer"

# 导入简历
mi resume-import ./my-resume.md

# 开始面试
mi interview start --role "Senior FE" --style coaching

# 查看状态
mi interview status

# 评分
mi interview score --depth 8 --expression 7 --project 9 --system 7 --match 8

# 生成报告
mi interview report <id>
```

## 命令参考

### 初始化与环境

| 命令 | 说明 |
|------|------|
| `mi init` | 初始化数据目录与数据库 |
| `mi config get <key>` | 查看配置 |
| `mi config set <key> <value>` | 修改配置 |
| `mi config list` | 查看所有配置 |

### Profile 管理

| 命令 | 说明 |
|------|------|
| `mi profile create <name>` | 创建 Profile |
| `mi profile list` | 查看 Profile 列表 |
| `mi profile show` | 查看当前 Profile |
| `mi profile update <field> <value>` | 更新 Profile |
| `mi profile switch <id>` | 切换 Profile |

### 简历管理

| 命令 | 说明 |
|------|------|
| `mi resume-import <file>` | 导入简历（支持 .md / .pdf）|
| `mi resume-show` | 查看当前简历 |
| `mi resume-history` | 查看简历历史 |

### 面试管理

| 命令 | 说明 |
|------|------|
| `mi interview start --role <role>` | 开始面试 |
| `mi interview status` | 查看当前面试状态 |
| `mi interview pause` | 暂停面试 |
| `mi interview resume` | 恢复面试 |
| `mi interview list` | 查看历史面试 |
| `mi interview score --depth N ...` | 评分当前题目 |
| `mi interview report <id>` | 生成面试报告 |

### 题库管理

| 命令 | 说明 |
|------|------|
| `mi question search <keyword>` | 搜索题目 |
| `mi question list` | 列出题目 |
| `mi question show <id>` | 查看题目详情 |
| `mi question import <file>` | 导入题目（JSON/YAML）|
| `mi question fetch leetcode [--limit N]` | 从 LeetCode 抓取题目 |
| `mi question fetch niuke [--limit N]` | 从牛客网抓取题目 |
| `mi question run <id> --code <file> --language <lang>` | 运行代码测试用例 |

## 功能特性

- **Profile 管理** — 管理多个面试 Profile
- **简历导入** — 支持 Markdown 和 PDF 格式
- **模拟面试** — 5 状态生命周期，支持暂停/恢复
- **5 维评分** — 技术深度、沟通表达、项目能力、系统思维、岗位匹配
- **外部题库** — 支持 LeetCode 和牛客网题目采集
- **混合出题** — Agent 可在面试中从题库抽题
- **代码执行** — Docker 沙箱运行算法测试用例
- **自动评分** — 代码执行结果自动写入面试报告
- **多平台** — 支持 OMP / Claude Code / Codex CLI

## 配置

配置文件位于 `~/.config/mianshiguan/config.yml`：

```yaml
dataDir: ~/.config/mianshiguan/data
interviewerStyle: coaching       # strict | coaching | friendly
questionSource: mixed            # agent-first | bank-first | mixed
```

## License

MIT
