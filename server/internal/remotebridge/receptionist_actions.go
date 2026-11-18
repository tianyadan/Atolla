package remotebridge

import (
	"fmt"
	"strings"
)

// handleReceptionistAsk delegates Siri questions to the existing Receptionist service.
func handleReceptionistAsk(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	question, _ := ec.Payload["question"].(string)
	question = strings.TrimSpace(question)
	if question == "" {
		return nil, fmt.Errorf("question required")
	}
	return ec.Runtime.AskSiriReceptionist(ec.Context, question)
}
