import { LLMQuizGenerator, QuizGenerationUnavailableError, type LLMQuizGeneratorOptions } from "./LLMQuizGenerator.ts";
import type { GenerateMicroQuizInput, MicroQuiz } from "./types.ts";

export class MicroQuizGenerator {
  private readonly llmGenerator: LLMQuizGenerator;

  constructor(options: LLMQuizGeneratorOptions = {}) {
    this.llmGenerator = new LLMQuizGenerator(options);
  }

  async generate(input: GenerateMicroQuizInput): Promise<MicroQuiz> {
    return this.llmGenerator.generate(input);
  }
}

export { QuizGenerationUnavailableError };
