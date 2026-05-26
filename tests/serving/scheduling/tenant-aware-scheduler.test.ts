/**
 * Tests for TenantAwareScheduler
 */
import { describe, it } from "node:test";
import assert from "node:assert";

// Import scheduling components
import { 
  TenantAwareScheduler,
  createStandardTenants,
  createTenantAwareScheduler,
  type TenantSLO,
  type TenantRequest,
  type TenantTier
} from "../../../src/agents/learningAssistant/serving/scheduling/TenantAwareScheduler.ts";
import type { ServingSLO } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";

describe('TenantAwareScheduler', () => {
  let scheduler: TenantAwareScheduler;
  let standardTenants: TenantSLO[];

  beforeEach(() => {
    standardTenants = createStandardTenants();
    scheduler = createTenantAwareScheduler(standardTenants);
  });

  describe('constructor', () => {
    it('should create scheduler with tenants', () => {
      assert.ok(scheduler);
      assert.strictEqual(scheduler.getTenants().length, 3);
    });

    it('should create scheduler with empty tenant list', () => {
      const s = new TenantAwareScheduler([]);
      assert.ok(s);
      assert.strictEqual(s.getTenants().length, 0);
    });

    it('should create using helper function', () => {
      const s = createTenantAwareScheduler();
      assert.ok(s);
      assert.strictEqual(s.getTenants().length, 3);
    });
  });

  describe('scheduleWithTenants', () => {
    it('should schedule empty workload', () => {
      const result = scheduler.scheduleWithTenants([]);
      
      assert.strictEqual(result.requestCount, 0);
      assert.strictEqual(result.goodput, 0);
    });

    it('should schedule single tenant requests', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-2',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 100,
          prefillTokens: 256,
          decodeTokens: 50
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.strictEqual(result.requestCount, 2);
      assert.strictEqual(result.policyName, 'tenant_aware');
      assert.ok(result.tenantMetrics.size > 0);
    });

    it('should schedule multi-tenant requests', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-silver-1',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          arrivalMs: 50,
          prefillTokens: 256,
          decodeTokens: 50
        },
        {
          id: 'req-bronze-1',
          tenantId: 'tenant-bronze-1',
          tier: 'bronze',
          arrivalMs: 100,
          prefillTokens: 1024,
          decodeTokens: 200
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.strictEqual(result.requestCount, 3);
      assert.ok(result.tenantMetrics.has('tenant-gold-1'));
      assert.ok(result.tenantMetrics.has('tenant-silver-1'));
      assert.ok(result.tenantMetrics.has('tenant-bronze-1'));
      
      // Check global metrics
      assert.strictEqual(result.globalMetrics.totalTenants, 3);
    });

    it('should calculate per-tenant metrics', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-gold-2',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 50,
          prefillTokens: 256,
          decodeTokens: 50
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      const goldMetrics = result.tenantMetrics.get('tenant-gold-1');
      
      assert.ok(goldMetrics);
      assert.strictEqual(goldMetrics!.tier, 'gold');
      assert.strictEqual(goldMetrics!.requestsProcessed, 2);
      assert.ok(goldMetrics!.sloComplianceRate >= 0);
      assert.ok(goldMetrics!.isolationScore >= 0);
    });

    it('should handle requests with user priority', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          userPriority: 10,
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-2',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          userPriority: 100,
          arrivalMs: 50,
          prefillTokens: 256,
          decodeTokens: 50
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.strictEqual(result.requestCount, 2);
      assert.ok(result.schedulingDecisions.length > 0);
    });

    it('should calculate latency metrics', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.ok(result.latency.ttftP50 > 0);
      assert.ok(result.latency.tpotP50 > 0);
      assert.ok(result.latency.e2eP50 > 0);
      assert.ok(result.latency.ttftP90 >= result.latency.ttftP50);
      assert.ok(result.latency.ttftP99 >= result.latency.ttftP90);
    });

    it('should include tier weights in latency calculation', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-bronze',
          tenantId: 'tenant-bronze-1',
          tier: 'bronze',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      // Gold should have lower latency than bronze due to tier weighting
      const goldMetrics = result.tenantMetrics.get('tenant-gold-1');
      const bronzeMetrics = result.tenantMetrics.get('tenant-bronze-1');
      
      assert.ok(goldMetrics!.avgTTFT <= bronzeMetrics!.avgTTFT);
    });
  });

  describe('getIsolationMetrics', () => {
    it('should return isolation metrics after scheduling', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      scheduler.scheduleWithTenants(requests);
      const metrics = scheduler.getIsolationMetrics();
      
      assert.strictEqual(metrics.size, 3);
      assert.ok(metrics.get('tenant-gold-1'));
    });
  });

  describe('tenant management', () => {
    it('should add new tenant', () => {
      scheduler.addTenant({
        tenantId: 'tenant-new',
        slo: { ttftMs: 500, tpotMs: 50, e2eMs: 5000 },
        tier: 'gold',
        weight: 2.5
      });
      
      const tenants = scheduler.getTenants();
      assert.strictEqual(tenants.length, 4);
      assert.ok(tenants.find(t => t.tenantId === 'tenant-new'));
    });

    it('should update existing tenant', () => {
      scheduler.updateTenant('tenant-gold-1', {
        slo: { ttftMs: 300, tpotMs: 30, e2eMs: 3000 },
        weight: 4.0
      });
      
      const tenants = scheduler.getTenants();
      const gold = tenants.find(t => t.tenantId === 'tenant-gold-1');
      
      assert.strictEqual(gold!.slo.ttftMs, 300);
      assert.strictEqual(gold!.weight, 4.0);
    });

    it('should remove tenant', () => {
      scheduler.removeTenant('tenant-bronze-1');
      
      const tenants = scheduler.getTenants();
      assert.strictEqual(tenants.length, 2);
      assert.strictEqual(tenants.find(t => t.tenantId === 'tenant-bronze-1'), undefined);
    });
  });

  describe('configure', () => {
    it('should update scheduling configuration', () => {
      scheduler.configure({
        enablePreemption: false,
        enableQuotaGuarantees: false
      });
      
      // Configuration should be applied (verified through scheduling decisions)
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];
      
      const result = scheduler.scheduleWithTenants(requests);
      assert.ok(result.notes.some(n => n.includes('Preemption: disabled')));
    });
  });

  describe('generateReport', () => {
    it('should generate comprehensive markdown report', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-silver-1',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          arrivalMs: 100,
          prefillTokens: 256,
          decodeTokens: 50
        },
        {
          id: 'req-bronze-1',
          tenantId: 'tenant-bronze-1',
          tier: 'bronze',
          arrivalMs: 200,
          prefillTokens: 1024,
          decodeTokens: 200
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      const report = scheduler.generateReport(result);
      
      assert.ok(report.includes('# Multi-Tenant Scheduling Report'));
      assert.ok(report.includes('## Summary'));
      assert.ok(report.includes('## Tier Compliance'));
      assert.ok(report.includes('## Per-Tenant Metrics'));
      assert.ok(report.includes('## Latency Summary'));
      assert.ok(report.includes('Gold'));
      assert.ok(report.includes('Silver'));
      assert.ok(report.includes('Bronze'));
      assert.ok(report.includes('Total Tenants'));
      assert.ok(report.includes('Goodput'));
    });
  });

  describe('tier compliance', () => {
    it('should calculate correct tier compliance rates', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-gold-2',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 100,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.ok(result.globalMetrics.goldCompliance >= 0);
      assert.ok(result.globalMetrics.silverCompliance >= 0);
      assert.ok(result.globalMetrics.bronzeCompliance >= 0);
    });

    it('should calculate weighted compliance', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-silver-1',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          arrivalMs: 50,
          prefillTokens: 256,
          decodeTokens: 50
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      // Weighted compliance should be between 0 and 1
      assert.ok(result.globalMetrics.weightedCompliance >= 0);
      assert.ok(result.globalMetrics.weightedCompliance <= 1);
    });
  });

  describe('isolation metrics', () => {
    it('should calculate isolation score', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      const goldMetrics = result.tenantMetrics.get('tenant-gold-1');
      
      assert.ok(goldMetrics!.isolationScore >= 0);
      assert.ok(goldMetrics!.isolationScore <= 1);
    });

    it('should calculate interference from other tenants', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-gold-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-silver-1',
          tenantId: 'tenant-silver-1',
          tier: 'silver',
          arrivalMs: 50,
          prefillTokens: 256,
          decodeTokens: 50
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      for (const [, metrics] of result.tenantMetrics) {
        assert.ok(metrics.interferenceFromOthers >= 0);
      }
    });

    it('should calculate average isolation score', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'tenant-gold-1',
          tier: 'gold',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.ok(result.globalMetrics.avgIsolationScore >= 0);
      assert.ok(result.globalMetrics.avgIsolationScore <= 1);
    });
  });

  describe('edge cases', () => {
    it('should handle unknown tenant gracefully', () => {
      const requests: TenantRequest[] = [
        {
          id: 'req-unknown',
          tenantId: 'unknown-tenant',
          tier: 'silver', // Default tier
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = scheduler.scheduleWithTenants(requests);
      
      // Should still process the request
      assert.strictEqual(result.requestCount, 1);
    });

    it('should handle empty SLO targets', () => {
      const customTenants: TenantSLO[] = [
        {
          tenantId: 'no-slo-tenant',
          slo: {}, // Empty SLO
          tier: 'bronze',
          weight: 1.0
        }
      ];

      const s = new TenantAwareScheduler(customTenants);
      const requests: TenantRequest[] = [
        {
          id: 'req-1',
          tenantId: 'no-slo-tenant',
          tier: 'bronze',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const result = s.scheduleWithTenants(requests);
      
      assert.strictEqual(result.requestCount, 1);
    });

    it('should handle large workload', () => {
      const requests: TenantRequest[] = [];
      const tiers: TenantTier[] = ['gold', 'silver', 'bronze'];
      
      for (let i = 0; i < 50; i++) {
        const tier = tiers[i % 3];
        requests.push({
          id: `req-${i}`,
          tenantId: `tenant-${tier}-1`,
          tier,
          arrivalMs: i * 10,
          prefillTokens: 512 + (i % 10) * 64,
          decodeTokens: 50 + (i % 5) * 10
        });
      }

      const result = scheduler.scheduleWithTenants(requests);
      
      assert.strictEqual(result.requestCount, 50);
      assert.ok(result.latency);
    });
  });
});

describe('createStandardTenants', () => {
  it('should create three standard tenants', () => {
    const tenants = createStandardTenants();
    
    assert.strictEqual(tenants.length, 3);
    
    const gold = tenants.find(t => t.tier === 'gold');
    const silver = tenants.find(t => t.tier === 'silver');
    const bronze = tenants.find(t => t.tier === 'bronze');
    
    assert.ok(gold);
    assert.ok(silver);
    assert.ok(bronze);
  });

  it('should have increasing SLO targets by tier', () => {
    const tenants = createStandardTenants();
    
    const gold = tenants.find(t => t.tier === 'gold')!;
    const silver = tenants.find(t => t.tier === 'silver')!;
    const bronze = tenants.find(t => t.tier === 'bronze')!;
    
    // Gold has most stringent SLOs
    assert.ok(gold.slo.ttftMs! < silver.slo.ttftMs!);
    assert.ok(silver.slo.ttftMs! < bronze.slo.ttftMs!);
  });

  it('should have decreasing weights by tier', () => {
    const tenants = createStandardTenants();
    
    const gold = tenants.find(t => t.tier === 'gold')!;
    const silver = tenants.find(t => t.tier === 'silver')!;
    const bronze = tenants.find(t => t.tier === 'bronze')!;
    
    assert.ok(gold.weight > silver.weight);
    assert.ok(silver.weight > bronze.weight);
  });
});

describe('Scheduling Priority', () => {
  it('should prioritize gold over silver requests', () => {
    const sched = new TenantAwareScheduler(createStandardTenants());
    
    const requests: TenantRequest[] = [
      {
        id: 'silver-first',
        tenantId: 'tenant-silver-1',
        tier: 'silver',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 100
      },
      {
        id: 'gold-second',
        tenantId: 'tenant-gold-1',
        tier: 'gold',
        arrivalMs: 0, // Same arrival time
        prefillTokens: 512,
        decodeTokens: 100
      }
    ];

    const result = sched.scheduleWithTenants(requests);
    
    // Gold should have better compliance due to priority
    const goldMetrics = result.tenantMetrics.get('tenant-gold-1');
    const silverMetrics = result.tenantMetrics.get('tenant-silver-1');
    
    assert.ok(goldMetrics!.isolationScore >= silverMetrics!.isolationScore);
  });
});
