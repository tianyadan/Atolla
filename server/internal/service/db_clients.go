package service

import (
	"os/exec"
	"strings"
	"sync"
)

// DBClientStatus is local CLI availability for a db type.
type DBClientStatus struct {
	DBType string `json:"db_type"`
	OK     bool   `json:"ok"`
	Bin    string `json:"bin,omitempty"`
	Label  string `json:"label,omitempty"`
}

// dbClientBins maps db_type -> candidate binaries (first found wins).
var dbClientBins = map[string][]string{
	"mysql":         {"mysql"},
	"mariadb":       {"mariadb", "mysql"},
	"pgsql":         {"psql"},
	"redis":         {"redis-cli"},
	"mongodb":       {"mongosh", "mongo"},
	"sqlite":        {"sqlite3"},
	"clickhouse":    {"clickhouse-client", "clickhouse"},
	"elasticsearch": {"elasticsearch", "curl"}, // curl 可作 REST 探测兜底
	"oracle":        {"sqlplus"},
	"sqlserver":     {"sqlcmd"},
}

var (
	dbClientCacheMu sync.Mutex
	dbClientCache   = map[string]DBClientStatus{}
)

// DetectDBClient checks PATH for one db type only.
func DetectDBClient(dbType string) DBClientStatus {
	dbType = strings.ToLower(strings.TrimSpace(dbType))
	if dbType == "" {
		return DBClientStatus{}
	}
	dbClientCacheMu.Lock()
	if cached, ok := dbClientCache[dbType]; ok {
		dbClientCacheMu.Unlock()
		return cached
	}
	dbClientCacheMu.Unlock()

	bins := dbClientBins[dbType]
	st := DBClientStatus{DBType: dbType, Label: dbType}
	for _, bin := range bins {
		if path, err := exec.LookPath(bin); err == nil {
			st.OK = true
			st.Bin = path
			st.Label = bin
			break
		}
	}
	dbClientCacheMu.Lock()
	dbClientCache[dbType] = st
	dbClientCacheMu.Unlock()
	return st
}

// DetectDBClientsForTypes detects only the requested types.
func DetectDBClientsForTypes(types []string) map[string]DBClientStatus {
	out := map[string]DBClientStatus{}
	seen := map[string]bool{}
	for _, t := range types {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out[t] = DetectDBClient(t)
	}
	return out
}

// RefreshDBClientCache clears cache then optionally re-detects one type.
func RefreshDBClientCache(dbType string) DBClientStatus {
	dbClientCacheMu.Lock()
	dbClientCache = map[string]DBClientStatus{}
	dbClientCacheMu.Unlock()
	if strings.TrimSpace(dbType) == "" {
		return DBClientStatus{}
	}
	return DetectDBClient(dbType)
}

// SupportedDBTypes returns the built-in type list (order stable).
func SupportedDBTypes() []string {
	return []string{
		"mysql", "mariadb", "pgsql", "redis", "mongodb",
		"sqlite", "clickhouse", "elasticsearch", "oracle", "sqlserver",
	}
}

func attachClientStatus(dbType string, clients map[string]DBClientStatus) (ok bool, bin string) {
	if c, hit := clients[dbType]; hit {
		return c.OK, c.Bin
	}
	return false, ""
}
