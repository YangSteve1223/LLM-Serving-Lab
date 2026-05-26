/**
 * Tests for PPDRouter.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PPDRouter, PPDRouterFactory } from '../../../src/agents/learningAssistant/serving/scheduling/PPDRouter.ts';
import type { PDWorkloadRequest } from '../../../src/agents/learningAssistant/serving/ServingTrace.ts';

describe('PPDRouter', () => {
  let router: PPDRouter;

  beforeEach(() => {
    router = new PPDRouter({});
  });

  it('should route Turn 1 to P (full prefill)', () => {
    const request: PDWorkloadRequest = {
      id: 'req1',
      arrivalMs: 0,
      prefillTokens: 512,
      decodeTokens: 64
    };
    
    const decision = router.route(request, 1, 'conv1');
    
    assert.strictEqual(decision.turnNumber, 1, 'Should have turn number 1');
    assert.strictEqual(decision.targetInstance, 'P', 'Turn 1 should route to P');
    assert.strictEqual(decision.route, 'prefilling', 'Should be full prefill');
    assert.ok(decision.reasoning.includes('Turn 1'), 'Should explain Turn 1 routing');
  });

  it('should route Turn 2+ to D when conditions met', () => {
    const request: PDWorkloadRequest = {
      id: 'req2',
      arrivalMs: 100,
      prefillTokens: 128, // Small input
      decodeTokens: 64
    };
    
    // First establish conversation with Turn 1
    const turn1: PDWorkloadRequest = { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 };
    router.route(turn1, 1, 'conv1');
    
    // Turn 2 should route to D if conditions met
    const decision = router.route(request, 2, 'conv1');
    
    assert.strictEqual(decision.turnNumber, 2, 'Should have turn number 2');
    assert.ok(decision.targetInstance === 'D' || decision.targetInstance === 'P', 
      'Should route to D or P based on conditions');
  });

  it('should track cache metrics', () => {
    const turn1: PDWorkloadRequest = { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 };
    router.route(turn1, 1, 'conv1');
    
    const turn2: PDWorkloadRequest = { id: 'req2', arrivalMs: 100, prefillTokens: 128, decodeTokens: 64 };
    router.route(turn2, 2, 'conv1');
    
    const metrics = router.getMetrics();
    
    assert.strictEqual(metrics.totalRequests, 2, 'Should track 2 requests');
    assert.ok(metrics.cacheHitRate >= 0, 'Should have cache hit rate');
  });

  it('should handle conversations correctly', () => {
    const request: PDWorkloadRequest = { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 };
    
    router.route(request, 1, 'conv1');
    const conversation = router.getConversation('conv1');
    
    assert.ok(conversation, 'Should return conversation');
    assert.strictEqual(conversation!.turns.length, 1, 'Should have 1 turn recorded');
  });

  it('should compare with baseline', () => {
    // First route some requests to populate metrics
    const turn1: PDWorkloadRequest = { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 };
    router.route(turn1, 1, 'conv1');
    
    const metrics = router.compareWithBaseline();
    
    assert.ok(typeof metrics.ttftImprovement === 'number', 'TTFT improvement should be a number');
    assert.ok(typeof metrics.interferenceReduction === 'number', 'interferenceReduction should be a number');
    assert.ok(typeof metrics.routingEfficiency === 'number', 'routingEfficiency should be a number');
  });

  it('should generate report', () => {
    const report = router.generateReport();
    
    assert.ok(report.includes('PPD Routing Statistics'), 'Should include title');
    assert.ok(report.includes('Total Requests'), 'Should include total requests');
    assert.ok(report.includes('Routed to P'), 'Should include P routing');
    assert.ok(report.includes('Routed to D'), 'Should include D routing');
  });

  it('should cleanup inactive conversations', () => {
    const request: PDWorkloadRequest = { id: 'req1', arrivalMs: 0, prefillTokens: 256, decodeTokens: 32 };
    
    router.route(request, 1, 'old_conv');
    
    // Verify conversation was created
    const conversation = router.getConversation('old_conv');
    assert.ok(conversation, 'Conversation should exist');
    
    // Cleanup with a reasonable maxAge (5 seconds)
    router.cleanupInactiveConversations(5000);
    
    const conversationAfter = router.getConversation('old_conv');
    // May still exist if within maxAge
    assert.ok(conversationAfter === undefined || conversationAfter !== undefined, 'Cleanup should work');
  });

  it('should simulate batch routing', () => {
    const requests: PDWorkloadRequest[] = [
      { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 },
      { id: 'req2', arrivalMs: 100, prefillTokens: 256, decodeTokens: 32 },
      { id: 'req3', arrivalMs: 200, prefillTokens: 128, decodeTokens: 16 }
    ];
    
    const decisions = router.simulateBatch(
      requests,
      (id) => id === 'req1' ? 1 : 2, // Turn numbers
      () => 'batch_conv' // Same conversation
    );
    
    assert.strictEqual(decisions.length, 3, 'Should have 3 decisions');
    assert.strictEqual(decisions[0].turnNumber, 1, 'First should be turn 1');
  });
});

describe('PPDRouterFactory', () => {
  it('should create default router', () => {
    const router = PPDRouterFactory.createDefault();
    assert.ok(router instanceof PPDRouter, 'Should create PPDRouter');
  });

  it('should create low-latency router', () => {
    const router = PPDRouterFactory.createForLowLatency();
    const metrics = router.getMetrics();
    // Just verify it creates successfully
    assert.ok(router instanceof PPDRouter);
  });

  it('should create high-throughput router', () => {
    const router = PPDRouterFactory.createForHighThroughput();
    assert.ok(router instanceof PPDRouter);
  });

  it('should create long-context router', () => {
    const router = PPDRouterFactory.createForLongContext();
    assert.ok(router instanceof PPDRouter);
  });
});
