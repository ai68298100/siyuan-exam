# vendor/ — 第三方包本地保存（38-08）

依赖锁定策略：官方固定版本包收进仓库，`package.json` 以 `file:` 引用——
冻结安装（`pnpm install --frozen-lockfile`）可重现且离线可用，
tarball 完整性由 lockfile 内 integrity 字段校验（CI 全新安装不再依赖 CDN）。

| 包 | 版本 | 来源 | 许可证 | SHA256 |
|---|---|---|---|---|
| xlsx | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz | Apache-2.0（包内 LICENSE） | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` |

> SheetJS Community Edition 自 0.19 起不再发布 npm registry，官方分发渠道为 cdn.sheetjs.com；
> npm 上的 `xlsx@0.18.5` 已停止维护且有已公布问题（38-08 所述），故不使用。
> 升级时：下载新版本 tgz 替换本目录文件 → 更新 package.json/lockfile → 回填新 SHA256。
