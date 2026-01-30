# KindlePro

KindlePro 是一个基于 Wails (Go + Vite) 的桌面工具，用于将本地电子书批量发送到 Kindle 邮箱，并提供简单的搜索入口与配置管理。

## 功能概览
- 扫描指定下载目录，展示本地书籍列表
- 支持批量选择与发送
- 发送时自动清洗文件名（例如去除广告后缀）
- 连接测试（SMTP）
- 可配置搜索网址模板（支持 `%s` 占位符）

## 环境要求
- Go（用于后端）
- Node.js + npm（用于前端）
- Wails CLI（用于开发与打包）

## 开发运行
```powershell
cd frontend
npm install
cd ..
wails dev
```

## 打包发布
```powershell
cd frontend
npm install
npm run build
cd ..
wails build
```
生成文件位置：`build/bin/KindlePro.exe`

## 使用说明
1) 打开软件后进入“设置”，填写以下信息并保存：
   - 发件人邮箱（建议使用 QQ 邮箱）
   - 邮箱授权码（非登录密码）
   - Kindle 接收邮箱
   - 本地下载路径（书籍所在目录）
   - 搜索网址模板（如 `https://example.com/s?q=%s`）
2) 点击“刷新”加载本地书籍列表。
3) 勾选需要发送的书籍，点击“发送选中书籍”。
4) 在搜索栏输入书名可打开浏览器搜索（使用上面的模板）。

## 配置字段说明
- `senderEmail`: 发件人邮箱（必须开启 SMTP/POP3）
- `senderPass`: 邮箱授权码（不是登录密码）
- `targetKindle`: Kindle 接收邮箱
- `downloadPath`: 本地书籍目录
- `searchUrl`: 搜索网址模板，必须包含 `%s`

## 配置存储与隐私
- 配置保存在用户配置目录（Windows 通常为 `%AppData%\KindlePro\config.json`）。
- 请勿将任何个人配置文件提交到 GitHub；仓库已忽略本地配置文件。

## 常见问题
- 发送失败提示认证错误：检查授权码是否正确、邮箱是否开启 SMTP。
- Kindle 未收到：确认发件人已加入亚马逊“已认可的发件人列表”。
- 列表为空：确认下载目录是否正确、文件扩展名是否受支持（epub/mobi/pdf/azw3/txt）。
