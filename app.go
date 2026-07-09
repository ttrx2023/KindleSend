package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"net/textproto"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jordan-wright/email"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	config     Config
	cancelSend context.CancelFunc
	mu         sync.Mutex
}

type Config struct {
	SenderEmail  string `json:"senderEmail"`
	SenderPass   string `json:"senderPass"`
	TargetKindle string `json:"targetKindle"`
	DownloadPath string `json:"downloadPath"`
	SearchUrl    string `json:"searchUrl"`
	SmtpServer   string `json:"smtpServer"`
	SmtpPort     int    `json:"smtpPort"`
	SmtpTestPort int    `json:"smtpTestPort"`
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
	SearchUrl:    "https://www.google.com/search?q=%s",
	SmtpServer:   "smtp.qq.com",
	SmtpPort:     465,
	SmtpTestPort: 587,
}

var supportedBookExts = map[string]bool{
	".azw3": true,
	".epub": true,
	".mobi": true,
	".pdf":  true,
	".txt":  true,
}

const smtpTestTimeout = 8 * time.Second
const smtpSendTimeout = 30 * time.Second

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadConfig()
}

func (a *App) getConfigPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.TempDir()
	}

	appDir := filepath.Join(configDir, "KindleSend")
	_ = os.MkdirAll(appDir, 0755)

	return filepath.Join(appDir, "config.json")
}

func (a *App) loadConfig() {
	path := a.getConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		a.config = defaultConfig
		return
	}

	cfg := defaultConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		a.config = defaultConfig
		return
	}
	a.config = normalizeConfig(cfg)
}

func (a *App) SaveSettings(cfg Config) string {
	cfg = normalizeConfig(cfg)
	a.config = cfg
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "❌ 保存失败: 格式错误"
	}

	if err := os.WriteFile(a.getConfigPath(), data, 0600); err != nil {
		return fmt.Sprintf("❌ 保存失败: %v", err)
	}
	return "✅ 配置已保存"
}

func normalizeConfig(cfg Config) Config {
	cfg.SenderEmail = strings.TrimSpace(cfg.SenderEmail)
	cfg.SenderPass = strings.TrimSpace(cfg.SenderPass)
	cfg.TargetKindle = strings.TrimSpace(cfg.TargetKindle)
	cfg.DownloadPath = strings.TrimSpace(cfg.DownloadPath)
	cfg.SearchUrl = strings.TrimSpace(cfg.SearchUrl)
	cfg.SmtpServer = strings.TrimSpace(cfg.SmtpServer)

	if cfg.DownloadPath == "" {
		cfg.DownloadPath = defaultConfig.DownloadPath
	}
	if cfg.SearchUrl == "" {
		cfg.SearchUrl = defaultConfig.SearchUrl
	}
	if cfg.SmtpServer == "" {
		cfg.SmtpServer = defaultConfig.SmtpServer
	}
	if cfg.SmtpPort <= 0 {
		cfg.SmtpPort = defaultConfig.SmtpPort
	}
	if cfg.SmtpTestPort <= 0 {
		cfg.SmtpTestPort = defaultConfig.SmtpTestPort
	}

	return cfg
}

func normalizeDownloadPath(path string) string {
	path = strings.TrimSpace(path)
	path = strings.Trim(path, "\"'")
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		if homeDir, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(homeDir, strings.TrimPrefix(strings.TrimPrefix(path, "~"), string(os.PathSeparator)))
		}
	}
	return filepath.Clean(path)
}

func (a *App) GetSettings() (Config, bool) {
	a.loadConfig()
	isFirstRun := a.config.SenderEmail == ""
	return a.config, isFirstRun
}

func (a *App) CancelSend() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancelSend != nil {
		a.cancelSend()
		a.cancelSend = nil
	}
}

func (a *App) SearchBook(query string) {
	cfg := normalizeConfig(a.config)
	baseURL := cfg.SearchUrl
	if !strings.Contains(baseURL, "%s") {
		baseURL += "%s"
	}

	searchURL := strings.Replace(baseURL, "%s", url.QueryEscape(query), 1)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", searchURL)
	case "darwin":
		cmd = exec.Command("open", searchURL)
	default:
		cmd = exec.Command("xdg-open", searchURL)
	}
	_ = cmd.Start()
}

func (a *App) ListBooks() []BookInfo {
	var books []BookInfo
	cfg := normalizeConfig(a.config)
	root := normalizeDownloadPath(cfg.DownloadPath)

	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return books
	}

	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !supportedBookExts[ext] {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return nil
		}

		cleanType := strings.TrimPrefix(ext, ".")
		books = append(books, BookInfo{
			Name:    info.Name(),
			Path:    path,
			Size:    fmt.Sprintf("%.2f MB", float64(info.Size())/1024/1024),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			RawTime: info.ModTime().Unix(),
			Type:    strings.ToUpper(cleanType),
		})
		return nil
	})

	sort.Slice(books, func(i, j int) bool {
		return books[i].RawTime > books[j].RawTime
	})
	return books
}

func (a *App) GetLibraryScanMessage() string {
	cfg := normalizeConfig(a.config)
	root := normalizeDownloadPath(cfg.DownloadPath)

	info, err := os.Stat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Sprintf("❌ 下载路径不存在: %s", root)
		}
		return fmt.Sprintf("❌ 无法访问下载路径: %s (%v)", root, err)
	}
	if !info.IsDir() {
		return fmt.Sprintf("❌ 下载路径不是文件夹: %s", root)
	}

	totalFiles := 0
	supportedFiles := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}

		totalFiles++
		if supportedBookExts[strings.ToLower(filepath.Ext(path))] {
			supportedFiles++
		}
		return nil
	})

	if supportedFiles == 0 {
		if totalFiles == 0 {
			return fmt.Sprintf("📂 目录可访问，但里面没有文件: %s", root)
		}
		return fmt.Sprintf("📂 目录可访问，但未找到 EPUB、MOBI、PDF、AZW3 或 TXT 文件: %s", root)
	}

	return fmt.Sprintf("✅ 已在目录中找到 %d 个可发送文件", supportedFiles)
}

func (a *App) TestConnection() string {
	cfg := normalizeConfig(a.config)
	if cfg.SenderEmail == "" || cfg.SenderPass == "" {
		return "❌ 请先配置邮箱信息"
	}

	auth := smtp.PlainAuth("", cfg.SenderEmail, cfg.SenderPass, cfg.SmtpServer)
	implicitTLS := cfg.SmtpTestPort == 465
	client, remote, err := newSMTPClient(cfg.SmtpServer, cfg.SmtpTestPort, implicitTLS, smtpTestTimeout)
	if err != nil {
		return formatSMTPConnectError(err, remote)
	}
	defer client.Close()

	if !implicitTLS {
		if err = client.StartTLS(&tls.Config{ServerName: cfg.SmtpServer, MinVersion: tls.VersionTLS12}); err != nil {
			return "❌ TLS 握手失败: " + err.Error()
		}
	}
	if err = client.Auth(auth); err != nil {
		return "❌ 密码/授权码错误: " + err.Error()
	}
	_ = client.Quit()
	return fmt.Sprintf("✅ SMTP 连接测试成功！配置正确。连接地址: %s", remote)
}

func newSMTPClient(host string, port int, implicitTLS bool, timeout time.Duration) (*smtp.Client, string, error) {
	addr, err := resolveSMTPAddress(host, port, timeout)
	if err != nil {
		return nil, fmt.Sprintf("%s:%d", host, port), err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	dialer := net.Dialer{Timeout: timeout}

	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, addr, err
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))

	if implicitTLS {
		conn = tls.Client(conn, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	}

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return nil, addr, err
	}
	return client, addr, nil
}

func resolveSMTPAddress(host string, port int, timeout time.Duration) (string, error) {
	defaultAddr := fmt.Sprintf("%s:%d", host, port)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", host)
	if err == nil {
		if ip := firstRealIP(ips); ip != nil {
			return net.JoinHostPort(ip.String(), fmt.Sprintf("%d", port)), nil
		}
	}

	realIPs, dohErr := resolveHostByDoH(host, timeout)
	if dohErr == nil && len(realIPs) > 0 {
		return net.JoinHostPort(realIPs[0].String(), fmt.Sprintf("%d", port)), nil
	}

	if err != nil {
		return defaultAddr, err
	}
	if dohErr != nil {
		return defaultAddr, fmt.Errorf("DNS 解析得到 TUN fake-ip，且真实 DNS 解析失败: %w", dohErr)
	}
	return defaultAddr, nil
}

type dohResponse struct {
	Answer []struct {
		Type int    `json:"type"`
		Data string `json:"data"`
	} `json:"Answer"`
}

func resolveHostByDoH(host string, timeout time.Duration) ([]net.IP, error) {
	endpoint := "https://dns.alidns.com/resolve?name=" + url.QueryEscape(host) + "&type=A"
	client := http.Client{Timeout: timeout}
	resp, err := client.Get(endpoint)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result dohResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var ips []net.IP
	for _, answer := range result.Answer {
		if answer.Type != 1 {
			continue
		}
		ip := net.ParseIP(answer.Data)
		if ip == nil || isFakeIP(ip) {
			continue
		}
		ips = append(ips, ip)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("未获得可用 A 记录")
	}
	return ips, nil
}

func firstRealIP(ips []net.IP) net.IP {
	for _, ip := range ips {
		if !isFakeIP(ip) {
			return ip
		}
	}
	return nil
}

func isFakeIP(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	return ip4[0] == 198 && (ip4[1] == 18 || ip4[1] == 19)
}

func formatSMTPConnectError(err error, remote string) string {
	if os.IsTimeout(err) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return fmt.Sprintf("❌ 连接或握手超时: %s。若开启 TUN，请确认代理规则允许 SMTP 直连，或允许程序访问真实 SMTP IP。原始错误: %v", remote, err)
	}
	return fmt.Sprintf("❌ SMTP 握手失败: %s (%v)", remote, err)
}

func (a *App) SendSelectedBooks(filePaths []string) {
	cfg := normalizeConfig(a.config)
	if cfg.SenderEmail == "" || cfg.SenderPass == "" || cfg.TargetKindle == "" {
		wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
			Status:  "error",
			Message: "❌ 请先在设置中完整配置发件邮箱、授权码和 Kindle 接收邮箱",
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

	a.mu.Lock()
	if a.cancelSend != nil {
		a.cancelSend()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancelSend = cancel
	a.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			a.mu.Lock()
			a.cancelSend = nil
			a.mu.Unlock()
		}()

		total := len(filePaths)
		for i, path := range filePaths {
			select {
			case <-ctx.Done():
				wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
					Status:  "error",
					Message: "⛔ 已停止发送",
					Current: i,
					Total:   total,
				})
				return
			default:
			}

			originalName := filepath.Base(path)
			current := i + 1
			pct := int(float64(current) / float64(total) * 100)

			if !supportedBookExts[strings.ToLower(filepath.Ext(originalName))] {
				wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
					Total:       total,
					Current:     current,
					FileName:    originalName,
					Status:      "error",
					Message:     fmt.Sprintf("已跳过不支持的文件: %s", originalName),
					ProgressPct: pct,
				})
				continue
			}

			wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
				Total:       total,
				Current:     current,
				FileName:    originalName,
				Status:      "processing",
				Message:     fmt.Sprintf("正在发送: %s", originalName),
				ProgressPct: pct,
			})

			cleanName, err := a.sendBookFile(cfg, path, originalName)
			if err == nil {
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
					Message:     fmt.Sprintf("发送失败: %s", err.Error()),
					ProgressPct: pct,
				})
			}

			if total > 1 && current < total {
				time.Sleep(1 * time.Second)
			}
		}

		wailsRuntime.EventsEmit(a.ctx, "send-progress", SendProgressEvent{
			Total:       total,
			Current:     total,
			Status:      "finished",
			Message:     fmt.Sprintf("全部处理完成，共 %d 个文件", total),
			ProgressPct: 100,
		})
	}()
}

func (a *App) sendBookFile(cfg Config, path string, originalName string) (string, error) {
	fileData, err := os.ReadFile(path)
	if err != nil {
		return originalName, fmt.Errorf("读取失败: %w", err)
	}

	cleanName := cleanBookName(originalName)
	e := email.NewEmail()
	e.From = fmt.Sprintf("Kindle Sender <%s>", cfg.SenderEmail)
	e.To = []string{cfg.TargetKindle}
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

	err = sendEmailWithResolvedSMTP(e, cfg)
	if err != nil && err != io.EOF && !strings.Contains(err.Error(), "short response") {
		return cleanName, err
	}

	return cleanName, nil
}

func sendEmailWithResolvedSMTP(e *email.Email, cfg Config) error {
	implicitTLS := cfg.SmtpPort == 465
	client, _, err := newSMTPClient(cfg.SmtpServer, cfg.SmtpPort, implicitTLS, smtpSendTimeout)
	if err != nil {
		return err
	}
	defer client.Close()

	if !implicitTLS {
		if err := client.StartTLS(&tls.Config{ServerName: cfg.SmtpServer, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}

	if err := client.Auth(smtp.PlainAuth("", cfg.SenderEmail, cfg.SenderPass, cfg.SmtpServer)); err != nil {
		return err
	}
	if err := client.Mail(cfg.SenderEmail); err != nil {
		return err
	}
	if err := client.Rcpt(cfg.TargetKindle); err != nil {
		return err
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}

	message, err := e.Bytes()
	if err != nil {
		_ = writer.Close()
		return err
	}
	if _, err := writer.Write(message); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func cleanBookName(name string) string {
	cleanName := strings.ReplaceAll(name, "(Z-Library)", "")
	cleanName = strings.TrimSpace(cleanName)
	ext := filepath.Ext(cleanName)
	nameBody := strings.TrimSuffix(cleanName, ext)
	return strings.TrimSpace(nameBody) + ext
}
