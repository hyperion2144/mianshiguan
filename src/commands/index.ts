import type { CAC } from 'cac'

/**
 * Register top-level subcommands on the cac root program.
 *
 * Stub implementations live here for Wave 1; full behavior ships in
 * T-9 (`mi init`) and T-10 (`mi config get/set/list`) during Wave 3.
 */
export function registerCommands(program: CAC): void {
  program
    .command('init', '初始化 mianshiguan 数据目录与数据库')
    .option('--force', '强制覆盖已有数据目录', { default: false })
    .option('--dry-run', '仅打印计划，不写入文件系统', { default: false })
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .action(() => {
      // 占位实现 — Wave 3 (T-9) 替换为完整 init 流程
      console.log('init: 占位实现，完整逻辑见 T-9')
    })

  program
    .command('config', '查看与修改配置（get/set/list）')
    .option('--json', '以 JSON 格式输出（仅作用于 list 子命令）')
    .action(() => {
      // 占位实现 — Wave 3 (T-10) 替换为完整 config CRUD
      console.log('config: 占位实现，完整逻辑见 T-10')
    })
}