/**
 * Workload Module Index
 * 
 * Exports all workload modeling components.
 */
export { 
  EducationalWorkloadModel,
  createTypicalWorkload,
  createHeavyWorkload,
  createLightWorkload
} from "./EducationalWorkloadModel.ts";
export type {
  TaskType,
  ArrivalPattern,
  WorkloadProfile,
  WorkloadConfig,
  SyntheticRequest,
  WorkloadAnalysis
} from "./EducationalWorkloadModel.ts";
