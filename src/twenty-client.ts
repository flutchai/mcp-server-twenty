import axios, { type AxiosInstance } from "axios";
import type { TwentyGraphQLClient } from "./types.js";

const TIMEOUT_MS = 15_000;

/** Standard Person fields that have sub-selections — excluded from introspection-based custom fields. */
const STANDARD_FIELD_NAMES = new Set([
  "id", "name", "emails", "phones", "jobTitle", "city",
  "linkedinLink", "xLink", "companyId", "company",
  "createdAt", "updatedAt", "deletedAt",
  "position", "createdBy", "updatedBy", "searchVector", "avatarUrl",
  // relation fields
  "favorites", "attachments", "noteTargets", "taskTargets",
  "timelineActivities", "activityTargets", "messageParticipants", "calendarEventAttendees",
]);

function resolveEndpoint(baseUrl: string): string {
  const url = baseUrl.replace(/\/$/, "");
  return url.endsWith("/graphql") ? url : `${url}/graphql`;
}

function isScalarOrEnum(typeNode: any): boolean {
  if (!typeNode) return false;
  if (typeNode.kind === "SCALAR" || typeNode.kind === "ENUM") return true;
  if (typeNode.ofType) return isScalarOrEnum(typeNode.ofType);
  return false;
}

export interface PersonSchema {
  /** GraphQL fragment lines for all person fields (standard + custom). */
  outputFragment: string;
  /** Names of dynamically discovered custom fields. */
  customFieldNames: string[];
  /** MCP input schema properties for custom fields. */
  customInputProps: Record<string, { type: string; description: string }>;
}

export class TwentyClient implements TwentyGraphQLClient {
  private readonly http: AxiosInstance;
  private personSchema: PersonSchema | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {
    this.http = axios.create({
      baseURL: resolveEndpoint(baseUrl),
      timeout: TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  static resolveCredentials(): { apiKey: string; baseUrl: string } {
    const apiKey = process.env.TWENTY_API_KEY;
    const baseUrl = process.env.TWENTY_BASE_URL;
    if (!apiKey || !baseUrl) {
      throw new Error(
        "Missing Twenty credentials. Set TWENTY_API_KEY and TWENTY_BASE_URL env vars.",
      );
    }
    return { apiKey, baseUrl };
  }

  async query(query: string, variables?: Record<string, any>): Promise<any> {
    return this.execute(query, variables);
  }

  async mutate(mutation: string, variables?: Record<string, any>): Promise<any> {
    return this.execute(mutation, variables);
  }

  private async execute(query: string, variables?: Record<string, any>): Promise<any> {
    const response = await this.http.post("", { query, variables });
    const { data, errors } = response.data;

    if (errors?.length) {
      const messages = errors.map((e: any) => e.message).join("; ");
      throw new Error(`Twenty GraphQL error: ${messages}`);
    }

    return data;
  }

  /**
   * Lazily introspect the Person type to discover custom scalar/enum fields.
   * Result is cached for the process lifetime.
   */
  async getPersonSchema(): Promise<PersonSchema> {
    if (this.personSchema) return this.personSchema;

    try {
      const data = await this.query(`
        query {
          __type(name: "Person") {
            fields {
              name
              description
              type { kind name ofType { kind name ofType { kind name } } }
            }
          }
        }
      `);

      const fields: any[] = data?.__type?.fields ?? [];
      const customFields = fields.filter(
        (f) => !STANDARD_FIELD_NAMES.has(f.name) && isScalarOrEnum(f.type),
      );

      const customFieldNames = customFields.map((f) => f.name as string);

      const customInputProps: Record<string, { type: string; description: string }> = {};
      for (const f of customFields) {
        customInputProps[f.name] = {
          type: "string",
          description: f.description || f.name,
        };
      }

      const standardFragment = `
  id
  name { firstName lastName }
  emails { primaryEmail additionalEmails }
  phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
  jobTitle
  city
  linkedinLink { primaryLinkUrl primaryLinkLabel }
  xLink { primaryLinkUrl primaryLinkLabel }
  companyId
  company { id name }
  createdAt
  updatedAt`;

      const outputFragment =
        customFieldNames.length > 0
          ? `${standardFragment}\n  ${customFieldNames.join("\n  ")}`
          : standardFragment;

      this.personSchema = { outputFragment, customFieldNames, customInputProps };
    } catch {
      // Fallback: standard fields only (e.g. no credentials at static init time)
      this.personSchema = {
        outputFragment: `
  id
  name { firstName lastName }
  emails { primaryEmail additionalEmails }
  phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
  jobTitle
  city
  linkedinLink { primaryLinkUrl primaryLinkLabel }
  xLink { primaryLinkUrl primaryLinkLabel }
  companyId
  company { id name }
  createdAt
  updatedAt`,
        customFieldNames: [],
        customInputProps: {},
      };
    }

    return this.personSchema;
  }
}
