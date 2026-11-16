package service

import (
	"context"
	"fmt"
	"net/url"
)

// executeLanRelayRead is the narrow local-read boundary for paired iPhones.
// It deliberately delegates to RemoteBridge's local snapshot builder instead
// of its sync handlers: sync handlers publish to Tencent Cloud as a side
// effect and therefore violate LAN-only reads.
func (s *Service) executeLanRelayRead(ctx context.Context, resource string, query url.Values) (any, error) {
	if s == nil || s.RemoteBridge == nil {
		return nil, fmt.Errorf("LAN relay runtime is unavailable")
	}
	return s.RemoteBridge.ReadMobileSnapshot(ctx, resource, query)
}
