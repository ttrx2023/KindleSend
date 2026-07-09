# KindleSend

KindleSend 是一个基于 Wails (Go + Vite) 的桌面工具，用于将本地电子书批量发送到 Kindle 邮箱，并提供搜索入口、配置管理和发送进度反馈。

## 功能概览
- 扫描指定下载目录，展示本地书籍列表
- 支持 EPUB、MOBI、PDF、AZW3、TXT 文件
- 支持文件类型筛选、排序、批量选择与发送
- 发送时自动清洗文件名（例如去除广告后缀）
- 发送进度展示与发送状态日志
- SMTP 连通测试
- 可配置搜索网址模板（支持 `%s` 占位符）
- 可配置 SMTP 服务器与端口，默认适配 QQ 邮箱

## 环境要求
- Go（用于后端）
- Node.js + npm（用于前端）
- Wails CLI（用于开发与打包）
- Git（用于版本管理与同步 GitHub）

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

生成文件位置：`build/bin/KindleSend.exe`

## 使用说明
1. 打开软件后进入“设置”，填写并保存：
   - 发件人邮箱
   - 邮箱授权码（不是登录密码）
   - Kindle 接收邮箱
   - 本地下载路径（书籍所在目录）
   - 搜索网址模板
   - SMTP 服务器与端口
2. 点击“刷新”加载本地书籍列表。
3. 勾选需要发送的书籍，点击“发送选中书籍”。
4. 在搜索栏输入书名，点击“搜索”或按回车打开浏览器搜索。

## 配置字段说明
- `senderEmail`: 发件人邮箱（必须开启 SMTP/POP3）
- `senderPass`: 邮箱授权码（不是登录密码）
- `targetKindle`: Kindle 接收邮箱
- `downloadPath`: 本地书籍目录
- `searchUrl`: 搜索网址模板，建议包含 `%s`
- `smtpServer`: SMTP 服务器地址，默认 `smtp.qq.com`
- `smtpPort`: 实际发送端口，默认 `465`
- `smtpTestPort`: 连通测试端口，默认 `587`

## 配置存储与隐私
- 配置保存在用户配置目录（Windows 通常为 `%AppData%\KindleSend\config.json`）。
- 本地 `config.json`、构建缓存和构建产物不会提交到 GitHub。
- 请勿将邮箱授权码、Kindle 邮箱或个人配置文件提交到仓库。

## 常见问题
- 发送失败提示认证错误：检查授权码是否正确、邮箱是否开启 SMTP。
- Kindle 未收到：确认发件人已加入亚马逊“已认可的发件人列表”。
- 列表为空：确认下载目录是否正确、文件扩展名是否受支持（epub/mobi/pdf/azw3/txt）。
- 使用非 QQ 邮箱：请在设置中填写对应邮箱服务商的 SMTP 服务器和端口。
