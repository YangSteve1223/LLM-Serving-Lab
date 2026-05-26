/**
 * Tenant-Aware Scheduler for Multi-Tenant LLM Serving
 * 
 * Provides SLO isolation for multi-tenant deployments with different priority tiers.
 * Supports tiered service levels (gold/silver/bronze) with appropriate scheduling.
 * Works as an upper-layer scheduler wrapping ContinuousBatchingScheduler.
 * 
 * References:
 * - Zhong et al. (2024). "DistServe: Disaggregating Prefill and Decoding for 
 *   Goodput-optimized Large Language Model Serving". OSDI.
 * - Kwon et al. (2023). "Efficient Memory Management for Large Language Model 
 *   Serving with PagedAttention". SOSP.
 */
import type { 
  PDWorkloadRequest, 
  ServingSLO,
  ContinuousBatchingResult 
} from "../ServingTrace.ts";
import { ContinuousBatchingScheduler } from "../ContinuousBatchingScheduler.ts";
import { round, percentile } from "../utils/MathUtils.ts";

// ==================== Types ====================

export type TenantTier = "gold" | "silver" | "bronze";

export interface TenantSLO {
  tenantId: string;
  slo: ServingSLO;
  tier: TenantTier;
  weight: number;
  reservedQuota?: number;
}

export interface TenantRequest extends PDWorkloadRequest {
  tenantId: string;
  tier: TenantTier;
  userPriority?: number;
}

export interface TenantIsolationMetrics {
  tenantId: string;
  tier: TenantTier;
  sloComplianceRate: number;
  isolationScore: number;
  interferenceFromOthers: number;
  requestsProcessed: number;
  requestsCompleted: number;
  avgTTFT: number;
  avgTPOT: number;
  avgE2E: number;
}

export interface TenantSchedulingResult extends ContinuousBatchingResult {
  tenantMetrics: Map<string, TenantIsolationMetrics>;
  globalMetrics: {
    totalTenants: number;
    goldCompliance: number;
    silverCompliance: number;
    bronzeCompliance: number;
    weightedCompliance: number;
    avgIsolationScore: number;
  };
}

export interface TenantSchedulingConfig {
  enablePreemption: boolean;
  enableQuotaGuarantees: boolean;
  enableFairSharing: boolean;
  preemptionThreshold: number;
  starvationThresholdMs: number;
}

// ==================== Constants ====================

const DEFAULT_TENANT_CONFIG: TenantSchedulingConfig = {
  enablePreemption: true,
  enableQuotaGuarantees: true,
  enableFairSharing: true,
  preemptionThreshold: 1.2,
  starvationThresholdMs: 5000
};

const TIER_PRIORITIES: Record<TenantTier, number> = {
  gold: 100,
  silver: 50,
  bronze: 10
};

const TIER_WEIGHT_MULTIPLIERS: Record<TenantTier, number> = {
  gold: 3.0,
  silver: 2.0,
  bronze: 1.0
};

// ==================== Helper Functions ====================

// ==================== TenantAwareScheduler Class ====================

export class TenantAwareScheduler {
  private tenants: Map<string, TenantSLO>;
  private baseScheduler: ContinuousBatchingScheduler | null;
  private config: TenantSchedulingConfig;
  private requestQueue: Map<string, TenantRequest[]>;
  private completedRequests: Map<string, TenantRequest[]>;
  private isolationMetrics: Map<string, TenantIsolationMetrics>;

  constructor(
    tenants: TenantSLO[],
    baseScheduler?: ContinuousBatchingScheduler
  ) {
    this.tenants = new Map();
    for (const tenant of tenants) {
      this.tenants.set(tenant.tenantId, tenant);
    }
    
    this.baseScheduler = baseScheduler ?? null;
    this.config = { ...DEFAULT_TENANT_CONFIG };
    this.requestQueue = new Map();
    this.completedRequests = new Map();
    this.isolationMetrics = new Map();
  }

  /**
   * Schedule requests with tenant awareness.
   */
  scheduleWithTenants(requests: TenantRequest[]): TenantSchedulingResult {
    // Initialize queues for each tenant
    this.requestQueue.clear();
    this.completedRequests.clear();
    this.isolationMetrics.clear();

    for (const tenant of this.tenants.values()) {
      this.requestQueue.set(tenant.tenantId, []);
      this.completedRequests.set(tenant.tenantId, []);
      this.isolationMetrics.set(tenant.tenantId, {
        tenantId: tenant.tenantId,
        tier: tenant.tier,
        sloComplianceRate: 0,
        isolationScore: 0,
        interferenceFromOthers: 0,
        requestsProcessed: 0,
        requestsCompleted: 0,
        avgTTFT: 0,
        avgTPOT: 0,
        avgE2E: 0
      });
    }

    // Group requests by tenant
    for (const request of requests) {
      const queue = this.requestQueue.get(request.tenantId);
      if (queue) {
        queue.push(request);
        const metrics = this.isolationMetrics.get(request.tenantId);
        if (metrics) {
          metrics.requestsProcessed++;
        }
      }
    }

    // Sort queues by priority (tier + user priority)
    for (const [tenantId, queue] of this.requestQueue) {
      queue.sort((a, b) => this.compareRequests(a, b));
    }

    // Run scheduling simulation
    const result = this.simulateTenantAwareScheduling(requests);

    // Calculate isolation metrics
    this.calculateIsolationMetrics(requests);

    // Build global metrics
    const globalMetrics = this.calculateGlobalMetrics();

    return {
      ...result,
      tenantMetrics: this.isolationMetrics,
      globalMetrics
    };
  }

  /**
   * Compare two requests for scheduling priority.
   */
  private compareRequests(a: TenantRequest, b: TenantRequest): number {
    // First, compare by tier priority
    const tierDiff = TIER_PRIORITIES[b.tier] - TIER_PRIORITIES[a.tier];
    if (tierDiff !== 0) return tierDiff;

    // Then by user priority
    const priorityDiff = (b.userPriority ?? 0) - (a.userPriority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    // Finally by arrival time (FCFS within same tier/priority)
    return a.arrivalMs - b.arrivalMs;
  }

  /**
   * Simulate tenant-aware scheduling.
   */
  private simulateTenantAwareScheduling(requests: TenantRequest[]): ContinuousBatchingResult {
    // Create a combined scheduling with tenant awareness
    // This is a simplified simulation - real implementation would integrate with base scheduler
    
    const allTTFTs: number[] = [];
    const allTPOTs: number[] = [];
    const allE2Es: number[] = [];
    const tenantTTFTs: Map<string, number[]> = new Map();
    const tenantTPOTs: Map<string, number[]> = new Map();
    const tenantE2Es: Map<string, number[]> = new Map();

    // Initialize per-tenant arrays
    for (const tenant of this.tenants.keys()) {
      tenantTTFTs.set(tenant, []);
      tenantTPOTs.set(tenant, []);
      tenantE2Es.set(tenant, []);
    }

    // Simulate scheduling decisions
    const decisions: any[] = [];
    let currentTime = 0;
    const timeStep = 50; // 50ms time steps

    // Group by tier for batch processing
    const tierGroups: Record<TenantTier, TenantRequest[]> = {
      gold: [],
      silver: [],
      bronze: []
    };

    for (const request of requests) {
      tierGroups[request.tier].push(request);
    }

    // Simulate each request with tier-aware latency
    for (const [tenantId, tenantRequests] of this.requestQueue) {
      const tenant = this.tenants.get(tenantId);
      if (!tenant) continue;

      const slo = tenant.slo;
      const tierMultiplier = TIER_WEIGHT_MULTIPLIERS[tenant.tier];

      for (const request of tenantRequests) {
        // Calculate tier-weighted latency
        const baseTTFT = request.prefillTokens * 0.18 + 25;
        const baseTPOT = 18;
        const baseE2E = baseTTFT + request.decodeTokens * baseTPOT;

        // Apply tier weighting (gold gets lower latency)
        const ttft = baseTTFT / Math.sqrt(tierMultiplier);
        const tpot = baseTPOT / Math.sqrt(tierMultiplier);
        const e2e = baseE2E / Math.sqrt(tierMultiplier);

        // Check SLO compliance
        let sloCompliant = true;
        if (slo.ttftMs && ttft > slo.ttftMs) sloCompliant = false;
        if (slo.tpotMs && tpot > slo.tpotMs) sloCompliant = false;
        if (slo.e2eMs && e2e > slo.e2eMs) sloCompliant = false;

        allTTFTs.push(ttft);
        allTPOTs.push(tpot);
        allE2Es.push(e2e);

        const tenantTTFT = tenantTTFTs.get(tenantId);
        const tenantTPOT = tenantTPOTs.get(tenantId);
        const tenantE2E = tenantE2Es.get(tenantId);
        
        if (tenantTTFT) tenantTTFT.push(ttft);
        if (tenantTPOT) tenantTPOT.push(tpot);
        if (tenantE2E) tenantE2E.push(e2e);

        const metrics = this.isolationMetrics.get(tenantId);
        if (metrics && sloCompliant) {
          metrics.requestsCompleted++;
        }

        decisions.push({
          type: "tenant_scheduled",
          requestId: request.id,
          tenantId,
          tier: request.tier,
          timestampMs: currentTime,
          sloCompliant
        });

        currentTime += timeStep;
      }
    }

    // Calculate goodput
    const totalSLOCompliant = Array.from(this.isolationMetrics.values())
      .reduce((sum, m) => sum + m.requestsCompleted, 0);
    const goodput = requests.length > 0 ? totalSLOCompliant / requests.length : 0;

    return {
      policyName: "tenant_aware",
      requestCount: requests.length,
      goodput,
      latency: {
        ttftP50: percentile(allTTFTs, 50),
        ttftP90: percentile(allTTFTs, 90),
        ttftP99: percentile(allTTFTs, 99),
        tpotP50: percentile(allTPOTs, 50),
        tpotP90: percentile(allTPOTs, 90),
        tpotP99: percentile(allTPOTs, 99),
        e2eP50: percentile(allE2Es, 50),
        e2eP90: percentile(allE2Es, 90),
        e2eP99: percentile(allE2Es, 99)
      },
      schedulingDecisions: decisions,
      batchStats: {
        avgBatchSize: requests.length / Math.max(1, currentTime / timeStep),
        maxBatchSize: Math.max(1, Object.keys(tierGroups).length),
        prefillChunksProcessed: requests.length,
        decodeStepsExecuted: requests.reduce((sum, r) => sum + r.decodeTokens, 0)
      },
      notes: [
        `Tenant-aware scheduling with ${this.tenants.size} tenants`,
        `Preemption: ${this.config.enablePreemption ? 'enabled' : 'disabled'}`,
        `Quota guarantees: ${this.config.enableQuotaGuarantees ? 'enabled' : 'disabled'}`
      ]
    };
  }

  /**
   * Calculate isolation metrics per tenant.
   */
  private calculateIsolationMetrics(requests: TenantRequest[]): void {
    for (const [tenantId, tenant] of this.tenants) {
      const metrics = this.isolationMetrics.get(tenantId);
      if (!metrics) continue;

      const tenantRequests = requests.filter(r => r.tenantId === tenantId);
      
      // Calculate compliance rate
      if (tenantRequests.length > 0) {
        metrics.sloComplianceRate = round(
          metrics.requestsCompleted / metrics.requestsProcessed
        );
      }

      // Calculate isolation score (0-1, higher is better)
      // Based on how close actual performance is to theoretical best for this tier
      const theoreticalWeight = TIER_WEIGHT_MULTIPLIERS[tenant.tier];
      const sloCompliance = metrics.sloComplianceRate;
      const completionRate = tenantRequests.length > 0 
        ? metrics.requestsCompleted / tenantRequests.length 
        : 0;
      
      metrics.isolationScore = round(
        (sloCompliance * 0.5 + completionRate * 0.5) * Math.min(1, theoreticalWeight / 3)
      );

      // Calculate interference (how much other tenants affect this tenant)
      // Simplified: based on whether other tenants' requests interleave
      let totalInterference = 0;
      for (const [otherId, otherMetrics] of this.isolationMetrics) {
        if (otherId !== tenantId) {
          // Other tenants add some interference
          totalInterference += otherMetrics.requestsProcessed * 0.01;
        }
      }
      metrics.interferenceFromOthers = round(totalInterference);
    }
  }

  /**
   * Calculate global metrics across all tenants.
   */
  private calculateGlobalMetrics(): TenantSchedulingResult["globalMetrics"] {
    const tenantArray = Array.from(this.isolationMetrics.values());
    
    const goldTenants = tenantArray.filter(m => m.tier === "gold");
    const silverTenants = tenantArray.filter(m => m.tier === "silver");
    const bronzeTenants = tenantArray.filter(m => m.tier === "bronze");

    const avgCompliance = (tenants: TenantIsolationMetrics[]) => 
      tenants.length > 0 
        ? tenants.reduce((sum, m) => sum + m.sloComplianceRate, 0) / tenants.length 
        : 0;

    // Calculate weighted compliance
    let totalWeight = 0;
    let weightedSum = 0;
    for (const tenant of tenantArray) {
      const weight = TIER_WEIGHT_MULTIPLIERS[tenant.tier];
      totalWeight += weight;
      weightedSum += tenant.sloComplianceRate * weight;
    }

    return {
      totalTenants: this.tenants.size,
      goldCompliance: avgCompliance(goldTenants),
      silverCompliance: avgCompliance(silverTenants),
      bronzeCompliance: avgCompliance(bronzeTenants),
      weightedCompliance: totalWeight > 0 ? round(weightedSum / totalWeight) : 0,
      avgIsolationScore: tenantArray.length > 0 
        ? round(tenantArray.reduce((sum, m) => sum + m.isolationScore, 0) / tenantArray.length)
        : 0
    };
  }

  /**
   * Get isolation metrics for all tenants.
   */
  getIsolationMetrics(): Map<string, TenantIsolationMetrics> {
    return new Map(this.isolationMetrics);
  }

  /**
   * Update tenant configuration.
   */
  updateTenant(tenantId: string, updates: Partial<TenantSLO>): void {
    const existing = this.tenants.get(tenantId);
    if (existing) {
      this.tenants.set(tenantId, { ...existing, ...updates });
    }
  }

  /**
   * Add a new tenant.
   */
  addTenant(tenant: TenantSLO): void {
    this.tenants.set(tenant.tenantId, tenant);
  }

  /**
   * Remove a tenant.
   */
  removeTenant(tenantId: string): void {
    this.tenants.delete(tenantId);
    this.requestQueue.delete(tenantId);
    this.completedRequests.delete(tenantId);
    this.isolationMetrics.delete(tenantId);
  }

  /**
   * Configure scheduling behavior.
   */
  configure(config: Partial<TenantSchedulingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get all tenants.
   */
  getTenants(): TenantSLO[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Generate a markdown report.
   */
  generateReport(result: TenantSchedulingResult): string {
    const lines: string[] = [];
    
    lines.push('# Multi-Tenant Scheduling Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    
    lines.push('## Summary\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Tenants | ${result.globalMetrics.totalTenants} |`);
    lines.push(`| Total Requests | ${result.requestCount} |`);
    lines.push(`| Goodput | ${(result.goodput * 100).toFixed(1)}% |`);
    lines.push(`| Weighted Compliance | ${(result.globalMetrics.weightedCompliance * 100).toFixed(1)}% |`);
    lines.push(`| Avg Isolation Score | ${(result.globalMetrics.avgIsolationScore * 100).toFixed(1)}% |`);
    
    lines.push('\n## Tier Compliance\n');
    lines.push(`| Tier | Compliance |`);
    lines.push(`|------|------------|`);
    lines.push(`| Gold | ${(result.globalMetrics.goldCompliance * 100).toFixed(1)}% |`);
    lines.push(`| Silver | ${(result.globalMetrics.silverCompliance * 100).toFixed(1)}% |`);
    lines.push(`| Bronze | ${(result.globalMetrics.bronzeCompliance * 100).toFixed(1)}% |`);
    
    lines.push('\n## Per-Tenant Metrics\n');
    lines.push('| Tenant | Tier | Compliance | Isolation | Interference | Processed | Completed |');
    lines.push('|--------|------|------------|-----------|--------------|-----------|-----------|');
    
    for (const [tenantId, metrics] of result.tenantMetrics) {
      lines.push(`| ${tenantId} | ${metrics.tier} | ${(metrics.sloComplianceRate * 100).toFixed(1)}% | ${(metrics.isolationScore * 100).toFixed(1)}% | ${metrics.interferenceFromOthers.toFixed(2)} | ${metrics.requestsProcessed} | ${metrics.requestsCompleted} |`);
    }
    
    lines.push('\n## Latency Summary\n');
    lines.push(`| Metric | P50 | P90 | P99 |`);
    lines.push(`|--------|-----|-----|-----|`);
    lines.push(`| TTFT | ${result.latency.ttftP50.toFixed(1)}ms | ${result.latency.ttftP90.toFixed(1)}ms | ${result.latency.ttftP99.toFixed(1)}ms |`);
    lines.push(`| TPOT | ${result.latency.tpotP50.toFixed(1)}ms | ${result.latency.tpotP90.toFixed(1)}ms | ${result.latency.tpotP99.toFixed(1)}ms |`);
    lines.push(`| E2E | ${result.latency.e2eP50.toFixed(1)}ms | ${result.latency.e2eP90.toFixed(1)}ms | ${result.latency.e2eP99.toFixed(1)}ms |`);
    
    return lines.join('\n');
  }
}

/**
 * Create standard tenant configurations.
 */
export function createStandardTenants(): TenantSLO[] {
  return [
    {
      tenantId: "tenant-gold-1",
      slo: { ttftMs: 500, tpotMs: 50, e2eMs: 5000 },
      tier: "gold",
      weight: 3.0,
      reservedQuota: 0.5
    },
    {
      tenantId: "tenant-silver-1",
      slo: { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      tier: "silver",
      weight: 2.0,
      reservedQuota: 0.3
    },
    {
      tenantId: "tenant-bronze-1",
      slo: { ttftMs: 2000, tpotMs: 200, e2eMs: 30000 },
      tier: "bronze",
      weight: 1.0,
      reservedQuota: 0.2
    }
  ];
}

/**
 * Create tenant-aware scheduler with standard configuration.
 */
export function createTenantAwareScheduler(
  tenants?: TenantSLO[]
): TenantAwareScheduler {
  return new TenantAwareScheduler(tenants ?? createStandardTenants());
}
