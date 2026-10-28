package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"atolla/server/internal/notify"
)

const (
	notifyBarkOTPTTL       = 10 * time.Minute
	notifyBarkOTPCooldown  = 60 * time.Second
	notifyBarkOTPMaxTries  = 5
)

var (
	errNotifyBarkCooldown = errors.New("发送过于频繁，请稍后再试")
	errNotifyBarkExpired  = errors.New("验证码已过期，请重新发送")
	errNotifyBarkWrong    = errors.New("验证码错误")
	errNotifyBarkLocked   = errors.New("验证失败次数过多，请重新发送")
	errNotifyBarkNoCode   = errors.New("请先发送验证码")
)

type notifyBarkOTP struct {
	code      string
	expiresAt time.Time
	sentAt    time.Time
	attempts  int
}

// SendNotifyBarkOTP 经 Bark 发送 6 位验证码；成功发码才进入冷却。
func (s *Service) SendNotifyBarkOTP(ctx context.Context) (expiresInSec int, err error) {
	if s == nil || s.Notify == nil {
		return 0, errNotifyStore
	}
	now := time.Now()
	s.notifyOTPMu.Lock()
	defer s.notifyOTPMu.Unlock()
	if s.notifyOTP != nil && now.Sub(s.notifyOTP.sentAt) < notifyBarkOTPCooldown {
		wait := int(notifyBarkOTPCooldown.Seconds()) - int(now.Sub(s.notifyOTP.sentAt).Seconds())
		if wait < 1 {
			wait = 1
		}
		return 0, fmt.Errorf("%w（%d 秒）", errNotifyBarkCooldown, wait)
	}
	code, err := randomDigits(6)
	if err != nil {
		return 0, err
	}
	dedupe := fmt.Sprintf("verify:%d", now.UnixNano())
	card := notify.Card{
		DedupeKey: dedupe,
		Title:     "Atolla",
		Body:      "验证码 " + code + "\n10 分钟内有效",
		Icon:      s.barkAppIconURL(),
		Group:     notify.AtollaGroup,
		Sound:     "bell",
		Level:     "timeSensitive",
	}
	if err := s.Notify.PushSync(card); err != nil {
		return 0, fmt.Errorf("Bark 发送失败：请确认已安装 Bark 并配置 BARK_KEY")
	}
	s.notifyOTP = &notifyBarkOTP{
		code:      code,
		expiresAt: now.Add(notifyBarkOTPTTL),
		sentAt:    now,
		attempts:  0,
	}
	return int(notifyBarkOTPTTL.Seconds()), nil
}

// ConfirmNotifyBarkOTP 校验验证码；成功后标记 bark_verified。
func (s *Service) ConfirmNotifyBarkOTP(ctx context.Context, code string) error {
	if s == nil || s.Store == nil {
		return errNotifyStore
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return errNotifyBarkWrong
	}
	now := time.Now()
	s.notifyOTPMu.Lock()
	otp := s.notifyOTP
	if otp == nil {
		s.notifyOTPMu.Unlock()
		return errNotifyBarkNoCode
	}
	if now.After(otp.expiresAt) {
		s.notifyOTP = nil
		s.notifyOTPMu.Unlock()
		return errNotifyBarkExpired
	}
	if otp.attempts >= notifyBarkOTPMaxTries {
		s.notifyOTP = nil
		s.notifyOTPMu.Unlock()
		return errNotifyBarkLocked
	}
	if code != otp.code {
		otp.attempts++
		left := notifyBarkOTPMaxTries - otp.attempts
		s.notifyOTPMu.Unlock()
		if left <= 0 {
			s.notifyOTPMu.Lock()
			s.notifyOTP = nil
			s.notifyOTPMu.Unlock()
			return errNotifyBarkLocked
		}
		return fmt.Errorf("%w（还可试 %d 次）", errNotifyBarkWrong, left)
	}
	s.notifyOTP = nil
	s.notifyOTPMu.Unlock()
	return s.Store.SetBarkVerified(ctx, true)
}

func randomDigits(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid length")
	}
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		out[i] = byte('0' + v.Int64())
	}
	return string(out), nil
}
