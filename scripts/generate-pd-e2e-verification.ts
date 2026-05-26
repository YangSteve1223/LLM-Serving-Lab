/**
 * Generate PD E2E Verification Report
 * 
 * Run with: npx tsx scripts/generate-pd-e2e-verification.ts
 */
import { PDDisaggregationVerifier } from '../src/agents/learningAssistant/serving/PDDisaggregationVerifier.ts';
import { writeFileSync } from 'node:fs';

// API Key - DO NOT commit this to version control!
const API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-aec8f6c26a7048569e3819fdba235a08';
const BASE_URL = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';

async function main() {
  console.log('Starting PD E2E Verification Report Generation...');
  console.log(`API: ${BASE_URL}, Model: ${MODEL}`);
  console.log('API Key will be masked in report.\n');

  const verifier = new PDDisaggregationVerifier(API_KEY, BASE_URL, MODEL);

  // Run verification
  console.log('Running full verification...');
  const report = await verifier.runFullVerification();

  // Generate markdown
  const markdown = verifier.generateReport(report);

  // Save to file
  const outputPath = './reports/pd-e2e-verification.md';
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`\nReport generated: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  - Scenarios tested: ${report.summary.scenariosTested}`);
  console.log(`  - Avg TTFT Improvement: ${report.summary.avgTTFTImprovement.toFixed(1)}%`);
  console.log(`  - Avg TPOT Improvement: ${report.summary.avgTPOTImprovement.toFixed(1)}%`);
  console.log(`  - Avg E2E Improvement: ${report.summary.avgE2EImprovement.toFixed(1)}%`);
  console.log(`\nRecommendation: ${report.summary.overallRecommendation}`);
}

main().catch(console.error);
