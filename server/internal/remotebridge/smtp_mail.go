package remotebridge

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

/** encodeMailSubject 中文主题 RFC2047，避免 163 等拒信/进垃圾箱 */
func encodeMailSubject(s string) string {
	return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
}

/** ResolveSmtpPort 默认 465（SSL） */
func ResolveSmtpPort(port int) int {
	if port <= 0 {
		return 465
	}
	return port
}

/** plainAuthTLS 在已 TLS 的 465 连接上做 PLAIN（绕过 net/smtp 误判 unencrypted） */
type plainAuthTLS struct {
	identity, username, password string
}

func (a *plainAuthTLS) Start(_ *smtp.ServerInfo) (string, []byte, error) {
	resp := []byte("\x00" + a.username + "\x00" + a.password)
	return "PLAIN", resp, nil
}

func (a *plainAuthTLS) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, fmt.Errorf("unexpected server challenge")
	}
	return nil, nil
}

func newSMTPAuth(cfg Config) smtp.Auth {
	user := strings.TrimSpace(cfg.SmtpUser)
	host := strings.TrimSpace(cfg.SmtpHost)
	port := ResolveSmtpPort(cfg.SmtpPort)
	if port == 465 {
		return &plainAuthTLS{username: user, password: cfg.SmtpPassword}
	}
	return smtp.PlainAuth("", user, cfg.SmtpPassword, host)
}

/** wrapSMTPErr 附带主机端口，方便 UI 展示 */
func wrapSMTPErr(addr string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s：%w", addr, err)
}

/** TestSMTP 用当前配置登录 SMTP；465 仅 AUTH，不真正发信 */
func TestSMTP(cfg Config) error {
	if !cfg.SmtpConfigured() {
		return fmt.Errorf("请完整填写 SMTP 主机、端口、账号、密码与发件人")
	}
	port := ResolveSmtpPort(cfg.SmtpPort)
	host := strings.TrimSpace(cfg.SmtpHost)
	addr := fmt.Sprintf("%s:%d", host, port)
	auth := newSMTPAuth(cfg)

	if port == 465 {
		if err := smtpAuthSSL(addr, host, auth); err != nil {
			return wrapSMTPErr(addr, err)
		}
		return nil
	}

	// 587 / 25：STARTTLS + AUTH
	c, err := smtp.Dial(addr)
	if err != nil {
		return wrapSMTPErr(addr, err)
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return wrapSMTPErr(addr, err)
		}
	}
	if err := c.Auth(auth); err != nil {
		return wrapSMTPErr(addr, err)
	}
	return nil
}

/** smtpAuthSSL 465 隐式 TLS：握手后 AUTH 即视为校验通过 */
func smtpAuthSSL(addr, serverName string, auth smtp.Auth) error {
	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 15 * time.Second},
		"tcp",
		addr,
		&tls.Config{ServerName: serverName, MinVersion: tls.VersionTLS12},
	)
	if err != nil {
		return err
	}
	defer conn.Close()
	c, err := smtp.NewClient(conn, serverName)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Auth(auth); err != nil {
		return err
	}
	_ = c.Quit()
	return nil
}

/** SendUnlockOTPMail 发送一次性解锁验证码 */
func SendUnlockOTPMail(cfg Config, toEmail, code string, expiresAtUnixMs int64) error {
	if !cfg.SmtpConfigured() || !cfg.SmtpOk {
		return fmt.Errorf("SMTP 未配置或未校验通过")
	}
	to := strings.TrimSpace(toEmail)
	if to == "" || code == "" {
		return fmt.Errorf("missing to or code")
	}
	expireText := time.UnixMilli(expiresAtUnixMs).Local().Format("2006-01-02 15:04")
	from := strings.TrimSpace(cfg.SmtpFrom)
	subject := encodeMailSubject("Atolla 实例解锁验证码")
	body := fmt.Sprintf(
		"您的 Atolla 实例解锁验证码：%s\r\n\r\n有效期至 %s（一次性，使用后立即失效）。\r\n如非本人操作请忽略。\r\n",
		code, expireText,
	)
	msg := []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		from, to, subject, body,
	))
	port := ResolveSmtpPort(cfg.SmtpPort)
	host := strings.TrimSpace(cfg.SmtpHost)
	addr := fmt.Sprintf("%s:%d", host, port)
	auth := newSMTPAuth(cfg)
	if port == 465 {
		return wrapSMTPErr(addr, smtpDialSSL(addr, host, auth, from, []string{to}, msg))
	}
	return wrapSMTPErr(addr, smtp.SendMail(addr, auth, from, []string{to}, msg))
}

func smtpDialSSL(addr, serverName string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 15 * time.Second},
		"tcp",
		addr,
		&tls.Config{ServerName: serverName, MinVersion: tls.VersionTLS12},
	)
	if err != nil {
		return err
	}
	defer conn.Close()
	c, err := smtp.NewClient(conn, serverName)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Auth(auth); err != nil {
		return err
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err := c.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
