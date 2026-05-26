/**
 * DeterministicRandom Test Suite
 * 
 * Tests for the Mulberry32 PRNG implementation.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";

import {
  DeterministicRandom,
  DEFAULT_SEED,
  getGlobalRandom,
  resetGlobalRandom,
  deterministicRandom,
  deterministicRandomInt,
  deterministicRandomBoolean,
  deterministicRandomFloat,
  deterministicRandomChoice,
  deterministicNoise
} from "../../../src/agents/learningAssistant/serving/utils/DeterministicRandom.ts";

describe("DeterministicRandom", () => {
  describe("basic random()", () => {
    it("should generate values in [0, 1)", () => {
      const rng = new DeterministicRandom(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.random();
        assert(v >= 0, "value should be >= 0");
        assert(v < 1, "value should be < 1");
      }
    });

    it("should produce deterministic sequence with same seed", () => {
      const rng1 = new DeterministicRandom(123);
      const rng2 = new DeterministicRandom(123);
      
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(rng1.random(), rng2.random());
      }
    });

    it("should produce different sequences with different seeds", () => {
      const rng1 = new DeterministicRandom(100);
      const rng2 = new DeterministicRandom(200);
      
      let foundDifference = false;
      for (let i = 0; i < 100; i++) {
        if (rng1.random() !== rng2.random()) {
          foundDifference = true;
          break;
        }
      }
      assert(foundDifference, "different seeds should produce different sequences");
    });
  });

  describe("randomInt(min, max)", () => {
    it("should return integers in inclusive range [min, max]", () => {
      const rng = new DeterministicRandom(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.randomInt(5, 10);
        assert(v >= 5, "value should be >= 5");
        assert(v <= 10, "value should be <= 10");
        assert.strictEqual(v, Math.floor(v), "value should be integer");
      }
    });

    it("should be deterministic", () => {
      const rng1 = new DeterministicRandom(42);
      const rng2 = new DeterministicRandom(42);
      
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(rng1.randomInt(0, 100), rng2.randomInt(0, 100));
      }
    });
  });

  describe("randomBoolean(p)", () => {
    it("should return boolean values", () => {
      const rng = new DeterministicRandom(42);
      let trueCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (rng.randomBoolean(0.5)) trueCount++;
      }
      assert(trueCount > 0, "should have some true values");
      assert(trueCount < 1000, "should have some false values");
    });

    it("should respect probability parameter", () => {
      const rng = new DeterministicRandom(42);
      let trueCount = 0;
      for (let i = 0; i < 10000; i++) {
        if (rng.randomBoolean(0.9)) trueCount++;
      }
      // With p=0.9, should get approximately 9000 trues
      assert(trueCount > 8000, `should have mostly true values (got ${trueCount}/10000)`);
    });

    it("should be deterministic", () => {
      const rng1 = new DeterministicRandom(42);
      const rng2 = new DeterministicRandom(42);
      
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(rng1.randomBoolean(), rng2.randomBoolean());
      }
    });
  });

  describe("randomFloat(min, max)", () => {
    it("should return floats in [min, max)", () => {
      const rng = new DeterministicRandom(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.randomFloat(10, 20);
        assert(v >= 10, `value ${v} should be >= 10`);
        assert(v < 20, `value ${v} should be < 20`);
      }
    });
  });

  describe("randomChoice(array)", () => {
    it("should return elements from the array", () => {
      const rng = new DeterministicRandom(42);
      const arr = [1, 2, 3, 4, 5];
      for (let i = 0; i < 100; i++) {
        const v = rng.randomChoice(arr);
        assert(arr.includes(v), "should return array element");
      }
    });

    it("should throw on empty array", () => {
      const rng = new DeterministicRandom(42);
      assert.throws(() => rng.randomChoice([]), /empty array/);
    });
  });

  describe("shuffle(array)", () => {
    it("should shuffle array in place", () => {
      const rng = new DeterministicRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const original = [...arr];
      rng.shuffle(arr);
      
      assert.deepStrictEqual(arr.sort(), original.sort(), "should contain same elements");
      assert.notDeepStrictEqual(arr, original, "should be reordered");
    });

    it("should be deterministic", () => {
      const arr1 = [1, 2, 3, 4, 5];
      const arr2 = [1, 2, 3, 4, 5];
      
      new DeterministicRandom(42).shuffle(arr1);
      new DeterministicRandom(42).shuffle(arr2);
      
      assert.deepStrictEqual(arr1, arr2);
    });
  });

  describe("sample(array, n)", () => {
    it("should return n random elements without replacement", () => {
      const rng = new DeterministicRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const sample = rng.sample(arr, 3);
      
      assert.strictEqual(sample.length, 3);
      assert.strictEqual(arr.length, 10, "original array should be unchanged");
    });

    it("should not return duplicates", () => {
      const rng = new DeterministicRandom(42);
      const arr = [1, 2, 3, 4, 5];
      const sample = rng.sample(arr, 5);
      
      const unique = new Set(sample);
      assert.strictEqual(unique.size, sample.length);
    });

    it("should return all elements if n equals array length", () => {
      const rng = new DeterministicRandom(42);
      const arr = [1, 2, 3];
      const sample = rng.sample(arr, 3);
      
      assert.strictEqual(sample.length, 3);
      assert.deepStrictEqual(sample.sort(), [1, 2, 3]);
    });
  });

  describe("noise(factor)", () => {
    it("should return value around 1", () => {
      const rng = new DeterministicRandom(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.noise(0.1);
        assert(v >= 0.95, `noise ${v} should be >= 0.95`);
        assert(v <= 1.05, `noise ${v} should be <= 1.05`);
      }
    });
  });

  describe("reset(seed)", () => {
    it("should reset state to initial seed", () => {
      const rng = new DeterministicRandom(42);
      rng.random(); // advance state
      rng.random();
      rng.reset(42); // reset
      rng.random(); // advance again
      
      const rng2 = new DeterministicRandom(42);
      rng2.random();
      rng2.random();
      rng2.random(); // same number of calls
      
      assert.strictEqual(rng.random(), rng2.random());
    });
  });

  describe("getState/setState", () => {
    it("should allow state serialization", () => {
      const rng1 = new DeterministicRandom(42);
      rng1.random();
      rng1.random();
      const state = rng1.getState();
      
      const rng2 = new DeterministicRandom(0);
      rng2.setState(state);
      
      // Both should produce identical sequences
      assert.strictEqual(rng1.random(), rng2.random());
      assert.strictEqual(rng1.random(), rng2.random());
    });
  });
});

describe("Global random functions", () => {
  beforeEach(() => {
    resetGlobalRandom(42);
  });

  it("deterministicRandom() should return values in [0, 1)", () => {
    const v = deterministicRandom();
    assert(v >= 0);
    assert(v < 1);
  });

  it("deterministicRandomInt(min, max) should return integers", () => {
    const v = deterministicRandomInt(1, 10);
    assert(v >= 1);
    assert(v <= 10);
    assert.strictEqual(v, Math.floor(v));
  });

  it("deterministicRandomBoolean(p) should return boolean", () => {
    const v = deterministicRandomBoolean(0.5);
    assert.strictEqual(typeof v, "boolean");
  });

  it("deterministicRandomFloat(min, max) should return floats", () => {
    const v = deterministicRandomFloat(5, 10);
    assert(v >= 5);
    assert(v < 10);
  });

  it("deterministicNoise(factor) should return values around 1", () => {
    const v = deterministicNoise(0.1);
    assert(v >= 0.9);
    assert(v <= 1.1);
  });

  it("getGlobalRandom() should return same instance", () => {
    const r1 = getGlobalRandom();
    const r2 = getGlobalRandom();
    assert.strictEqual(r1, r2);
  });
});

describe("DEFAULT_SEED", () => {
  it("should be 42", () => {
    assert.strictEqual(DEFAULT_SEED, 42);
  });
});
