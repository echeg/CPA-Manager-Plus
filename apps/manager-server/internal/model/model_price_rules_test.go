package model

import "testing"

func TestNormalizeModelPriceContextTiersSortsAndRejectsDuplicates(t *testing.T) {
	tiers, err := NormalizeModelPriceContextTiers([]ModelPriceContextTier{
		{ThresholdTokens: 200_000, Prompt: 4, PromptConfigured: true},
		{ThresholdTokens: 32_000, Prompt: 2, PromptConfigured: true},
	})
	if err != nil {
		t.Fatalf("normalize tiers: %v", err)
	}
	if len(tiers) != 2 || tiers[0].ThresholdTokens != 32_000 || tiers[1].ThresholdTokens != 200_000 {
		t.Fatalf("normalized tiers = %#v", tiers)
	}
	if _, err := NormalizeModelPriceContextTiers([]ModelPriceContextTier{
		{ThresholdTokens: 32_000, Prompt: 2, PromptConfigured: true},
		{ThresholdTokens: 32_000, Prompt: 3, PromptConfigured: true},
	}); err == nil {
		t.Fatal("duplicate threshold error = nil")
	}
}

func TestModelPriceForContextUsesStrictHighestTierAndInheritsMissingRates(t *testing.T) {
	price := ModelPrice{
		Prompt: 1, Completion: 2, Cache: 0.1, CacheRead: 0.1, CacheCreation: 0.2,
		PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true, CacheCreationConfigured: true,
		ContextTiers: []ModelPriceContextTier{
			{ThresholdTokens: 32_000, Prompt: 3, Completion: 4, PromptConfigured: true, CompletionConfigured: true},
			{ThresholdTokens: 200_000, Prompt: 0, Completion: 8, PromptConfigured: true, CompletionConfigured: true},
		},
	}

	atThreshold, band := ModelPriceForContext(price, 32_000)
	if band != ModelPriceBaseContextThreshold || atThreshold.Prompt != 1 {
		t.Fatalf("exact threshold price = %#v, band = %d", atThreshold, band)
	}
	firstTier, band := ModelPriceForContext(price, 200_000)
	if band != 32_000 || firstTier.Prompt != 3 || firstTier.CacheRead != 0.1 {
		t.Fatalf("first tier price = %#v, band = %d", firstTier, band)
	}
	highestTier, band := ModelPriceForContext(price, 200_001)
	if band != 200_000 || highestTier.Prompt != 0 || !highestTier.PromptConfigured || highestTier.CacheCreation != 0.2 {
		t.Fatalf("highest tier price = %#v, band = %d", highestTier, band)
	}
	resolvedTier, ok := ModelPriceForContextThreshold(price, 32_000)
	if !ok || resolvedTier.Prompt != 3 || resolvedTier.CacheRead != 0.1 {
		t.Fatalf("resolved tier price = %#v, ok = %v", resolvedTier, ok)
	}
	if _, ok := ModelPriceForContextThreshold(price, 128_000); ok {
		t.Fatal("unknown threshold unexpectedly resolved")
	}
}

func TestModelPriceServiceTiersNormalizeMatchAliasesAndInheritRates(t *testing.T) {
	tiers, err := NormalizeModelPriceServiceTiers([]ModelPriceServiceTier{
		{
			Mode: " FAST ", ServiceTier: " Priority ", Prompt: 0, Completion: 75,
			PromptConfigured: true, CompletionConfigured: true,
		},
	})
	if err != nil {
		t.Fatalf("normalize service tiers: %v", err)
	}
	if len(tiers) != 1 || tiers[0].Mode != "fast" || tiers[0].ServiceTier != "priority" {
		t.Fatalf("normalized service tiers = %#v", tiers)
	}
	price := ModelPrice{
		Prompt: 5, Completion: 30, Cache: 0.5, CacheRead: 0.5, CacheCreation: 6.25,
		PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true, CacheCreationConfigured: true,
		ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 272_000, Prompt: 10, PromptConfigured: true}},
		ServiceTiers: tiers,
	}
	for _, identifier := range []string{"fast", "priority", " PRIORITY "} {
		effective, ok := ModelPriceForServiceTier(price, identifier)
		if !ok || effective.Prompt != 0 || !effective.PromptConfigured || effective.Completion != 75 ||
			effective.CacheRead != 0.5 || len(effective.ContextTiers) != 0 || len(effective.ServiceTiers) != 0 {
			t.Fatalf("effective service tier for %q = %#v, ok = %v", identifier, effective, ok)
		}
	}
	if _, ok := ModelPriceForServiceTier(price, "default"); ok {
		t.Fatal("default unexpectedly matched service tier rule")
	}
}

func TestNormalizeModelPriceServiceTiersRejectsAmbiguousAndEmptyRules(t *testing.T) {
	for name, tiers := range map[string][]ModelPriceServiceTier{
		"shared identifier": {
			{Mode: "fast", ServiceTier: "priority", Prompt: 1, PromptConfigured: true},
			{Mode: "priority", ServiceTier: "turbo", Prompt: 2, PromptConfigured: true},
		},
		"missing identifier": {
			{Mode: "fast", Prompt: 1, PromptConfigured: true},
		},
		"no prices": {
			{Mode: "fast", ServiceTier: "priority"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizeModelPriceServiceTiers(tiers); err == nil {
				t.Fatal("normalize error = nil")
			}
		})
	}
}

func TestModelPriceStructureRevisionIgnoresRatesButTracksThresholds(t *testing.T) {
	base := map[string]ModelPrice{
		"model-b": {ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 200_000, Prompt: 2, PromptConfigured: true}}},
		"model-a": {Prompt: 1},
	}
	revision := ModelPriceStructureRevision(base)
	rateUpdate := map[string]ModelPrice{
		"model-a": {Prompt: 99},
		"model-b": {ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 200_000, Prompt: 9, PromptConfigured: true}}},
	}
	if got := ModelPriceStructureRevision(rateUpdate); got != revision {
		t.Fatalf("rate-only revision = %q, want %q", got, revision)
	}
	serviceTierUpdate := map[string]ModelPrice{
		"model-a": {
			Prompt: 1,
			ServiceTiers: []ModelPriceServiceTier{{
				Mode: "fast", ServiceTier: "priority", Prompt: 9, PromptConfigured: true,
			}},
		},
		"model-b": {ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 200_000, Prompt: 2, PromptConfigured: true}}},
	}
	if got := ModelPriceStructureRevision(serviceTierUpdate); got != revision {
		t.Fatalf("service-tier revision = %q, want %q", got, revision)
	}
	modelSetUpdate := map[string]ModelPrice{
		"model-b": {ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 200_000, Prompt: 2, PromptConfigured: true}}},
	}
	if got := ModelPriceStructureRevision(modelSetUpdate); got == revision {
		t.Fatalf("model-set revision did not change: %q", got)
	}
	thresholdUpdate := map[string]ModelPrice{
		"model-b": {ContextTiers: []ModelPriceContextTier{{ThresholdTokens: 256_000, Prompt: 2, PromptConfigured: true}}},
	}
	if got := ModelPriceStructureRevision(thresholdUpdate); got == revision {
		t.Fatalf("threshold revision did not change: %q", got)
	}
}

func gpt62SolUltrafastPrice(rule ModelPriceServiceTier) ModelPrice {
	return ModelPrice{
		Prompt: 2, Completion: 10, Cache: 0.2, CacheRead: 0.2, CacheCreation: 2.5,
		PromptConfigured: true, CompletionConfigured: true, CacheReadConfigured: true, CacheCreationConfigured: true,
		ContextTiers: []ModelPriceContextTier{{
			ThresholdTokens: 272_000, Prompt: 4, Completion: 15, Cache: 0.4, CacheRead: 0.4,
			PromptConfigured: true, CompletionConfigured: true, CacheConfigured: true, CacheReadConfigured: true,
		}},
		ServiceTiers: []ModelPriceServiceTier{rule},
	}
}

func TestModelPriceForContextThresholdAndServiceTierScalesByRuleRatio(t *testing.T) {
	price := gpt62SolUltrafastPrice(ModelPriceServiceTier{
		Mode: "ultrafast", ServiceTier: "ultrafast",
		Prompt: 6, Completion: 30, Cache: 0.6, CacheRead: 0.6, CacheCreation: 7.5,
		PromptConfigured: true, CompletionConfigured: true, CacheConfigured: true,
		CacheReadConfigured: true, CacheCreationConfigured: true,
	})

	effective, ok := ModelPriceForContextThresholdAndServiceTier(price, 272_000, "ultrafast")
	if !ok {
		t.Fatal("context tier with ultrafast rule did not resolve")
	}
	if effective.Prompt != 12 || effective.Completion != 45 {
		t.Fatalf("ultrafast long-context rates = %v / %v, want 12 / 45", effective.Prompt, effective.Completion)
	}
	// Cache rates: context 0.4 x ratio 3; cache write is unconfigured on the
	// context tier, so it starts from the base 2.5 and becomes the rule's 7.5.
	if !closeTo(effective.Cache, 1.2) || !closeTo(effective.CacheRead, 1.2) || !closeTo(effective.CacheCreation, 7.5) {
		t.Fatalf("ultrafast long-context cache rates = %#v", effective)
	}
	if len(effective.ContextTiers) != 0 || len(effective.ServiceTiers) != 0 {
		t.Fatalf("effective price keeps rule sets: %#v", effective)
	}
}

func TestModelPriceForContextThresholdAndServiceTierKeepsUnconfiguredRates(t *testing.T) {
	price := gpt62SolUltrafastPrice(ModelPriceServiceTier{
		Mode: "ultrafast", ServiceTier: "ultrafast", Prompt: 6, Completion: 30,
		PromptConfigured: true, CompletionConfigured: true,
	})

	effective, ok := ModelPriceForContextThresholdAndServiceTier(price, 272_000, "ultrafast")
	if !ok || effective.Prompt != 12 || effective.Completion != 45 {
		t.Fatalf("effective = %#v, ok = %v", effective, ok)
	}
	if effective.Cache != 0.4 || effective.CacheRead != 0.4 || effective.CacheCreation != 2.5 {
		t.Fatalf("cache rates changed without a rule rate: %#v", effective)
	}
}

func TestModelPriceForContextThresholdAndServiceTierUsesRuleRateForZeroBase(t *testing.T) {
	price := ModelPrice{
		Prompt: 0, Completion: 10, PromptConfigured: true, CompletionConfigured: true,
		ContextTiers: []ModelPriceContextTier{{
			ThresholdTokens: 272_000, Completion: 15, CompletionConfigured: true,
		}},
		ServiceTiers: []ModelPriceServiceTier{{
			Mode: "fast", ServiceTier: "priority", Prompt: 3, Completion: 20,
			PromptConfigured: true, CompletionConfigured: true,
		}},
	}

	effective, ok := ModelPriceForContextThresholdAndServiceTier(price, 272_000, "fast")
	if !ok || effective.Prompt != 3 || !effective.PromptConfigured || effective.Completion != 30 {
		t.Fatalf("effective = %#v, ok = %v", effective, ok)
	}
}

func TestModelPriceForContextThresholdAndServiceTierMatchesModeAndServiceTier(t *testing.T) {
	price := gpt62SolUltrafastPrice(ModelPriceServiceTier{
		Mode: "fast", ServiceTier: "priority", Prompt: 5, Completion: 25,
		PromptConfigured: true, CompletionConfigured: true,
	})

	for _, identifier := range []string{"fast", "priority", " PRIORITY "} {
		effective, ok := ModelPriceForContextThresholdAndServiceTier(price, 272_000, identifier)
		if !ok || effective.Prompt != 10 || effective.Completion != 37.5 {
			t.Fatalf("effective for %q = %#v, ok = %v", identifier, effective, ok)
		}
	}
}

func TestModelPriceForContextThresholdAndServiceTierWithoutRuleOrContextTier(t *testing.T) {
	price := gpt62SolUltrafastPrice(ModelPriceServiceTier{
		Mode: "ultrafast", ServiceTier: "ultrafast", Prompt: 6, Completion: 30,
		PromptConfigured: true, CompletionConfigured: true,
	})

	for _, serviceTier := range []string{"flex", "default", ""} {
		effective, ok := ModelPriceForContextThresholdAndServiceTier(price, 272_000, serviceTier)
		if !ok || effective.Prompt != 4 || effective.Completion != 15 || len(effective.ServiceTiers) != 0 {
			t.Fatalf("unmatched tier %q = %#v, ok = %v", serviceTier, effective, ok)
		}
	}
	for _, threshold := range []int64{ModelPriceBaseContextThreshold, 0, 128_000} {
		if effective, ok := ModelPriceForContextThresholdAndServiceTier(price, threshold, "ultrafast"); ok {
			t.Fatalf("threshold %d unexpectedly resolved: %#v", threshold, effective)
		}
	}
}

func closeTo(got, want float64) bool {
	diff := got - want
	return diff < 1e-9 && diff > -1e-9
}
