package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/smtp"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/jordan-wright/email"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx    context.Context
	config Config
}

type Config struct {
	SenderEmail  string `json:"senderEmail"`
	SenderPass   string `json:"senderPass"`
	TargetKindle string `json:"targetKindle"`
	DownloadPath string `json:"downloadPath"`
	SearchUrl    string `json:"searchUrl"`
}

type BookInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    string `json:"size"`
	ModTime string `json:"modTime"`
	RawTime int64  `json:"-"`
	Type    string `json:"type"`
}

type SendProgressEvent struct {
	Total       int    `json:"total"`
	Current     int    `json:"current"`
	FileName    string `json:"fileName"`
	Status      string `json:"status"` // processing, success, error, finished
	Message     string `json:"message"`
	ProgressPct int    `json:"progressPct"`
}

var defaultConfig = Config{
	SenderEmail:  "",
	SenderPass:   "",
	TargetKindle: "",
	DownloadPath: "D:\\Downloads",
	SearchUrl:    "https://fuckfbi.ru/s/?q=%s",
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadConfig()
}

// ================= 核心修复：使用 AppData 目录 =================
func (a *App) getConfigPath() string {
	// 获取系统用户配置目录 (Windows下是 AppData/Roaming)
	configDir, err := os.UserConfigDir()
	if err != nil {
		// 极端情况回退到临时目录
		configDir = os.TempDir()
	}

	// 创建专属于本软件的文件夹
	appDir := filepath.Join(configDir, "KindleSend")
	_ = os.MkdirAll(appDir, 0755) // 确保文件夹存在

	return filepath.Join(appDir, "config.json")
}

func (a *App) loadConfig() {
	path := a.getConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		a.config = defaultConfig
	} else {
		json.Unmarshal(data, &a.config)
	}
}

func (a *App) SaveSettings(cfg Config) string {
	a.config = cfg
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "❌ 保存失败: 格式错误"
	}
	
	path := a.getConfigPath()
	err = os.WriteFile(path, data, 0644)
	if err != nil {
		return fmt.Sprintf("❌ 保存失败: %v", err)
	}
	return "✅ 配置已保存"
}

func (a *App) GetSettings() (Config, bool) {
	a.loadConfig() // 每次获取前强制读取硬盘
	isFirstRun := a.config.SenderEmail == ""
	return a.config, isFirstRun
}

// ================= 业务逻辑 =================

func (a *App) SearchBook(query string) {
	baseUrl := a.config.SearchUrl
	if baseUrl == "" {
		baseUrl = defaultConfig.SearchUrl
	}
	if !strings.Contains(baseUrl, "%s") {
		baseUrl += "%s"
	}
	url := fmt.Sprintf(baseUrl, query)
	if runtime.GOOS == "windows" {
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
}

func (a *App) ListBooks() []BookInfo {
	var books []BookInfo
	path := a.config.DownloadPath
	if path == "" {
		path = defaultConfig.DownloadPath
	}

	files, err := filepath.Glob(filepath.Join(path, "*.*"))
	if err != nil {
		return books
	}

	for _, f := range files {
		ext := strings.ToLower(filepath.Ext(f))
		if ext == ".epub" || ext == ".mobi" || ext == ".pdf" || ext == ".azw3" || ext == ".txt" {
			info, err := os.Stat(f)
			if err == nil {
				sizeMB := float64(info.Size()) / 1024 / 1024
				cleanType := strings.TrimPrefix(ext, ".")
				books = append(books, BookInfo{
					Name:    info.Name(),
					Path:    f,
					Size:    fmt.Sprintf("%.2f MB", sizeMB),
					ModTime: info.ModTime().Format("2006-01-02 15:04"),
					RawTime: info.ModTime().Unix(),
					Type:    strings.ToUpper(cleanType),
				})
			}
		}
	}
	sort.Slice(books, func(i, j int) bool {
		return books[i].RawTime > books[j].RawTime
	})
	return books
}

func (a *App) TestConnection() string {
	if a.config.SenderEmail == "" || a.config.SenderPass == "" {
		return "❌ 请先配置邮箱信息"
	}

	auth := smtp.PlainAuth("", a.config.SenderEmail, a.config.SenderPass, "smtp.qq.com")
	client, err := smtp.Dial("smtp.qq.com:587")
	if err != nil {
		return "❌ 连接服务器失败: " + err.Error()
	}
	if err = client.StartTLS(&tls.Config{ServerName: "smtp.qq.com", InsecureSkipVerify: true}); err != nil {
		return "❌ TLS 握手失败: " + err.Error()
	}
	if err = client.Auth(auth); err != nil {
		return "❌ 密码/授权码错误: " + err.Error()
	}
	client.Quit()
	return "✅ SMTP 连接测试成功！配置正确。"
}

func (a *App) SendSelectedBooks(filePaths []string) {
	// 参数验证
	if a.config.SenderEmail == "" {
		wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
			Status:  "error",
			Message: "❌ 请先在设置中配置发件人邮箱",
		})
		return
	}
	if len(filePaths) == 0 {
		wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
			Status:  "error",
			Message: "⚠️ 未选择任何文件",
		})
		return
	}

	// 启动协程异步处理
	go func() {
		total := len(filePaths)

		for i, path := range filePaths {
			originalName := filepath.Base(path)
			current := i + 1
			pct := int(float64(current) / float64(total) * 100)

			// 发送"正在处理"事件
			wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
				Total:       total,
				Current:     current,
				FileName:    originalName,
				Status:      "processing",
				Message:     fmt.Sprintf("正在发送: %s", originalName),
				ProgressPct: pct,
			})

			fileData, err := os.ReadFile(path)
			if err != nil {
				wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
					Total:       total,
					Current:     current,
					FileName:    originalName,
					Status:      "error",
					Message:     fmt.Sprintf("读取失败: %s", err.Error()),
					ProgressPct: pct,
				})
				continue
			}

			cleanName := strings.ReplaceAll(originalName, "(Z-Library)", "")
			cleanName = strings.TrimSpace(cleanName)
			ext := filepath.Ext(cleanName)
			nameBody := strings.TrimSuffix(cleanName, ext)
			cleanName = strings.TrimSpace(nameBody) + ext

			e := email.NewEmail()
			e.From = fmt.Sprintf("Kindle Sender <%s>", a.config.SenderEmail)
			e.To = []string{a.config.TargetKindle}
			e.Subject = "Convert"
			e.Text = []byte("Sent via KindleSend.")

			encodedFilename := mime.BEncoding.Encode("UTF-8", cleanName)

			attachment := &email.Attachment{
				Filename: cleanName,
				Header:   textproto.MIMEHeader{},
				Content:  fileData,
			}
			attachment.Header.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", encodedFilename))
			attachment.Header.Set("Content-Type", "application/octet-stream")

			e.Attachments = append(e.Attachments, attachment)

			err = e.SendWithTLS("smtp.qq.com:465",
				smtp.PlainAuth("", a.config.SenderEmail, a.config.SenderPass, "smtp.qq.com"),
				&tls.Config{ServerName: "smtp.qq.com", InsecureSkipVerify: true})

			// 判断发送结果
			sendSuccess := false
			var errMsg string
			if err != nil {
				errStr := err.Error()
				// 某些情况下 EOF 或 short response 实际上是成功的
				if err == io.EOF || strings.Contains(errStr, "short response") {
					sendSuccess = true
				} else {
					errMsg = errStr
				}
			} else {
				sendSuccess = true
			}

			if sendSuccess {
				msg := fmt.Sprintf("发送成功: %s", cleanName)
				if originalName != cleanName {
					msg += " (已清洗)"
				}
				wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
					Total:       total,
					Current:     current,
					FileName:    cleanName,
					Status:      "success",
					Message:     msg,
					ProgressPct: pct,
				})
			} else {
				wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
					Total:       total,
					Current:     current,
					FileName:    cleanName,
					Status:      "error",
					Message:     fmt.Sprintf("发送失败: %s", errMsg),
					ProgressPct: pct,
				})
			}

			// 多文件时间隔发送，避免被邮件服务器限流
			if total > 1 && current < total {
				time.Sleep(1 * time.Second)
			}
		}

		// 发送完成事件
		wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
			Total:       total,
			Current:     total,
			Status:      "finished",
			Message:     fmt.Sprintf("全部处理完成，共 %d 个文件", total),
			ProgressPct: 100,
		})
	}()
}