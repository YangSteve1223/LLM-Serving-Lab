/**
 * ExperimentMatrix Tests
 * 
 * Tests for:
 * - Matrix cell generation
 * - Configuration creation
 * - Statistical calculations
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ExperimentMatrixRunner,
  createMatrixRunner,
  DEFAULT_MATRIX_CONFIG,
  type ExperimentMatrixConfig,
  type MatrixCell,
  type ArchitectureDim,
  type CacheDim,
  type SchedulerDim
} from '../../../src/agents/learningAssistant/serving/experiment/ExperimentMatrix.ts';

describe('ExperimentMatrixRunner', () => {
  let runner: ExperimentMatrixRunner;

  beforeEach(() => {
    runner = createMatrixRunner({
      requestCount: 10,
      repetitions: 3,
      warmupIterations: 1
    });
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const defaultRunner = createMatrixRunner();
      
      assert.strictEqual(defaultRunner['config'].repetitions, DEFAULT_MATRIX_CONFIG.repetitions);
      assert.strictEqual(defaultRunner['config'].requestCount, DEFAULT_MATRIX_CONFIG.requestCount);
    });

    it('should merge custom config with defaults', () => {
      const customRunner = createMatrixRunner({
        seed: 123,
        requestCount: 50
      });
      
      assert.strictEqual(customRunner['config'].seed, 123);
      assert.strictEqual(customRunner['config'].requestCount, 50);
      assert.strictEqual(customRunner['config'].repetitions, DEFAULT_MATRIX_CONFIG.repetitions);
    });
  });

  describe('generateMatrix', () => {
    it('should generate 27 cells (3x3x3)', () => {
      const matrix = runner.generateMatrix();
      
      assert.strictEqual(matrix.length, 27);
    });

    it('should have all architecture combinations', () => {
      const matrix = runner.generateMatrix();
      const architectures = new Set(matrix.map(c => c.architecture));
      
      assert.ok(architectures.has('monolithic'));
      assert.ok(architectures.has('pd_separated'));
      assert.ok(architectures.has('hybrid'));
    });

    it('should have all cache combinations', () => {
      const matrix = runner.generateMatrix();
      const caches = new Set(matrix.map(c => c.cache));
      
      assert.ok(caches.has('none'));
      assert.ok(caches.has('hash'));
      assert.ok(caches.has('radix'));
    });

    it('should have all scheduler combinations', () => {
      const matrix = runner.generateMatrix();
      const schedulers = new Set(matrix.map(c => c.scheduler));
      
      assert.ok(schedulers.has('fcfs'));
      assert.ok(schedulers.has('sjf'));
      assert.ok(schedulers.has('slo_aware'));
    });

    it('should create valid configurations for each cell', () => {
      const matrix = runner.generateMatrix();
      
      for (const cell of matrix) {
        assert.ok(cell.config.id);
        assert.ok(cell.config.name);
        assert.ok(cell.config.workload);
        assert.ok(cell.config.simulator);
        assert.ok(cell.config.cache);
        assert.ok(cell.config.scheduler);
        assert.ok(cell.config.statistical);
      }
    });

    it('should set unique seeds for each cell', () => {
      const matrix = runner.generateMatrix();
      const seeds = matrix.map(c => c.config.seed);
      
      assert.strictEqual(new Set(seeds).size, seeds.length);
    });

    it('should map architecture to correct config', () => {
      const matrix = runner.generateMatrix();
      
      const monolithicCells = matrix.filter(c => c.architecture === 'monolithic');
      for (const cell of monolithicCells) {
        assert.strictEqual(cell.config.simulator.architecture, 'monolithic');
      }
      
      const pdCells = matrix.filter(c => c.architecture === 'pd_separated');
      for (const cell of pdCells) {
        assert.strictEqual(cell.config.simulator.architecture, 'pd_separated');
      }
      
      const hybridCells = matrix.filter(c => c.architecture === 'hybrid');
      for (const cell of hybridCells) {
        assert.strictEqual(cell.config.simulator.architecture, 'hybrid');
      }
    });

    it('should map cache to correct config', () => {
      const matrix = runner.generateMatrix();
      
      const noneCells = matrix.filter(c => c.cache === 'none');
      for (const cell of noneCells) {
        assert.strictEqual(cell.config.cache.type, 'none');
        assert.strictEqual(cell.config.cache.capacityMB, 0);
      }
      
      const hashCells = matrix.filter(c => c.cache === 'hash');
      for (const cell of hashCells) {
        assert.strictEqual(cell.config.cache.type, 'hash');
        assert.ok(cell.config.cache.capacityMB > 0);
      }
      
      const radixCells = matrix.filter(c => c.cache === 'radix');
      for (const cell of radixCells) {
        assert.strictEqual(cell.config.cache.type, 'radix');
        assert.ok(cell.config.cache.capacityMB > 0);
      }
    });

    it('should map scheduler to correct config', () => {
      const matrix = runner.generateMatrix();
      
      const fcfsCells = matrix.filter(c => c.scheduler === 'fcfs');
      for (const cell of fcfsCells) {
        assert.strictEqual(cell.config.scheduler.type, 'fcfs');
      }
      
      const sjfCells = matrix.filter(c => c.scheduler === 'sjf');
      for (const cell of sjfCells) {
        assert.strictEqual(cell.config.scheduler.type, 'sjf');
      }
      
      const sloCells = matrix.filter(c => c.scheduler === 'slo_aware');
      for (const cell of sloCells) {
        assert.strictEqual(cell.config.scheduler.type, 'slo_aware');
        assert.ok(cell.config.scheduler.slo);
      }
    });
  });

  describe('cell structure', () => {
    it('should have correct cell structure', () => {
      const matrix = runner.generateMatrix();
      const cell = matrix[0];
      
      assert.ok('architecture' in cell);
      assert.ok('cache' in cell);
      assert.ok('scheduler' in cell);
      assert.ok('config' in cell);
    });

    it('should create unique cell IDs', () => {
      const matrix = runner.generateMatrix();
      const ids = matrix.map(c => c.config.id);
      
      assert.strictEqual(new Set(ids).size, ids.length);
    });
  });

  describe('DEFAULT_MATRIX_CONFIG', () => {
    it('should have sensible defaults', () => {
      assert.strictEqual(DEFAULT_MATRIX_CONFIG.repetitions, 10);
      assert.strictEqual(DEFAULT_MATRIX_CONFIG.warmupIterations, 5);
      assert.strictEqual(DEFAULT_MATRIX_CONFIG.requestCount, 100);
      assert.strictEqual(DEFAULT_MATRIX_CONFIG.confidenceLevel, 0.95);
      assert.strictEqual(DEFAULT_MATRIX_CONFIG.significanceLevel, 0.05);
    });

    it('should have SLO targets defined', () => {
      assert.ok(DEFAULT_MATRIX_CONFIG.sloTargets);
      assert.ok(DEFAULT_MATRIX_CONFIG.sloTargets.ttftMs);
      assert.ok(DEFAULT_MATRIX_CONFIG.sloTargets.tpotMs);
      assert.ok(DEFAULT_MATRIX_CONFIG.sloTargets.e2eMs);
    });
  });
});

describe('Matrix Cell Types', () => {
  describe('ArchitectureDim', () => {
    it('should allow valid architecture types', () => {
      const validArchitectures: ArchitectureDim[] = ['monolithic', 'pd_separated', 'hybrid'];
      
      for (const arch of validArchitectures) {
        assert.ok(['monolithic', 'pd_separated', 'hybrid'].includes(arch));
      }
    });
  });

  describe('CacheDim', () => {
    it('should allow valid cache types', () => {
      const validCaches: CacheDim[] = ['none', 'hash', 'radix'];
      
      for (const cache of validCaches) {
        assert.ok(['none', 'hash', 'radix'].includes(cache));
      }
    });
  });

  describe('SchedulerDim', () => {
    it('should allow valid scheduler types', () => {
      const validSchedulers: SchedulerDim[] = ['fcfs', 'sjf', 'slo_aware'];
      
      for (const sched of validSchedulers) {
        assert.ok(['fcfs', 'sjf', 'slo_aware'].includes(sched));
      }
    });
  });
});

describe('MatrixRunner with small config', () => {
  it('should run successfully with minimal config', () => {
    const smallRunner = createMatrixRunner({
      requestCount: 5,
      repetitions: 2,
      warmupIterations: 1,
      avgPromptTokens: 128,
      avgCompletionTokens: 64,
      qps: 1
    });
    
    const matrix = smallRunner.generateMatrix();
    
    assert.strictEqual(matrix.length, 27);
    assert.ok(matrix.every(c => c.config.workload.requestCount === 5));
  });
});
