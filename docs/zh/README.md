# slopgate 中文说明

`slopgate` 是一个面向 AI 生成代码的**精度优先**结构检查器，支持 Python、TypeScript/JavaScript、Go 和 Rust。它只报告能由 AST 和项目上下文证明的问题，默认只显示 `high` confidence。

## 安装

```bash
npx @voidh4x0r/slopgate .
npm install -D @voidh4x0r/slopgate
npx @voidh4x0r/slopgate init
```

## 常用命令

```bash
slopgate .                         # 扫描当前目录
slopgate . --format json           # 机器可读输出
slopgate . --format sarif          # SARIF 2.1.0
slopgate . --diff origin/main      # 只检查新增行
slopgate . --write-baseline        # 接受当前存量问题
slopgate . --fix                   # 应用安全修复（不可达代码）
slopgate mcp                       # 作为 MCP server 运行
```

## 配置

`.slopgate.json` 支持：

```json
{
  "$schema": "https://raw.githubusercontent.com/VoidH4x0r/slopgate/main/schema/slopgate.schema.json",
  "include": ["src/**", "tests/**"],
  "exclude": ["vendor/**"],
  "ignoreModules": ["my_private_pkg"],
  "rules": { "ts/swallowed-exception": "off" },
  "confidence": "high",
  "failOn": "high"
}
```

未知 key 会以 exit 2 失败。

## 规则

完整规则列表见 [docs/rules.md](../rules.md)。核心规则：

- phantom import：未声明的依赖；
- noop test：不能失败的测试；
- stub body：占位函数；
- swallowed error：吞掉异常；
- unreachable：不可达代码；
- duplicate-block / semantic-duplicate：跨文件重复。

## 精度原则

- 只显示默认 high；medium/low 需显式 `--confidence`；
- 每条规则都有 negative test；
- 无法确认时降低 confidence，不猜测；
- 测试、生成文件、平台文件按规则跳过。

## 编码契约

所有文本使用 UTF-8、无 BOM；英文 docs 只允许白名单排版字符，中文 docs 放在 `docs/zh/`。详见 [docs/encoding.md](../encoding.md)。

## 发布与支持

当前版本以仓库 `package.json` 为准。问题请提交到 GitHub Issues。
