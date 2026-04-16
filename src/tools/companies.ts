import type { TwentyClient } from "../twenty-client.js";
import type { ToolDefinition, TwentyGraphQLClient } from "../types.js";

/** Build nested Twenty input from flat tool args. */
function buildCompanyInput(
  args: Record<string, any>,
  customFieldNames: string[],
): Record<string, any> {
  const input: Record<string, any> = {};

  if (args.name) input.name = args.name;
  if (args.domainName) input.domainName = { primaryLinkUrl: args.domainName };
  if (args.address) input.address = { addressStreet1: args.address };
  if (args.city)
    input.address = { ...(input.address ?? {}), addressCity: args.city };
  if (args.linkedinUrl)
    input.linkedinLink = { primaryLinkUrl: args.linkedinUrl };
  if (args.xUrl) input.xLink = { primaryLinkUrl: args.xUrl };
  if (args.annualRecurringRevenue) {
    input.annualRecurringRevenue = {
      amountMicros: Math.round(args.annualRecurringRevenue * 1_000_000),
      currencyCode: args.currency ?? "USD",
    };
  }
  if (args.employees != null) input.employees = args.employees;
  if (args.idealCustomerProfile != null)
    input.idealCustomerProfile = args.idealCustomerProfile;

  // Custom fields — pass through directly
  for (const field of customFieldNames) {
    if (args[field] != null && args[field] !== "") input[field] = args[field];
  }

  return input;
}

const STANDARD_INPUT_PROPERTIES = {
  name: { type: "string", description: "Company name" },
  domainName: {
    type: "string",
    description: "Company website / domain (e.g. 'acme.com')",
  },
  address: { type: "string", description: "Street address" },
  city: { type: "string", description: "City" },
  linkedinUrl: { type: "string", description: "LinkedIn company page URL" },
  xUrl: { type: "string", description: "X/Twitter profile URL" },
  annualRecurringRevenue: {
    type: "number",
    description: "Annual recurring revenue (numeric, e.g. 50000)",
  },
  currency: {
    type: "string",
    description: "Currency code for ARR (default: USD)",
  },
  employees: { type: "number", description: "Number of employees" },
  idealCustomerProfile: {
    type: "boolean",
    description: "Mark as ideal customer profile",
  },
};

export async function buildCompanyTools(
  twentyClient: TwentyClient,
): Promise<ToolDefinition[]> {
  const schema = await twentyClient.getCompanySchema();
  const { outputFragment, customFieldNames, customInputProps } = schema;

  const createUpdateProps = {
    ...STANDARD_INPUT_PROPERTIES,
    ...customInputProps,
  };

  return [
    // ── get_company ──────────────────────────────────────────────────────────
    {
      name: "get_company",
      description: "Get a company from Twenty CRM by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Company ID (UUID)" },
        },
        required: ["id"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const data = await client.query(
          `query GetCompany($id: UUID!) {
            company(filter: { id: { eq: $id } }) {
              ${outputFragment}
            }
          }`,
          { id: args.id },
        );
        return JSON.stringify(data.company ?? null, null, 2);
      },
    },

    // ── list_companies ───────────────────────────────────────────────────────
    {
      name: "list_companies",
      description: "List companies in Twenty CRM with optional filter.",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description:
              'JSON filter object (e.g. \'{"domainName":{"primaryLinkUrl":{"like":"%acme.com%"}}}\' )',
          },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const filter = args.filter ? JSON.parse(args.filter) : undefined;
        const limit = args.limit ?? 20;
        const data = await client.query(
          `query ListCompanies($filter: CompanyFilterInput, $limit: Int) {
            companies(filter: $filter, first: $limit) {
              edges {
                node {
                  ${outputFragment}
                }
              }
              pageInfo { hasNextPage hasPreviousPage }
            }
          }`,
          { filter, limit },
        );
        const nodes = (data.companies?.edges ?? []).map((e: any) => e.node);
        return JSON.stringify(nodes, null, 2);
      },
    },

    // ── create_company ───────────────────────────────────────────────────────
    {
      name: "create_company",
      description: "Create a new company in Twenty CRM.",
      inputSchema: {
        type: "object",
        properties: createUpdateProps,
        required: ["name"],
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const input = buildCompanyInput(args, customFieldNames);
        const data = await client.mutate(
          `mutation CreateCompany($input: CompanyCreateInput!) {
            createCompany(data: $input) {
              ${outputFragment}
            }
          }`,
          { input },
        );
        return JSON.stringify(data.createCompany ?? null, null, 2);
      },
    },

    // ── update_company ───────────────────────────────────────────────────────
    {
      name: "update_company",
      description:
        "Update an existing company in Twenty CRM. Only provided fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Company ID (UUID)" },
          ...createUpdateProps,
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const { id, ...rest } = args;
        const input = buildCompanyInput(rest, customFieldNames);
        const data = await client.mutate(
          `mutation UpdateCompany($id: UUID!, $input: CompanyUpdateInput!) {
            updateCompany(id: $id, data: $input) {
              ${outputFragment}
            }
          }`,
          { id, input },
        );
        return JSON.stringify(data.updateCompany ?? null, null, 2);
      },
    },

    // ── find_or_create_company ───────────────────────────────────────────────
    {
      name: "find_or_create_company",
      description:
        "Find a company by domain name; create if not found. Returns {action, company} where action is 'found' or 'created'.",
      inputSchema: {
        type: "object",
        properties: {
          ...createUpdateProps,
        },
        required: ["name"],
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const { domainName } = args;

        if (domainName) {
          const filter = {
            domainName: { primaryLinkUrl: { like: `%${domainName}%` } },
          };
          const findData = await client.query(
            `query FindCompany($filter: CompanyFilterInput) {
              companies(filter: $filter, first: 1) {
                edges { node { ${outputFragment} } }
              }
            }`,
            { filter },
          );

          const existing = findData.companies?.edges?.[0]?.node;
          if (existing) {
            console.error(
              `[find_or_create_company] Found existing company id=${existing.id}`,
            );
            return JSON.stringify(
              { action: "found", company: existing },
              null,
              2,
            );
          }
        }

        // Not found — create
        const input = buildCompanyInput(args, customFieldNames);
        const createData = await client.mutate(
          `mutation CreateCompany($input: CompanyCreateInput!) {
            createCompany(data: $input) {
              ${outputFragment}
            }
          }`,
          { input },
        );

        const created = createData.createCompany;
        console.error(
          `[find_or_create_company] Created company id=${created?.id}`,
        );
        return JSON.stringify({ action: "created", company: created }, null, 2);
      },
    },
  ];
}
