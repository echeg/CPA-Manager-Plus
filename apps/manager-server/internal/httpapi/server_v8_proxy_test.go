package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/testutil"
)

func newV8ProxyTestServer(t *testing.T, upstreamURL string) *Server {
	t.Helper()
	st := testutil.NewStore(t, testutil.NewConfig(t))
	if err := st.SaveSetup(context.Background(), store.Setup{
		CPAUpstreamURL: upstreamURL,
		ManagementKey:  "saved-cpa-key",
	}); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{CORSOrigins: []string{"*"}}
	return New(cfg, st, collector.NewManager(cfg, st))
}

func TestV8ManagementProxyAuthenticatesAndPreservesRequest(t *testing.T) {
	type request struct{ method, uri, body, auth string }
	observed := make(chan request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		observed <- request{r.Method, r.RequestURI, string(body), r.Header.Get("Authorization")}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-CPA-Version", "v8-test")
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()
	server := newV8ProxyTestServer(t, upstream.URL)

	for _, tc := range []request{
		{method: http.MethodGet, uri: "/v8/management/config"},
		{method: http.MethodPatch, uri: "/v8/management/config", body: `{"routing":{"strategy":"fill-first"}}`},
		{method: http.MethodPut, uri: "/v8/management/config/oauth/providers/codex/fast-mode", body: `true`},
		{method: http.MethodDelete, uri: "/v8/management/config/oauth/providers/codex/fast-mode"},
		{method: http.MethodGet, uri: "/v8/management/routing/activity?limit=12&model=gpt%2Btest"},
		{method: http.MethodPost, uri: "/v8/management/routing/cooldown/reset", body: `{"auth_index":"auth-1"}`},
		{method: http.MethodPost, uri: "/v8/management/requests/api-call", body: `{"method":"GET","url":"https://example.test/quota","auth_index":"auth-1"}`},
		{method: http.MethodGet, uri: "/v8/management/credentials?name=auth%20a.json&auth_index=auth-1"},
		{method: http.MethodGet, uri: "/v8/management/credentials/download?name=auth%20a.json"},
	} {
		t.Run(tc.method+" "+tc.uri, func(t *testing.T) {
			for _, key := range []string{"", "invalid-key", "saved-cpa-key"} {
				rr := testutil.Request(t, server.Handler(), tc.method, tc.uri, tc.body, key)
				testutil.RequireStatus(t, rr, http.StatusUnauthorized)
				select {
				case got := <-observed:
					t.Fatalf("unauthorized request reached CPA: %#v", got)
				default:
				}
			}
			rr := testutil.Request(t, server.Handler(), tc.method, tc.uri, tc.body, testutil.AdminKey)
			testutil.RequireStatus(t, rr, http.StatusAccepted)
			got := <-observed
			if got.method != tc.method || got.uri != tc.uri || got.body != tc.body || got.auth != "Bearer saved-cpa-key" {
				t.Fatalf("upstream request = %#v, expected %#v with saved CPA key", got, tc)
			}
			if rr.Body.String() != `{"ok":true}` || rr.Header().Get("X-CPA-Version") != "v8-test" {
				t.Fatalf("upstream response changed: headers=%v body=%q", rr.Header(), rr.Body.String())
			}
		})
	}
	for _, path := range []string{"/v8/management-extra/config", "/v8/responses", "/v1/responses"} {
		rr := testutil.Request(t, server.Handler(), http.MethodPost, path, `{}`, testutil.AdminKey)
		testutil.RequireStatus(t, rr, http.StatusNotFound)
	}
	rr := testutil.Request(t, server.Handler(), http.MethodOptions, "/v8/management/config", "", "")
	testutil.RequireStatus(t, rr, http.StatusNoContent)
	if !strings.Contains(rr.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatal("v8 preflight does not allow authorization")
	}
}

func TestV8ManagementProxyRequiresSetup(t *testing.T) {
	handler := newTestHandler(t, "", false)
	rr := testutil.Request(t, handler, http.MethodGet, "/v8/management/config", "", testutil.AdminKey)
	testutil.RequireStatus(t, rr, http.StatusPreconditionRequired)
}

// waitObservedContext reports when the coordinator actually waits for a held lock.
// This lets the test prove serialization without sleeps or timing assumptions.
type waitObservedContext struct {
	context.Context
	waiting chan struct{}
	once    sync.Once
}

func (c *waitObservedContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.waiting) })
	return c.Context.Done()
}

func v8CredentialMutationRequest(t *testing.T, kind string) *http.Request {
	t.Helper()
	var req *http.Request
	switch kind {
	case "status":
		req = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/status", strings.NewReader(`{"name":"auth-a.json","auth_index":"auth-1","disabled":false}`))
	case "disabled-fields":
		req = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/fields", strings.NewReader(`{"name":"auth-a.json","disabled":false,"quota_reserve":{"percent":20,"mode":"soft"}}`))
	case "fields":
		req = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/fields", strings.NewReader(`{"name":"auth-a.json","quota_reserve":{"percent":20,"mode":"soft"}}`))
	case "raw-upload":
		req = httptest.NewRequest(http.MethodPost, "/v8/management/credentials?name=auth-a.json", strings.NewReader(`{"type":"codex","disabled":false}`))
	case "delete-all":
		req = httptest.NewRequest(http.MethodDelete, "/v8/management/credentials?all=1", nil)
	case "runtime-delete":
		req = httptest.NewRequest(http.MethodDelete, "/v8/management/credentials?name=runtime-1", nil)
	case "delete":
		req = httptest.NewRequest(http.MethodDelete, "/v8/management/credentials?name=auth-a.json", nil)
	case "upload":
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "auth-a.json")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(part, `{"type":"codex","disabled":false}`)
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		req = httptest.NewRequest(http.MethodPost, "/v8/management/credentials", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
	default:
		t.Fatalf("unknown mutation kind %q", kind)
	}
	if req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+testutil.AdminKey)
	return req
}

func TestV8CredentialMutationsShareRecoveryOwnershipAndWorkerLocks(t *testing.T) {
	for _, kind := range []string{"status", "fields", "disabled-fields", "delete", "runtime-delete", "delete-all", "upload", "raw-upload"} {
		t.Run(kind, func(t *testing.T) {
			entered := make(chan int, 1)
			finish := make(chan struct{})
			var finishOnce sync.Once
			releaseUpstream := func() { finishOnce.Do(func() { close(finish) }) }
			defer releaseUpstream()
			var server *Server
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer saved-cpa-key" {
					t.Errorf("wrong CPA authorization: %q", r.Header.Get("Authorization"))
				}
				if r.Method == http.MethodGet && r.URL.Path == "/v0/management/auth-files" {
					_ = json.NewEncoder(w).Encode(map[string]any{"files": []map[string]any{{
						"id": "runtime-1", "name": "auth-a.json", "auth_index": "auth-1", "provider": "codex", "disabled": true,
					}}})
					return
				}
				if !strings.HasPrefix(r.URL.Path, "/v8/management/credentials") {
					t.Errorf("unexpected upstream request %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
					return
				}
				if kind == "disabled-fields" {
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["name"] != "runtime-1" || body["disabled"] != false || body["quota_reserve"] == nil {
						t.Errorf("generic credential patch lost fields or target identity: %#v", body)
					}
				}
				items, err := server.AppContext().Store.ListCodexInspectionDisableOwnership(context.Background())
				if err != nil {
					t.Error(err)
				}
				entered <- len(items)
				<-finish
				_, _ = io.WriteString(w, `{"status":"ok"}`)
			}))
			t.Cleanup(upstream.Close)
			server = newV8ProxyTestServer(t, upstream.URL)
			st := server.AppContext().Store
			if err := st.UpsertCodexInspectionDisableOwnership(context.Background(), model.CodexInspectionDisableOwnership{
				FileName: "auth-a.json", AuthIndex: "auth-1", Provider: "codex",
			}); err != nil {
				t.Fatal(err)
			}
			req := v8CredentialMutationRequest(t, kind)
			response := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				rr := httptest.NewRecorder()
				server.Handler().ServeHTTP(rr, req)
				response <- rr
			}()
			var ownershipAtCPA int
			select {
			case ownershipAtCPA = <-entered:
			case rr := <-response:
				t.Fatalf("mutation never reached upstream: %d %s", rr.Code, rr.Body.String())
			case <-time.After(5 * time.Second):
				t.Fatal("mutation did not reach upstream")
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			waitCtx := &waitObservedContext{Context: ctx, waiting: make(chan struct{})}
			workerDone := make(chan error, 1)
			go func() {
				release, err := server.AppContext().AuthFileMutationCoordinator.Acquire(waitCtx, "auth-a.json")
				if err == nil {
					release()
				}
				workerDone <- err
			}()
			select {
			case <-waitCtx.waiting:
			case err := <-workerDone:
				releaseUpstream()
				t.Fatalf("automation acquired lock during manual mutation: %v", err)
			case <-time.After(5 * time.Second):
				releaseUpstream()
				t.Fatal("automation did not attempt the mutation lock")
			}
			releaseUpstream()
			testutil.RequireStatus(t, <-response, http.StatusOK)
			if err := <-workerDone; err != nil {
				t.Fatal(err)
			}
			wantOwnership := 0
			if kind == "fields" {
				// Reserve/priority edits preserve disabled state and therefore keep recovery ownership.
				wantOwnership = 1
			}
			items, err := st.ListCodexInspectionDisableOwnership(context.Background())
			if err != nil || ownershipAtCPA != wantOwnership || len(items) != wantOwnership {
				t.Fatalf("ownership before CPA=%d after=%v error=%v; want %d", ownershipAtCPA, items, err, wantOwnership)
			}
		})
	}
}

func TestV8CredentialStatusFailureRestoresOwnership(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/auth-files" {
			_, _ = io.WriteString(w, `{"files":[{"id":"runtime-1","name":"auth-a.json","auth_index":"auth-1","provider":"codex"}]}`)
			return
		}
		calls.Add(1)
		http.Error(w, "credential changed", http.StatusConflict)
	}))
	defer upstream.Close()
	server := newV8ProxyTestServer(t, upstream.URL)
	st := server.AppContext().Store
	if err := st.UpsertCodexInspectionDisableOwnership(context.Background(), model.CodexInspectionDisableOwnership{
		FileName: "auth-a.json", AuthIndex: "auth-1", Provider: "codex",
	}); err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, v8CredentialMutationRequest(t, "status"))
	testutil.RequireStatus(t, rr, http.StatusConflict)
	items, err := st.ListCodexInspectionDisableOwnership(context.Background())
	if err != nil || len(items) != 1 || calls.Load() != 1 {
		t.Fatalf("failed mutation ownership=%v calls=%d error=%v", items, calls.Load(), err)
	}
}
