import type { Skill, SkillInput, SkillOutput } from "../types.ts";

export class SkillRegistry {
  private skills: Map<string, Skill>;

  constructor(skills: Skill[] = []) {
    this.skills = new Map();
    for (const skill of skills) this.register(skill);
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  async run(name: string, input: SkillInput): Promise<SkillOutput> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    if (skill.canHandle && !(await skill.canHandle(input))) {
      return {
        content: `Skill ${name} skipped because canHandle returned false.`,
        metadata: { skipped: true },
        status: "empty"
      };
    }
    return skill.run(input);
  }
}
