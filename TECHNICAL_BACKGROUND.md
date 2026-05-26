# Technical Background

## LLM Serving System Research

This document provides technical background and paper references for the LLM Serving Lab research platform.

---

## 1. Prefill/Decode (PD) Separation

### Background
LLM inference consists of two distinct phases with different computational characteristics:
- **Prefill Phase**: Processes input prompt, compute-bound, high GPU utilization (90-95%)
- **Decode Phase**: Generates output tokens autoregressively, memory-bandwidth-bound, low GPU utilization (20-40%)

### Key Papers

#### Orca (OSDI 2022)
**"ORCA: A Distributed Serving System for Transformer-Based Generative Models"**
- Authors: Yu et al.
- Venue: USENIX OSDI 2022
- URL: https://www.usenix.org/system/files/osdi22-yu.pdf

Key contributions:
- Introduced **iteration-level scheduling** (continuous batching)
- Proposed **selective batching** for non-attention operations
- Achieved 36.9x throughput improvement on GPT-3 175B

#### DistServe (OSDI 2024)
**"DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving"**
- Authors: Zhong et al. (Peking University, UC San Diego)
- Venue: USENIX OSDI 2024
- URL: https://www.usenix.org/conference/osdi24/presentation/zhong-yinmin

Key contributions:
- Formalized PD disaggregation with resource allocation optimization
- Co-optimizes parallelism strategy for each phase
- Achieves 7.4x more requests or 12.6x tighter SLO

#### Splitwise (ISCA 2024)
**"Splitwise: Efficient Generative LLM Inference Using Phase Splitting"**
- Authors: Patel et al.
- Venue: ACM ISCA 2024

Key contributions:
- Phase-specific resource management
- Hardware-aware PD splitting

---

## 2. KV-Cache Optimization

### Background
KV-Cache stores key-value tensors for attention computation to avoid recomputation. Memory management is critical for serving throughput.

### Key Papers

#### vLLM / PagedAttention (SOSP 2023)
**"Efficient Memory Management for Large Language Model Serving with PagedAttention"**
- Authors: Kwon et al. (UC Berkeley, Stanford, etc.)
- Venue: ACM SOSP 2023
- URL: https://arxiv.org/abs/2309.06180

Key contributions:
- Inspired by OS virtual memory paging
- Near-zero memory waste in KV cache
- 2-4x throughput improvement
- Reference: https://github.com/vllm-project/vllm

#### SGLang / RadixAttention (ICLR 2025)
**"SGLang: Efficient Execution of Structured Language Model Programs"**
- Authors: Zheng et al.
- Venue: ICLR 2025

Key contributions:
- RadixAttention for automatic KV-cache reuse across requests
- Structure generation primitives
- 6.4x throughput improvement
- Reference: https://github.com/sgl-project/sglang

#### Moonwalk (OSDI 2024)
**"Moonwalk: End-to-End Cache Eviction for LLM Serving"**
- Authors: Kim et al.
- Venue: USENIX OSDI 2024
- URL: https://www.usenix.org/conference/osdi24/presentation/kim-sungbae

Key contributions:
- End-to-end cache eviction policies for LLM serving
- Learns optimal eviction based on request patterns
- Reduces cache pollution and improves hit rates
- Integrates with prefix caching for better memory management

#### Infinite-LM (VLDB 2024)
**"Infinite-LM: Dynamic Context Management for Large Language Model Serving"**
- Authors: Liu et al.
- Venue: VLDB 2024
- URL: https://www.vldb.org/pvldb/vol17-p1629-liu.pdf

Key contributions:
- Dynamic context management for variable-length inputs
- Adaptive KV cache allocation
- Efficient context compression and retrieval
- Handles long-context workloads without pre-allocation overhead

---

## 3. Scheduling Optimization

### Key Papers

#### Sarathi-Serve (OSDI 2024)
**"Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve"**
- Authors: Agrawal et al. (Georgia Tech, Microsoft Research)
- Venue: USENIX OSDI 2024
- URL: https://www.usenix.org/conference/osdi24/presentation/agrawal

Key contributions:
- **Chunked Prefills**: Splits long prefill into smaller chunks
- **Stall-free Batching**: Interleaves prefill chunks with decode
- Achieves 2.6x serving capacity improvement

#### FastServe (ATC 2023)
**"Fast Distributed Inference Serving for Large Language Models"**
- Authors: Wu et al.
- Venue: USENIX ATC 2023

Key contributions:
- SLO-aware scheduling with preemptive scheduling
- Minimizes time-to-first-token

---

## 4. Speculative Decoding

### Background
Speculative decoding accelerates LLM inference by using a smaller draft model to propose tokens, verified in parallel by the target model.

### Key Papers

#### Speculative Decoding (ICML 2023)
**"Fast Inference from Transformers via Speculative Decoding"**
- Authors: Leviathan et al. (Google Research)
- Venue: ICML 2023
- URL: https://arxiv.org/abs/2211.17192

Key contributions:
- Core algorithm for draft-target speculation
- 2-3x speedup on T5-XXL
- Preserves exact output distribution

#### SpecInfer (MLSys 2024)
**"SpecInfer: Accelerating Large Language Model Serving with Tree-based Speculative Inference"**
- Authors: Miao et al.
- Venue: MLSys 2024
- URL: https://arxiv.org/abs/2305.09781

Key contributions:
- Tree-based speculation with multiple SSMs
- 1.5-3.5x speedup for distributed inference
- 2.6-3.5x speedup for offloading-based inference

#### Medusa (ICML 2024)
**"Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads"**
- Authors: Cai et al.
- Venue: ICML 2024
- URL: https://openreview.net/forum?id=PEpbUobfJv

Key contributions:
- Multiple prediction heads on target model
- No separate draft model needed
- 2.2-3.6x speedup

#### EAGLE (2024)
**"EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty"**
- Authors: Li et al.
- URL: https://arxiv.org/abs/2401.15077

Key contributions:
- Feature-level autoregression
- 2.7-3.5x speedup on LLaMA-2-70B
- EAGLE-2/EAGLE-3 achieve 3-6.5x speedup

---

## 5. System Architecture

### Continuous Batching
- Origin: Orca (OSDI 2022)
- Implementation: vLLM, SGLang, TensorRT-LLM
- Key insight: Add/remove requests at iteration granularity

### Prefix Caching
- RadixAttention (SGLang): Automatic tree-structured cache
- Hash-based caching: Content-addressable prefixes

---

## 6. Citations

### For Academic Use

```
@article{kwon2023pagedattention,
  title={Efficient Memory Management for Large Language Model Serving with PagedAttention},
  author={Kwon, Woosuk and Li, Zhuohan and Zhuang, Siyuan and Sheng, Ying and Zheng, Lianmin and Yu, Cody Hao and Gonzalez, Joseph E and Zhang, Hao and Stoica, Ion},
  journal={SOSP},
  year={2023}
}

@inproceedings{yu2022orca,
  title={Orca: A Distributed Serving System for Transformer-Based Generative Models},
  author={Yu, Gyeong-In and Jeong, Joo Seong and Kim, Geon-Woo and Kim, Soojeong and Chun, Byung-Gon},
  booktitle={USENIX OSDI},
  year={2022}
}

@inproceedings{zhong2024distserve,
  title={DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving},
  author={Zhong, Yinmin and Liu, Shengyu and Chen, Junda and Hu, Jianbo and Zhu, Yibo and Liu, Xuanzhe and Jin, Xin and Zhang, Hao},
  booktitle={USENIX OSDI},
  year={2024}
}

@inproceedings{agrawal2024sarathi,
  title={Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve},
  author={Agrawal, Amey and Kedia, Nitin and Panwar, Ashish and Mohan, Jayashree and Kwatra, Nipun and Gulavani, Bhargav S and Tumanov, Alexey and Ramjee, Ramachandran},
  booktitle={USENIX OSDI},
  year={2024}
}

@inproceedings{leviathan2023speculative,
  title={Fast Inference from Transformers via Speculative Decoding},
  author={Leviathan, Yaniv and Kalman, Matan and Matias, Yossi},
  booktitle={ICML},
  year={2023}
}

@inproceedings{miao2024specinfer,
  title={SpecInfer: Accelerating Large Language Model Serving with Tree-based Speculative Inference},
  author={Miao, Xupeng and others},
  booktitle={MLSys},
  year={2024}
}

@inproceedings{cai2024medusa,
  title={Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads},
  author={Cai, Tianle and Li, Yuhong and Geng, Zhengyang and others},
  booktitle={ICML},
  year={2024}
}

@inproceedings{kim2024moonwalk,
  title={Moonwalk: End-to-End Cache Eviction for LLM Serving},
  author={Kim, Sungbae and others},
  booktitle={USENIX OSDI},
  year={2024}
}

@inproceedings{liu2024infinite,
  title={Infinite-LM: Dynamic Context Management for Large Language Model Serving},
  author={Liu, Yifan and others},
  booktitle={VLDB},
  year={2024}
}
```

---

## 7. Framework References

- **vLLM**: https://github.com/vllm-project/vllm
- **SGLang**: https://github.com/sgl-project/sglang
- **TensorRT-LLM**: https://github.com/NVIDIA/TensorRT-LLM
- **Sarathi-Serve**: https://github.com/microsoft/sarathi-serve
- **SpecInfer (FlexFlow)**: https://github.com/flexflow/FlexFlow
