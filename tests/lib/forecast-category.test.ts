import { describe, it, expect } from 'vitest';
import {
  resolveDefaultCategory,
  isForecastCategory,
  effectiveForecastCategory,
  computeCategoryForecast,
  DEFAULT_FORECAST_CATEGORY_WEIGHTS,
  FORECAST_CATEGORIES,
} from '../../lib/forecast-category';

describe('resolveDefaultCategory', () => {
  it('maps every kanbanColumn to the issue-specified default category', () => {
    expect(resolveDefaultCategory('DISCOVERED')).toBe('pipeline');
    expect(resolveDefaultCategory('QUALIFIED')).toBe('pipeline');
    expect(resolveDefaultCategory('BACKLOG')).toBe('pipeline');
    expect(resolveDefaultCategory('ENGAGED')).toBe('best_case');
    expect(resolveDefaultCategory('PROPOSAL')).toBe('commit');
    expect(resolveDefaultCategory('WON')).toBe('closed');
    expect(resolveDefaultCategory('LOST')).toBe('closed');
  });

  it('falls back to pipeline for an unknown/missing column', () => {
    expect(resolveDefaultCategory(undefined)).toBe('pipeline');
    expect(resolveDefaultCategory(null)).toBe('pipeline');
    expect(resolveDefaultCategory('NOT_A_COLUMN')).toBe('pipeline');
  });
});

describe('isForecastCategory', () => {
  it('accepts exactly the 4 closed-enum values', () => {
    for (const cat of FORECAST_CATEGORIES) expect(isForecastCategory(cat)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isForecastCategory('proposal')).toBe(false);
    expect(isForecastCategory(null)).toBe(false);
    expect(isForecastCategory(undefined)).toBe(false);
    expect(isForecastCategory(42)).toBe(false);
  });
});

describe('effectiveForecastCategory', () => {
  it('returns the stage default when never overridden', () => {
    expect(effectiveForecastCategory({ kanbanColumn: 'ENGAGED' })).toBe('best_case');
  });

  it('returns the stage default when forecastCategory is set but forecastCategoryOverriddenBy is not (defensive — should not happen via the write path)', () => {
    expect(effectiveForecastCategory({ kanbanColumn: 'DISCOVERED', forecastCategory: 'commit', forecastCategoryOverriddenBy: null })).toBe('pipeline');
  });

  it('returns the override once forecastCategoryOverriddenBy is set', () => {
    expect(effectiveForecastCategory({ kanbanColumn: 'DISCOVERED', forecastCategory: 'commit', forecastCategoryOverriddenBy: 'user-1' })).toBe('commit');
  });

  it('survives a later kanbanColumn move — sticky override semantics (issue 204)', () => {
    // Same lead, moved from PROPOSAL to WON, override still active.
    expect(effectiveForecastCategory({ kanbanColumn: 'WON', forecastCategory: 'best_case', forecastCategoryOverriddenBy: 'user-1' })).toBe('best_case');
  });

  it('ignores a corrupted stored forecastCategory value and falls back to the stage default', () => {
    expect(effectiveForecastCategory({ kanbanColumn: 'ENGAGED', forecastCategory: 'garbage', forecastCategoryOverriddenBy: 'user-1' })).toBe('best_case');
  });
});

describe('computeCategoryForecast', () => {
  const stageWeights = { DISCOVERED: 0.01, QUALIFIED: 0.05, ENGAGED: 0.10, PROPOSAL: 0.25, WON: 1.0, LOST: 0.0 };

  it('buckets never-overridden leads by their stage default and applies the flat category weight', () => {
    const result = computeCategoryForecast(
      [
        { kanbanColumn: 'DISCOVERED', value: 1000 },
        { kanbanColumn: 'ENGAGED', value: 2000 },
        { kanbanColumn: 'PROPOSAL', value: 3000 },
      ],
      DEFAULT_FORECAST_CATEGORY_WEIGHTS,
      stageWeights
    );
    expect(result.byCategory.pipeline.leads).toBe(1);
    expect(result.byCategory.pipeline.rawRevenue).toBe(1000);
    expect(result.byCategory.pipeline.weightedRevenue).toBe(100); // 1000 * 0.10
    expect(result.byCategory.best_case.weightedRevenue).toBe(800); // 2000 * 0.40
    expect(result.byCategory.commit.weightedRevenue).toBe(2700); // 3000 * 0.90
    expect(result.categoryWeightedRevenue).toBe(100 + 800 + 2700);
  });

  it('splits closed-category leads WON=full value, LOST=zero — never a flat closed weight', () => {
    const result = computeCategoryForecast(
      [
        { kanbanColumn: 'WON', value: 5000 },
        { kanbanColumn: 'LOST', value: 4000 },
      ],
      DEFAULT_FORECAST_CATEGORY_WEIGHTS,
      stageWeights
    );
    expect(result.byCategory.closed.leads).toBe(2);
    expect(result.byCategory.closed.rawRevenue).toBe(9000);
    expect(result.byCategory.closed.weightedRevenue).toBe(5000); // WON full + LOST zero, not 9000*1.0
    expect(result.byCategory.closed.weight).toBeNull();
    expect(result.categoryWeightedRevenue).toBe(5000);
  });

  it('respects a sticky override even when it disagrees with the current stage', () => {
    const result = computeCategoryForecast(
      [{ kanbanColumn: 'DISCOVERED', value: 1000, forecastCategory: 'commit', forecastCategoryOverriddenBy: 'user-1' }],
      DEFAULT_FORECAST_CATEGORY_WEIGHTS,
      stageWeights
    );
    expect(result.byCategory.commit.leads).toBe(1);
    expect(result.byCategory.commit.weightedRevenue).toBe(900); // 1000 * 0.90
    expect(result.byCategory.pipeline.leads).toBe(0);
  });

  it('handles an empty lead list without throwing', () => {
    const result = computeCategoryForecast([], DEFAULT_FORECAST_CATEGORY_WEIGHTS, stageWeights);
    expect(result.categoryWeightedRevenue).toBe(0);
    for (const cat of FORECAST_CATEGORIES) {
      expect(result.byCategory[cat].leads).toBe(0);
    }
  });

  it('treats a WON lead overridden into a non-closed category as flat-weighted, not full-value', () => {
    const result = computeCategoryForecast(
      [{ kanbanColumn: 'WON', value: 1000, forecastCategory: 'best_case', forecastCategoryOverriddenBy: 'user-1' }],
      DEFAULT_FORECAST_CATEGORY_WEIGHTS,
      stageWeights
    );
    expect(result.byCategory.best_case.weightedRevenue).toBe(400); // 1000 * 0.40, not 1000
    expect(result.byCategory.closed.leads).toBe(0);
  });
});
