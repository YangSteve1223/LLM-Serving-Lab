import type { LearningResource, ResourceSearchResult } from "../types.ts";

export type ResourceVerifierOptions = {
  fetchFn?: typeof fetch;
  checkUrlExists?: boolean;
  timeoutMs?: number;
};

export class ResourceVerifier {
  private readonly fetchFn: typeof fetch;
  private readonly checkUrlExists: boolean;
  private readonly timeoutMs: number;

  constructor(options: ResourceVerifierOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.checkUrlExists = options.checkUrlExists ?? false;
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  async verifySearchResult(result: ResourceSearchResult): Promise<ResourceSearchResult | undefined> {
    if (!hasRealUrl(result.url) || !hasRealTitle(result.title)) return undefined;
    if (isDemoLike(result.title, result.url, result.snippet)) return undefined;
    if (!isConceptRelevant(result)) return undefined;
    const verified = this.checkUrlExists ? await this.urlExists(result.url) : Boolean(result.verified ?? true);
    if (!verified) return { ...result, verified: false };
    return { ...result, verified: true };
  }

  async verifyLearningResource(resource: LearningResource): Promise<LearningResource | undefined> {
    if (!hasRealUrl(resource.url) || !hasRealTitle(resource.title)) return undefined;
    if (isDemoLike(resource.title, resource.url, resource.description, resource.qualityTags)) return undefined;
    const verified = resource.verified === true || resource.platform === "school";
    if (!verified && this.checkUrlExists && !(await this.urlExists(resource.url))) return undefined;
    return { ...resource, verified: verified || !this.checkUrlExists };
  }

  private async urlExists(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, { method: "HEAD", signal: controller.signal });
      if (response.ok) return true;
      if ([403, 405].includes(response.status)) {
        const getResponse = await this.fetchFn(url, { method: "GET", signal: controller.signal });
        return getResponse.ok || getResponse.status === 403;
      }
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function hasRealUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(url) && !/example\.(com|edu)|demo:|localhost|127\.0\.0\.1/i.test(url));
}

function hasRealTitle(title: string | undefined): title is string {
  return Boolean(title?.trim() && !/^demo\s*资源/i.test(title) && !/^Demo\s/i.test(title));
}

function isDemoLike(...values: unknown[]): boolean {
  const text = values.flat().filter(Boolean).join(" ").toLowerCase();
  return /demo|占位|placeholder|replaceable|example\.edu|example\.com/.test(text);
}

function isConceptRelevant(result: ResourceSearchResult): boolean {
  return Boolean(`${result.title} ${result.snippet ?? ""} ${result.reason ?? ""}`.trim());
}
