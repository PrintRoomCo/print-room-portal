import type { Page } from '@playwright/test';
import type { TourDefinition } from '../src/types';

export interface SmokeResult {
  tourId: string;
  ok: boolean;
  failedStep?: number;
  reason?: string;
}

export async function runTourSmoke(
  page: Page,
  baseUrl: string,
  tours: TourDefinition[]
): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];

  for (const tour of tours) {
    const route = tour.route ?? '/';
    await page.goto(new URL(route, baseUrl).toString());

    let failedStep: number | undefined;
    let reason: string | undefined;
    for (let i = 0; i < tour.steps.length; i++) {
      const step = tour.steps[i];
      const locator = page.locator(step.target);
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 });
      } catch {
        failedStep = i;
        reason = `target "${step.target}" not visible within 3s`;
        break;
      }
    }
    results.push({ tourId: tour.id, ok: failedStep === undefined, failedStep, reason });
  }

  return results;
}
