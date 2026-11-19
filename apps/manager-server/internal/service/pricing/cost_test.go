package pricing

import (
	"math"
	"testing"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

func TestCostForModelSeparatesCachedInputTokens(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-cached": {Prompt: 2, Completion: 4, Cache: 1},
	}

	cost := CostForModel("gpt-cached", ModelTokens{
		InputTokens:  1_000_000,
		OutputTokens: 500_000,
		CachedTokens: 250_000,
	}, prices)

	if math.Abs(cost-3.75) > 0.000001 {
		t.Fatalf("cost = %v, want 3.75", cost)
	}
}

func TestCostForModelDoesNotCreateNegativePromptCost(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-cached": {Prompt: 10, Cache: 1},
	}

	cost := CostForModel("gpt-cached", ModelTokens{
		InputTokens:  100_000,
		CachedTokens: 250_000,
	}, prices)

	if math.Abs(cost-0.25) > 0.000001 {
		t.Fatalf("cost = %v, want 0.25", cost)
	}
}

func TestCostForModelPricesFineGrainedCacheOutsideInput(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"claude-cached": {Prompt: 2, Completion: 4, Cache: 1, CacheRead: 1, CacheCreation: 3},
	}

	cost := CostForModel("claude-cached", ModelTokens{
		InputTokens:         2_600_000,
		OutputTokens:        250_000,
		CachedTokens:        0,
		CacheReadTokens:     2_000_000,
		CacheCreationTokens: 100_000,
	}, prices)

	if math.Abs(cost-4.3) > 0.000001 {
		t.Fatalf("cost = %v, want 4.3", cost)
	}
}

func TestCostForModelPricesResidualCompatCachedWithFineGrainedCache(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"mixed-cache": {Prompt: 2, Completion: 4, Cache: 1, CacheRead: 0.5, CacheCreation: 3},
	}

	cost := CostForModel("mixed-cache", ModelTokens{
		InputTokens:         1_300_000,
		CachedTokens:        100_000,
		CacheReadTokens:     200_000,
		CacheCreationTokens: 100_000,
	}, prices)

	if math.Abs(cost-2.3) > 0.000001 {
		t.Fatalf("cost = %v, want 2.3", cost)
	}
}

func TestCostForModelDoesNotDoubleBillOpenAICacheMirror(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.4-mini": {Prompt: 2, Cache: 1, CacheRead: 1},
	}
	cost := CostForModel("gpt-5.4-mini", ModelTokens{
		InputTokens:     1_000_000,
		CacheReadTokens: 400_000,
	}, prices)
	if math.Abs(cost-1.6) > 0.000001 {
		t.Fatalf("cost = %v, want 1.6", cost)
	}
}

func TestCostForModelAppliesContextTierToWholeAggregate(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"tiered-model": {
			Prompt: 1, Completion: 2,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 100, Prompt: 3, Completion: 4, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	cost := CostForModel("tiered-model", ModelTokens{
		ContextThresholdTokens: 100,
		InputTokens:            1_000_000,
		OutputTokens:           500_000,
	}, prices)
	if math.Abs(cost-5) > 0.000001 {
		t.Fatalf("tiered cost = %v, want 5", cost)
	}
	baseCost := CostForModel("tiered-model", ModelTokens{
		ContextThresholdTokens: model.ModelPriceBaseContextThreshold,
		InputTokens:            1_000_000,
		OutputTokens:           500_000,
	}, prices)
	if math.Abs(baseCost-2) > 0.000001 {
		t.Fatalf("base-band cost = %v, want 2", baseCost)
	}
}

func TestContextTierOverridesLegacyLongContextPricing(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.6-sol": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 272_000, Prompt: 10, Completion: 40, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	cost := CostForModel("gpt-5.6-sol", ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		LongInputTokens:        1_000_000,
	}, prices)
	if math.Abs(cost-10) > 0.000001 {
		t.Fatalf("generic context-tier cost = %v, want 10", cost)
	}
}

func gpt56SolFastContextPrices() map[string]model.ModelPrice {
	return map[string]model.ModelPrice{
		"gpt-5.6-sol": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 272_000, Prompt: 10, Completion: 40, PromptConfigured: true, CompletionConfigured: true},
			},
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "fast", ServiceTier: "priority", Prompt: 12.5, Completion: 75, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
}

func TestContextTierScalesExplicitServiceTierRule(t *testing.T) {
	prices := gpt56SolFastContextPrices()
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		OutputTokens:           1_000_000,
		LongInputTokens:        1_000_000,
		LongOutputTokens:       1_000_000,
	}
	// Fast ratio 2.5 on input and output: 10 x 2.5 = 25, 40 x 2.5 = 100.
	for _, tier := range []string{"priority", "fast"} {
		if got := CostForModelWithServiceTier("gpt-5.6-sol", tier, tokens, prices); math.Abs(got-125) > 0.000001 {
			t.Fatalf("%s context-tier cost = %v, want 125", tier, got)
		}
	}
	if got := CostForModelWithServiceTier("gpt-5.6-sol", "default", tokens, prices); math.Abs(got-50) > 0.000001 {
		t.Fatalf("default context-tier cost = %v, want 50", got)
	}
}

// gpt62SolUltrafastPrices is the shared gpt-6.2-sol example (base 2 / 10,
// context tier above 272k 4 / 15, Ultrafast rule 6 / 30). The caller sets the
// rule's cache rates; mode, tier, input and output rates are filled in here.
func gpt62SolUltrafastPrices(rule model.ModelPriceServiceTier) map[string]model.ModelPrice {
	rule.Mode, rule.ServiceTier = "ultrafast", "ultrafast"
	rule.Prompt, rule.Completion = 6, 30
	rule.PromptConfigured, rule.CompletionConfigured = true, true
	return map[string]model.ModelPrice{
		"gpt-6.2-sol": {
			Prompt: 2, Completion: 10, Cache: 0.2, CacheRead: 0.2, CacheCreation: 2.5,
			PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true, CacheCreationConfigured: true,
			ContextTiers: []model.ModelPriceContextTier{{
				ThresholdTokens: 272_000, Prompt: 4, Completion: 15, Cache: 0.4, CacheRead: 0.4,
				PromptConfigured: true, CompletionConfigured: true, CacheConfigured: true, CacheReadConfigured: true,
			}},
			ServiceTiers: []model.ModelPriceServiceTier{rule},
		},
	}
}

func TestContextTierScalesGPT62SolUltrafastRule(t *testing.T) {
	prices := gpt62SolUltrafastPrices(model.ModelPriceServiceTier{
		Cache: 0.6, CacheRead: 0.6, CacheConfigured: true, CacheReadConfigured: true,
	})
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		OutputTokens:           1_000_000,
		CachedTokens:           500_000,
	}
	// 500k prompt at 12 = 6, 500k cached at 0.4 x 3 = 0.6, 1M output at 45 = 45.
	got := CostForModelWithServiceTier("gpt-6.2-sol", "ultrafast", tokens, prices)
	if math.Abs(got-51.6) > 0.000001 {
		t.Fatalf("ultrafast long-context cost = %v, want 51.6", got)
	}
	// The same aggregate on the standard tier stays at the plain context rates.
	standard := CostForModelWithServiceTier("gpt-6.2-sol", "default", tokens, prices)
	if math.Abs(standard-17.2) > 0.000001 {
		t.Fatalf("standard long-context cost = %v, want 17.2", standard)
	}
}

func TestContextTierScalesCacheReadAndWriteRatesByRuleRatio(t *testing.T) {
	prices := gpt62SolUltrafastPrices(model.ModelPriceServiceTier{
		CacheRead: 0.6, CacheCreation: 7.5, CacheReadConfigured: true, CacheCreationConfigured: true,
	})
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		CacheReadTokens:        400_000,
		CacheCreationTokens:    100_000,
	}
	// 500k prompt at 12 = 6, 400k cache reads at 0.4 x 3 = 0.48, 100k cache
	// writes at the inherited base 2.5 x 3 = 0.75.
	if got := CostForModelWithServiceTier("gpt-6.2-sol", "ultrafast", tokens, prices); math.Abs(got-7.23) > 0.000001 {
		t.Fatalf("ultrafast long-context cache cost = %v, want 7.23", got)
	}
	// Standard tier: 500k at 4 = 2, 400k at 0.4 = 0.16, 100k at 2.5 = 0.25.
	if got := CostForModelWithServiceTier("gpt-6.2-sol", "default", tokens, prices); math.Abs(got-2.41) > 0.000001 {
		t.Fatalf("standard long-context cache cost = %v, want 2.41", got)
	}
}

func TestContextTierKeepsExplicitZeroRuleRate(t *testing.T) {
	prices := gpt62SolUltrafastPrices(model.ModelPriceServiceTier{CacheRead: 0, CacheReadConfigured: true})
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		CacheReadTokens:        400_000,
	}
	// 600k prompt at 12 = 7.2; the explicit zero rule rate makes cache reads free.
	if got := CostForModelWithServiceTier("gpt-6.2-sol", "ultrafast", tokens, prices); math.Abs(got-7.2) > 0.000001 {
		t.Fatalf("explicit zero cache-read cost = %v, want 7.2", got)
	}
}

func TestContextTierRuleRatioUsesEnrichedGPT56BaseCacheRates(t *testing.T) {
	prices := gpt56SolFastContextPrices()
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		CacheReadTokens:        500_000,
		CacheCreationTokens:    100_000,
	}
	// The base has no cache rates, so GPT-5.6 fills them from the prompt rate
	// (0.5 and 6.25). The Fast rule sets none, so the context tier keeps them:
	// 400k prompt at 25 = 10, 500k reads at 0.5 = 0.25, 100k writes at 6.25 = 0.625.
	if got := CostForModelWithServiceTier("gpt-5.6-sol", "fast", tokens, prices); math.Abs(got-10.875) > 0.000001 {
		t.Fatalf("fast long-context cache cost = %v, want 10.875", got)
	}
}

func TestContextTierRuleUsesRuleRateOverZeroBaseOnNonOfficialGPT56Model(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.6": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{{
				ThresholdTokens: 272_000, Prompt: 10, Completion: 40, CacheRead: 1,
				PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true,
			}},
			ServiceTiers: []model.ModelPriceServiceTier{{
				Mode: "fast", ServiceTier: "priority", Prompt: 12.5, Completion: 75, CacheRead: 1.25,
				PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true,
			}},
		},
	}
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		CacheReadTokens:        500_000,
	}
	// Only the official GPT-5.6 models get filled-in cache rates, so the stored
	// base cache read stays 0 and the rule rate 1.25 applies as is:
	// 500k prompt at 25 = 12.5, 500k reads at 1.25 = 0.625.
	if got := CostForModelWithServiceTier("gpt-5.6", "fast", tokens, prices); math.Abs(got-13.125) > 0.000001 {
		t.Fatalf("fast long-context cost = %v, want 13.125", got)
	}
}

func TestContextTierDoesNotStackBuiltInPriorityMultiplier(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 272_000, Prompt: 10, Completion: 45, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		LongInputTokens:        1_000_000,
	}
	if got := CostForModelWithServiceTier("gpt-5.5", "priority", tokens, prices); math.Abs(got-10) > 0.000001 {
		t.Fatalf("multiplier-only priority context-tier cost = %v, want 10", got)
	}
}

func TestContextTierIgnoresFlexDiscountWithoutRule(t *testing.T) {
	prices := gpt56SolFastContextPrices()
	tokens := ModelTokens{
		ContextThresholdTokens: 272_000,
		InputTokens:            1_000_000,
		LongInputTokens:        1_000_000,
	}
	if got := CostForModelWithServiceTier("gpt-5.6-sol", "flex", tokens, prices); math.Abs(got-10) > 0.000001 {
		t.Fatalf("flex context-tier cost = %v, want 10", got)
	}
}

func TestExplicitFastPriceAppliesToBaseContextBandForFastAndPriority(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 272_000, Prompt: 10, Completion: 45, PromptConfigured: true, CompletionConfigured: true},
			},
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "fast", ServiceTier: "priority", Prompt: 12.5, Completion: 75, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	tokens := ModelTokens{
		ContextThresholdTokens: model.ModelPriceBaseContextThreshold,
		InputTokens:            100_000,
		OutputTokens:           10_000,
	}
	for _, tier := range []string{"fast", "priority"} {
		if got := CostForModelWithServiceTier("gpt-5.5", tier, tokens, prices); math.Abs(got-2) > 0.000001 {
			t.Fatalf("%s base-band cost = %v, want 2", tier, got)
		}
	}
	if got := CostForModelWithServiceTier("gpt-5.5", "default", tokens, prices); math.Abs(got-0.8) > 0.000001 {
		t.Fatalf("default base-band cost = %v, want 0.8", got)
	}
}

func TestExplicitFastBaseBandDoesNotReenableLegacyLongContext(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 30,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 500_000, Prompt: 10, Completion: 45, PromptConfigured: true, CompletionConfigured: true},
			},
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "fast", ServiceTier: "priority", Prompt: 10, Completion: 20, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	tokens := ModelTokens{
		ContextThresholdTokens: model.ModelPriceBaseContextThreshold,
		InputTokens:            300_000,
		OutputTokens:           100_000,
		LongInputTokens:        300_000,
		LongOutputTokens:       100_000,
	}
	if got := CostForModelWithServiceTier("gpt-5.5", "priority", tokens, prices); math.Abs(got-5) > 0.000001 {
		t.Fatalf("priority base-band cost = %v, want 5", got)
	}
}

func TestLegacyLongContextPriceOverridesExplicitFastPrice(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 30,
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "fast", ServiceTier: "priority", Prompt: 12.5, Completion: 75, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	tokens := ModelTokens{
		InputTokens:      300_000,
		OutputTokens:     100_000,
		LongInputTokens:  300_000,
		LongOutputTokens: 100_000,
	}
	if got := CostForModelWithServiceTier("gpt-5.5", "priority", tokens, prices); math.Abs(got-7.5) > 0.000001 {
		t.Fatalf("priority long-context cost = %v, want 7.5", got)
	}
}

func TestLegacyLongContextAppliesServiceTierOnlyToShortSegment(t *testing.T) {
	tokens := ModelTokens{
		InputTokens:     400_000,
		LongInputTokens: 300_000,
	}
	tests := []struct {
		name   string
		prices map[string]model.ModelPrice
	}{
		{
			name: "explicit fast price",
			prices: map[string]model.ModelPrice{
				"gpt-5.5": {
					Prompt: 5,
					ServiceTiers: []model.ModelPriceServiceTier{
						{Mode: "fast", ServiceTier: "priority", Prompt: 12.5, PromptConfigured: true},
					},
				},
			},
		},
		{
			name: "compatibility multiplier",
			prices: map[string]model.ModelPrice{
				"gpt-5.5": {Prompt: 5},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CostForModelWithServiceTier("gpt-5.5", "priority", tokens, tt.prices); math.Abs(got-4.25) > 0.000001 {
				t.Fatalf("mixed priority cost = %v, want 4.25", got)
			}
		})
	}
}

func TestLegacyLongContextSplitsEveryTokenBucketForPriorityPricing(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 10, Cache: 1, CacheRead: 2, CacheCreation: 3,
			ServiceTiers: []model.ModelPriceServiceTier{
				{
					Mode: "fast", ServiceTier: "priority",
					Prompt: 10, Completion: 20, Cache: 2, CacheRead: 4, CacheCreation: 6,
					PromptConfigured: true, CompletionConfigured: true, CacheConfigured: true,
					CacheReadConfigured: true, CacheCreationConfigured: true,
				},
			},
		},
	}
	tokens := ModelTokens{
		InputTokens:             400_000,
		OutputTokens:            40_000,
		CachedTokens:            40_000,
		CacheReadTokens:         40_000,
		CacheCreationTokens:     40_000,
		LongInputTokens:         300_000,
		LongOutputTokens:        30_000,
		LongCachedTokens:        30_000,
		LongCacheReadTokens:     30_000,
		LongCacheCreationTokens: 30_000,
	}
	if got := CostForModelWithServiceTier("gpt-5.5", "priority", tokens, prices); math.Abs(got-3.93) > 0.000001 {
		t.Fatalf("mixed priority token-bucket cost = %v, want 3.93", got)
	}
}

func TestLegacyLongContextKeepsFlexAndBatchDiscounts(t *testing.T) {
	prices := map[string]model.ModelPrice{"gpt-5.5": {Prompt: 5}}
	tokens := ModelTokens{
		InputTokens:     400_000,
		LongInputTokens: 300_000,
	}
	standard := CostForModelWithServiceTier("gpt-5.5", "default", tokens, prices)
	for _, tier := range []string{"flex", "batch"} {
		if got := CostForModelWithServiceTier("gpt-5.5", tier, tokens, prices); math.Abs(got-standard*0.5) > 0.000001 {
			t.Fatalf("%s mixed long-context cost = %v, want %v", tier, got, standard*0.5)
		}
	}
}

func TestLegacyLongContextUsesExplicitNonPriorityServiceTierPrice(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5,
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "batch", ServiceTier: "batch", Prompt: 2, PromptConfigured: true},
			},
		},
	}
	tokens := ModelTokens{InputTokens: 300_000, LongInputTokens: 300_000}
	if got := CostForModelWithServiceTier("gpt-5.5", "batch", tokens, prices); math.Abs(got-1.2) > 0.000001 {
		t.Fatalf("explicit batch long-context cost = %v, want 1.2", got)
	}
}

func TestCostCandidatesUseClassifiedPricingModel(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"display-model": {Prompt: 1},
		"priced-alias": {
			Prompt: 2,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 100, Prompt: 7, PromptConfigured: true},
			},
		},
	}
	cost := CostForModelCandidatesWithServiceTier(
		[]string{"missing-resolved", "display-model"},
		"default",
		ModelTokens{
			PricingModel:           "priced-alias",
			ContextThresholdTokens: 100,
			InputTokens:            1_000_000,
		},
		prices,
	)
	if math.Abs(cost-7) > 0.000001 {
		t.Fatalf("classified pricing-model cost = %v, want 7", cost)
	}
}

func TestServiceTierMultiplier(t *testing.T) {
	tests := []struct {
		name        string
		model       string
		serviceTier string
		want        float64
	}{
		{name: "gpt-5.4 default", model: "gpt-5.4", serviceTier: "default", want: 1},
		{name: "gpt-5.6 priority", model: "gpt-5.6-sol", serviceTier: "priority", want: 2},
		{name: "namespaced gpt-5.6 fast", model: "openai/gpt-5.6-terra", serviceTier: "fast", want: 2},
		{name: "gpt-5.4 priority", model: "gpt-5.4", serviceTier: "priority", want: 2},
		{name: "gpt-5.4 fast", model: "gpt-5.4", serviceTier: "fast", want: 2},
		{name: "gpt-5.4 mini priority", model: "gpt-5.4-mini", serviceTier: "priority", want: 2},
		{name: "gpt-5.5 priority", model: "gpt-5.5", serviceTier: "priority", want: 2.5},
		{name: "gpt-5.3 codex priority", model: "gpt-5.3-codex", serviceTier: "priority", want: 2},
		{name: "unknown tier", model: "gpt-5.4", serviceTier: "accelerated", want: 1},
		{name: "unknown priority model", model: "gpt-unknown", serviceTier: "priority", want: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ServiceTierMultiplier(tt.model, tt.serviceTier)
			if got != tt.want {
				t.Fatalf("ServiceTierMultiplier(%q, %q) = %v, want %v", tt.model, tt.serviceTier, got, tt.want)
			}
		})
	}
}

func TestCostForGPT56UsesOfficialFallbackPrice(t *testing.T) {
	cost := CostForModel("openai/gpt-5.6-sol", ModelTokens{
		InputTokens:         1_000_000,
		OutputTokens:        100_000,
		CachedTokens:        100_000,
		CacheReadTokens:     200_000,
		CacheCreationTokens: 100_000,
	}, nil)

	if math.Abs(cost-6.775) > 0.000001 {
		t.Fatalf("fallback cost = %v, want 6.775", cost)
	}
}

func TestCostForGPT56PrefersConfiguredBasePrice(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.6-sol": {Prompt: 9, Completion: 18},
	}

	cost := CostForModel("gpt-5.6-sol", ModelTokens{InputTokens: 1_000_000}, prices)
	if math.Abs(cost-9) > 0.000001 {
		t.Fatalf("configured cost = %v, want 9", cost)
	}
}

func TestCostForGPT56AppliesLongContextMultipliers(t *testing.T) {
	tokens := ModelTokens{
		InputTokens:             1_000_000,
		OutputTokens:            100_000,
		CacheReadTokens:         200_000,
		CacheCreationTokens:     100_000,
		LongInputTokens:         1_000_000,
		LongOutputTokens:        100_000,
		LongCacheReadTokens:     200_000,
		LongCacheCreationTokens: 100_000,
	}

	cost := CostForModel("gpt-5.6-sol", tokens, nil)
	if math.Abs(cost-12.95) > 0.000001 {
		t.Fatalf("long-context cost = %v, want 12.95", cost)
	}
}

func TestCostForGPT56KeepsExactly272KAtStandardRates(t *testing.T) {
	cost := CostForModel("gpt-5.6-luna", ModelTokens{
		InputTokens:  272_000,
		OutputTokens: 100_000,
	}, nil)

	if math.Abs(cost-0.872) > 0.000001 {
		t.Fatalf("272K cost = %v, want 0.872", cost)
	}
}

func TestCostForGPT56UsesPromptRatiosWhenCachePricesAreMissing(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.6-terra": {Prompt: 10, Completion: 20, Cache: 10},
	}
	cost := CostForModelWithServiceTier("gpt-5.6-terra", "priority", ModelTokens{
		InputTokens:         1_000_000,
		CacheReadTokens:     200_000,
		CacheCreationTokens: 100_000,
	}, prices)

	if math.Abs(cost-16.9) > 0.000001 {
		t.Fatalf("priority fallback-ratio cost = %v, want 16.9", cost)
	}
}

func TestCostForGPT56RespectsExplicitZeroPrices(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.6-sol": {
			Prompt: 5, Completion: 30, Cache: 0.5,
			PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true, CacheCreationConfigured: true,
		},
	}
	cost := CostForModel("gpt-5.6-sol", ModelTokens{
		InputTokens:         250_000,
		CacheReadTokens:     150_000,
		CacheCreationTokens: 100_000,
	}, prices)

	if cost != 0 {
		t.Fatalf("explicit-zero cost = %v, want 0", cost)
	}
}

func TestCostForGPT56AliasPriceUsesResolvedModelBehavior(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"internal-fast": {Prompt: 2, Completion: 4},
	}
	cost := CostForModelCandidatesWithServiceTier(
		[]string{"openai/gpt-5.6-luna", "internal-fast"},
		"default",
		ModelTokens{
			InputTokens:         1_000_000,
			CacheReadTokens:     200_000,
			CacheCreationTokens: 100_000,
		},
		prices,
	)

	if math.Abs(cost-1.69) > 0.000001 {
		t.Fatalf("alias cost = %v, want 1.69", cost)
	}
}

func TestCostForModelCandidatesKeepsResolvedNonGPTBehavior(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"resolved-other": {Prompt: 2, Completion: 4},
	}
	cost := CostForModelCandidatesWithServiceTier(
		[]string{"resolved-other", "gpt-5.6-sol"},
		"priority",
		ModelTokens{InputTokens: 1_000_000, LongInputTokens: 1_000_000},
		prices,
	)

	if math.Abs(cost-2) > 0.000001 {
		t.Fatalf("resolved non-GPT cost = %v, want 2", cost)
	}
}

func TestCostForModelWithServiceTier(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.4": {Prompt: 2.5, Completion: 5, Cache: 1},
	}

	tokens := ModelTokens{InputTokens: 1_000_000}
	if cost := CostForModelWithServiceTier("gpt-5.4", "default", tokens, prices); math.Abs(cost-2.5) > 0.000001 {
		t.Fatalf("default cost = %v, want 2.5", cost)
	}
	if cost := CostForModelWithServiceTier("gpt-5.4", "priority", tokens, prices); math.Abs(cost-5) > 0.000001 {
		t.Fatalf("priority cost = %v, want 5", cost)
	}
	if cost := CostForModelWithServiceTier("missing-model", "priority", tokens, prices); cost != 0 {
		t.Fatalf("missing model cost = %v, want 0", cost)
	}
}

func TestCostForModelCandidatesWithServiceTierFallsBackToRequestedModel(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.4": {Prompt: 2.5, Completion: 5, Cache: 1},
	}

	cost := CostForModelCandidatesWithServiceTier(
		[]string{"missing-upstream", "gpt-5.4"},
		"priority",
		ModelTokens{InputTokens: 1_000_000},
		prices,
	)

	if math.Abs(cost-2.5) > 0.000001 {
		t.Fatalf("fallback cost = %v, want 2.5", cost)
	}
}

func TestCostForModelCandidatesWithServiceTierPrefersResolvedModel(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-resolved": {Prompt: 1, Completion: 2, Cache: 0.5},
		"gpt-5.4":      {Prompt: 2.5, Completion: 5, Cache: 1},
	}

	cost := CostForModelCandidatesWithServiceTier(
		[]string{"gpt-resolved", "gpt-5.4"},
		"priority",
		ModelTokens{InputTokens: 1_000_000},
		prices,
	)

	if math.Abs(cost-1) > 0.000001 {
		t.Fatalf("resolved cost = %v, want 1", cost)
	}
}

func TestCostForModelWithServiceTierPreservesCacheBuckets(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.4": {Prompt: 2, Completion: 4, Cache: 1, CacheRead: 0.5, CacheCreation: 3},
	}

	cost := CostForModelWithServiceTier("gpt-5.4", "priority", ModelTokens{
		InputTokens:         1_300_000,
		CachedTokens:        100_000,
		CacheReadTokens:     200_000,
		CacheCreationTokens: 100_000,
	}, prices)

	if math.Abs(cost-4.6) > 0.000001 {
		t.Fatalf("priority cache cost = %v, want 4.6", cost)
	}
}

func TestLongContextPremiumCoversGPT54AndGPT55(t *testing.T) {
	prices := map[string]model.ModelPrice{
		"gpt-5.4": {Prompt: 2.5, Completion: 15, Cache: 0.25},
		"gpt-5.5": {Prompt: 5, Completion: 30, Cache: 0.5},
	}
	tokens := ModelTokens{
		InputTokens:      300_000,
		OutputTokens:     100_000,
		LongInputTokens:  300_000,
		LongOutputTokens: 100_000,
	}
	if got := CostForModel("gpt-5.4", tokens, prices); math.Abs(got-3.75) > 0.000001 {
		t.Fatalf("gpt-5.4 long cost = %v, want 3.75", got)
	}
	if got := CostForModel("gpt-5.5", tokens, prices); math.Abs(got-7.5) > 0.000001 {
		t.Fatalf("gpt-5.5 long cost = %v, want 7.5", got)
	}
}

func TestLongContextDoesNotStackPriorityMultiplier(t *testing.T) {
	tokens := ModelTokens{InputTokens: 300_000, OutputTokens: 100_000, LongInputTokens: 300_000, LongOutputTokens: 100_000}
	standard := CostForModelWithServiceTier("gpt-5.6-luna", "default", tokens, nil)
	priority := CostForModelWithServiceTier("gpt-5.6-luna", "priority", tokens, nil)
	if math.Abs(priority-standard) > 0.000001 {
		t.Fatalf("priority long cost = %v, want standard long cost %v", priority, standard)
	}
}

func TestFlexUsesHalfPrice(t *testing.T) {
	prices := map[string]model.ModelPrice{"gpt-5.5": {Prompt: 5, Completion: 30, Cache: 0.5}}
	got := CostForModelWithServiceTier("gpt-5.5", "flex", ModelTokens{InputTokens: 1_000_000}, prices)
	if math.Abs(got-2.5) > 0.000001 {
		t.Fatalf("flex cost = %v, want 2.5", got)
	}
}

func BenchmarkCostForModelWithExplicitServiceTier(b *testing.B) {
	prices := map[string]model.ModelPrice{
		"gpt-5.5": {
			Prompt: 5, Completion: 30, Cache: 0.5,
			ContextTiers: []model.ModelPriceContextTier{
				{ThresholdTokens: 272_000, Prompt: 10, Completion: 45, PromptConfigured: true, CompletionConfigured: true},
			},
			ServiceTiers: []model.ModelPriceServiceTier{
				{Mode: "fast", ServiceTier: "priority", Prompt: 12.5, Completion: 75, PromptConfigured: true, CompletionConfigured: true},
			},
		},
	}
	tokens := ModelTokens{
		ContextThresholdTokens: model.ModelPriceBaseContextThreshold,
		InputTokens:            100_000,
		OutputTokens:           10_000,
	}
	b.ReportAllocs()
	var cost float64
	for b.Loop() {
		cost = CostForModelWithServiceTier("gpt-5.5", "priority", tokens, prices)
	}
	if cost == 0 {
		b.Fatal("cost = 0")
	}
}
