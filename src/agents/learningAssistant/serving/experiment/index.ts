/**
 * Experiment Module - Comprehensive experiment framework for PD serving.
 * 
 * Includes:
 * - ExperimentMatrixRunner: Full 3x3x3 experiment matrix with statistical analysis
 * - ServingExperimentRunner: Simplified 3x3x3 matrix for quick experiments
 * - AblationStudyRunner: Module contribution analysis
 * - APIExperimentRunner: Real API comparison and calibration
 * - CalibrationFeedbackLoop: Closed-loop calibration system
 * - StatisticalReporter: Statistical analysis and reporting
 * - ExperimentConfig: Unified configuration schema
 * - PredefinedExperiments: Standard experiment presets
 * - ConfigLoader: YAML configuration loading
 * - ReportTemplate: Standardized report templates
 * - ExperimentReporter: Report generation
 */

// Simplified 3x3x3 Matrix (LCR × PRC × TII)
export { ServingExperimentRunner, createServingExperimentRunner } from "./ExperimentMatrix.ts";
export type {
  LengthOfContextRequest,
  PrefillResponseContent,
  TrafficIntensity,
  LCRPMatrix,
  LCRPExperimentConfig,
  BaselineStrategy,
  LCRPExperimentResult,
  LCRPExperimentReport
} from "./ExperimentMatrix.ts";

export {
  LCR_CONFIG,
  PRC_CONFIG,
  TII_CONFIG,
  BASELINE_STRATEGIES
} from "./ExperimentMatrix.ts";

// Ablation Study
export { AblationStudyRunner, ablationStudyRunner, createStandardAblationConfig } from "./AblationStudyRunner.ts";
export type {
  AblationModule,
  AblationConfig,
  AblationStepResult,
  AblationStudyResult
} from "./AblationStudyRunner.ts";

// API Experiment
export { APIExperimentRunner, apiExperimentRunner, STANDARD_SCENARIOS } from "./APIExperimentRunner.ts";
export type {
  TestScenario,
  APIMeasurement,
  SimMeasurement,
  ComparisonReport,
  CalibrationParams
} from "./APIExperimentRunner.ts";

// Calibration Feedback Loop
export { CalibrationFeedbackLoop } from "./CalibrationFeedbackLoop.ts";
export type {
  ConvergenceCriteria,
  CalibrationIterationResult,
  CalibrationFeedbackLoopResult,
  CalibrationFeedbackLoopConfig
} from "./CalibrationFeedbackLoop.ts";

// Statistical Reporter
export { StatisticalReporter, statisticalReporter } from "./StatisticalReporter.ts";
export type {
  Measurement,
  MetricStats,
  StatisticalSummary,
  ExperimentConditions,
  StatisticalTest
} from "./StatisticalReporter.ts";

// ==================== Unified Experiment Configuration System ====================

// Experiment Configuration Schema
export {
  createDefaultExperimentConfig,
  validateExperimentConfig
} from "./ExperimentConfig.ts";
export type {
  ExperimentConfig,
  ArchitectureType,
  CacheType,
  EvictionPolicy,
  SchedulerType,
  TokenDistribution,
  SimulatorGPUConfig,
  WorkloadConfig,
  SimulatorArchitectureConfig,
  CacheConfig,
  SchedulerConfig,
  StatisticalConfig
} from "./ExperimentConfig.ts";

// Predefined Experiments
export {
  PREDEFINED_EXPERIMENTS,
  createE2ELatencyBenchmarkConfig,
  createCacheScalingStudyConfig,
  createSchedulerComparisonConfig,
  createSpeculativeAblationConfig,
  createTenantIsolationConfig,
  createKVReuseAnalysisConfig,
  getPredefinedExperiments,
  listPredefinedExperiments
} from "./PredefinedExperiments.ts";
export type { PredefinedExperimentId, PredefinedExperimentMetadata } from "./PredefinedExperiments.ts";

// Configuration Loader
export {
  SimpleYAMLLoader,
  createConfigLoader,
  loadPredefinedExperiment,
  listAvailableExperiments
} from "./ConfigLoader.ts";
export type { YAMLLoader, ConfigLoaderOptions } from "./ConfigLoader.ts";

// 3x3x3 Experiment Matrix
export {
  ExperimentMatrixRunner,
  createMatrixRunner,
  DEFAULT_MATRIX_CONFIG
} from "./ExperimentMatrix.ts";
export type {
  ArchitectureDim,
  CacheDim,
  SchedulerDim,
  MatrixCell,
  MatrixCellResult,
  ExperimentMatrixResult,
  ExperimentMatrixConfig
} from "./ExperimentMatrix.ts";

// Report Template
export {
  ReportTemplate,
  createReportTemplate,
  generateSummaryTable,
  significanceBadge,
  DEFAULT_REPORT_CONFIG,
  METRIC_DISPLAY
} from "./ReportTemplate.ts";
export type { ReportTemplateConfig, ReportSection } from "./ReportTemplate.ts";

// Experiment Reporter
export {
  ExperimentReporter,
  createExperimentReporter,
  generateQuickReport
} from "./ExperimentReporter.ts";
export type { ReportFormat, ReportType, ExperimentReporterOptions } from "./ExperimentReporter.ts";
