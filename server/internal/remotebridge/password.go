package remotebridge

import (
	"crypto/rand"
	"math/big"
)

// passwordAlphabet is Mac-side 6-char instance password charset (matches remote-relay).
const passwordAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// GenerateInstancePassword returns a 6-character [0-9A-Za-z] password.
func GenerateInstancePassword() string {
	out := make([]byte, 6)
	max := big.NewInt(int64(len(passwordAlphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			out[i] = passwordAlphabet[0]
			continue
		}
		out[i] = passwordAlphabet[n.Int64()]
	}
	return string(out)
}

// ValidInstancePassword reports whether s matches relay instance password format.
func ValidInstancePassword(s string) bool {
	if len(s) != 6 {
		return false
	}
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			continue
		}
		return false
	}
	return true
}
