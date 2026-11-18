package service

import "testing"

func TestNormalizeIOSBuildMode(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "default", input: "", want: "incremental"},
		{name: "incremental", input: " incremental ", want: "incremental"},
		{name: "full", input: "FULL", want: "full"},
		{name: "invalid", input: "clean", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeIOSBuildMode(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeIOSBuildMode() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("normalizeIOSBuildMode() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeIOSXcodePath(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantApp   string
		wantDev   string
		wantError bool
	}{
		{name: "empty"},
		{
			name:    "app bundle",
			input:   "/Applications/Xcode.app",
			wantApp: "/Applications/Xcode.app",
			wantDev: "/Applications/Xcode.app/Contents/Developer",
		},
		{
			name:    "developer directory",
			input:   "/Applications/Xcode-beta.app/Contents/Developer",
			wantApp: "/Applications/Xcode-beta.app",
			wantDev: "/Applications/Xcode-beta.app/Contents/Developer",
		},
		{name: "relative", input: "Xcode.app", wantError: true},
		{name: "wrong directory", input: "/Applications", wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app, dev, err := normalizeIOSXcodePath(tt.input)
			if (err != nil) != tt.wantError {
				t.Fatalf("normalizeIOSXcodePath() error = %v, wantErr %v", err, tt.wantError)
			}
			if app != tt.wantApp || dev != tt.wantDev {
				t.Fatalf("normalizeIOSXcodePath() = (%q, %q), want (%q, %q)", app, dev, tt.wantApp, tt.wantDev)
			}
		})
	}
}
