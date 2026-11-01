package monitoring

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/usageevent"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

type percentileCountingRepository struct {
	usageevent.Repository
	calls int
}

func (r *percentileCountingRepository) LatencyPercentilesWithFilter(ctx context.Context, filter store.AnalyticsFilter, granularity string, location *time.Location) ([]store.LatencyPercentiles, error) {
	r.calls++
	return r.Repository.LatencyPercentilesWithFilter(ctx, filter, granularity, location)
}

func TestAnalyticsTimelinePercentilesOptOut(t *testing.T) {
	for _, rollup := range []bool{false, true} {
		t.Run(fmt.Sprintf("rollup=%t", rollup), func(t *testing.T) {
			db := newMonitoringTestStore(t)
			ctx := context.Background()
			fromMS := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
			toMS := fromMS + (48 * time.Hour).Milliseconds()
			latency, ttft := int64(300), int64(50)
			event := monitoringEvent("percentiles", fromMS+1_000, "gpt-a", "auth-a", "source-a", false, 100, 50, 0, 0, 150, &latency)
			event.TTFTMS = &ttft
			spikeLatency := int64(900)
			spike := monitoringEvent("percentiles-spike", fromMS+(25*time.Hour).Milliseconds(), "gpt-a", "auth-a", "source-a", false, 100, 50, 0, 0, 150, &spikeLatency)
			spike.TTFTMS = &ttft
			if err := db.SaveModelPrices(ctx, map[string]store.ModelPrice{"gpt-a": {Prompt: 1, Completion: 2}}); err != nil {
				t.Fatal(err)
			}
			if _, err := db.InsertEvents(ctx, []usage.Event{event, spike}); err != nil {
				t.Fatal(err)
			}
			if rollup {
				catchUpMonitoringHourlyRollup(t, ctx, db)
			}
			repo := &percentileCountingRepository{Repository: db.UsageEvents}
			db.UsageEvents = repo
			service := New(db, rollup)
			request := func(includeJSON string) Response {
				t.Helper()
				req := Request{FromMS: fromMS, ToMS: toMS, NowMS: toMS, TimeZone: "UTC"}
				if err := json.Unmarshal([]byte(includeJSON), &req.Include); err != nil {
					t.Fatal(err)
				}
				req.Include.Summary = true
				req.Include.SummaryProfile = "compact"
				req.Include.ModelStats = true
				req.Include.Granularity = "day"
				resp, err := service.Analytics(ctx, req)
				if err != nil {
					t.Fatal(err)
				}
				return resp
			}
			baseline := request(`{"timeline":true,"anomaly_points":true}`)
			if len(baseline.Timeline) != 2 || baseline.Timeline[0].P95LatencyMS == nil || *baseline.Timeline[0].P95LatencyMS != 300 || baseline.Timeline[0].P95TTFTMS == nil || *baseline.Timeline[0].P95TTFTMS != 50 {
				t.Fatalf("missing baseline percentiles: %#v", baseline.Timeline)
			}
			if len(baseline.AnomalyPoints) == 0 {
				t.Fatal("missing latency spike in baseline")
			}
			for _, tc := range []struct {
				name       string
				include    string
				wantCalls  int
				noTimeline bool
				anomalies  bool
			}{
				{"legacy", `{"timeline":true}`, 1, false, false},
				{"explicit_true", `{"timeline":true,"timeline_percentiles":true}`, 1, false, false},
				{"null", `{"timeline":true,"timeline_percentiles":null}`, 1, false, false},
				{"opt_out", `{"timeline":true,"timeline_percentiles":false}`, 0, false, false},
				{"anomalies_need_percentiles", `{"timeline":true,"timeline_percentiles":false,"anomaly_points":true}`, 1, false, true},
				{"anomalies_without_timeline", `{"timeline_percentiles":false,"anomaly_points":true}`, 1, true, true},
				{"no_timeline", `{"timeline_percentiles":true}`, 0, true, false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					repo.calls = 0
					got := request(tc.include)
					if repo.calls != tc.wantCalls {
						t.Fatalf("percentile queries = %d, want %d", repo.calls, tc.wantCalls)
					}
					wantTimeline := append([]TimelinePoint(nil), baseline.Timeline...)
					if tc.noTimeline {
						wantTimeline = nil
					} else if tc.wantCalls == 0 {
						for i := range wantTimeline {
							wantTimeline[i].P95LatencyMS = nil
							wantTimeline[i].P95TTFTMS = nil
						}
					}
					if !reflect.DeepEqual(got.Timeline, wantTimeline) || !reflect.DeepEqual(got.ModelStats, baseline.ModelStats) || !reflect.DeepEqual(got.Summary, baseline.Summary) {
						t.Fatalf("analytics changed beyond requested percentiles: got=%#v wantTimeline=%#v", got, wantTimeline)
					}
					if tc.anomalies && !reflect.DeepEqual(got.AnomalyPoints, baseline.AnomalyPoints) {
						t.Fatalf("unexpected anomalies: %#v", got.AnomalyPoints)
					}
				})
			}
		})
	}
}
