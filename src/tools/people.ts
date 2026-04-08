import type { TwentyClient } from "../twenty-client.js";
import type { ToolDefinition, TwentyGraphQLClient } from "../types.js";

/** Build nested Twenty input from flat tool args. */
function buildPersonInput(
  args: Record<string, any>,
  customFieldNames: string[],
): Record<string, any> {
  const input: Record<string, any> = {};

  if (args.firstName || args.lastName) {
    input.name = { firstName: args.firstName ?? "", lastName: args.lastName ?? "" };
  }
  if (args.email) {
    input.emails = { primaryEmail: args.email };
  }
  if (args.phone) {
    input.phones = {
      primaryPhoneNumber: args.phone,
      ...(args.phoneCountryCode && { primaryPhoneCountryCode: args.phoneCountryCode }),
      ...(args.phoneCallingCode && { primaryPhoneCallingCode: args.phoneCallingCode }),
    };
  }
  if (args.jobTitle) input.jobTitle = args.jobTitle;
  if (args.city) input.city = args.city;
  if (args.linkedinUrl) input.linkedinLink = { primaryLinkUrl: args.linkedinUrl };
  if (args.xUrl) input.xLink = { primaryLinkUrl: args.xUrl };
  if (args.companyId) input.companyId = args.companyId;

  // Custom fields — pass through directly
  for (const field of customFieldNames) {
    if (args[field] != null && args[field] !== "") input[field] = args[field];
  }

  return input;
}

const STANDARD_INPUT_PROPERTIES = {
  firstName: { type: "string", description: "First name" },
  lastName: { type: "string", description: "Last name" },
  email: { type: "string", description: "Primary email address" },
  phone: { type: "string", description: "Primary phone number" },
  phoneCountryCode: { type: "string", description: "Phone country code (e.g. 'US')" },
  phoneCallingCode: { type: "string", description: "Phone calling code (e.g. '+1')" },
  jobTitle: { type: "string", description: "Job title" },
  city: { type: "string", description: "City" },
  linkedinUrl: { type: "string", description: "LinkedIn profile URL" },
  xUrl: { type: "string", description: "X/Twitter profile URL" },
  companyId: { type: "string", description: "Company ID to associate with" },
};

export async function buildPeopleTools(twentyClient: TwentyClient): Promise<ToolDefinition[]> {
  const schema = await twentyClient.getPersonSchema();
  const { outputFragment, customFieldNames, customInputProps } = schema;

  const createUpdateProps = { ...STANDARD_INPUT_PROPERTIES, ...customInputProps };

  return [
    // ── get_person ──────────────────────────────────────────────────────────
    {
      name: "get_person",
      description: "Get a person from Twenty CRM by ID. Returns all fields including custom ones.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Person ID (UUID)" },
        },
        required: ["id"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const data = await client.query(
          `query GetPerson($id: UUID!) {
            person(filter: { id: { eq: $id } }) {
              ${outputFragment}
            }
          }`,
          { id: args.id },
        );
        return JSON.stringify(data.person ?? null, null, 2);
      },
    },

    // ── list_people ──────────────────────────────────────────────────────────
    {
      name: "list_people",
      description: "List people in Twenty CRM with optional filter. Returns all fields including custom ones.",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "JSON filter object (e.g. '{\"emails\":{\"primaryEmail\":{\"eq\":\"x@y.com\"}}}' )",
          },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const filter = args.filter ? JSON.parse(args.filter) : undefined;
        const limit = args.limit ?? 20;
        const data = await client.query(
          `query ListPeople($filter: PersonFilterInput, $limit: Int) {
            people(filter: $filter, first: $limit) {
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
        const nodes = (data.people?.edges ?? []).map((e: any) => e.node);
        return JSON.stringify(nodes, null, 2);
      },
    },

    // ── create_person ────────────────────────────────────────────────────────
    {
      name: "create_person",
      description: "Create a new person in Twenty CRM. Supports all standard and custom fields.",
      inputSchema: {
        type: "object",
        properties: createUpdateProps,
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const input = buildPersonInput(args, customFieldNames);
        const data = await client.mutate(
          `mutation CreatePerson($input: PersonCreateInput!) {
            createPerson(data: $input) {
              ${outputFragment}
            }
          }`,
          { input },
        );
        return JSON.stringify(data.createPerson ?? null, null, 2);
      },
    },

    // ── update_person ────────────────────────────────────────────────────────
    {
      name: "update_person",
      description: "Update an existing person in Twenty CRM. Only provided fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Person ID (UUID)" },
          ...createUpdateProps,
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const { id, ...rest } = args;
        const input = buildPersonInput(rest, customFieldNames);
        const data = await client.mutate(
          `mutation UpdatePerson($id: UUID!, $input: PersonUpdateInput!) {
            updatePerson(id: $id, data: $input) {
              ${outputFragment}
            }
          }`,
          { id, input },
        );
        return JSON.stringify(data.updatePerson ?? null, null, 2);
      },
    },

    // ── upsert_person ────────────────────────────────────────────────────────
    {
      name: "upsert_person",
      description:
        "Find a person by email or phone; create if not found. Returns {action, client} where action is 'found' or 'created'.",
      inputSchema: {
        type: "object",
        properties: createUpdateProps,
        additionalProperties: false,
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const { email, phone } = args;
        const searchValue = email || phone;

        if (searchValue) {
          // Build filter for email or phone
          const filter = email
            ? { emails: { primaryEmail: { eq: email } } }
            : { phones: { primaryPhoneNumber: { like: `%${phone}%` } } };

          const findData = await client.query(
            `query FindPerson($filter: PersonFilterInput) {
              people(filter: $filter, first: 1) {
                edges { node { ${outputFragment} } }
              }
            }`,
            { filter },
          );

          const existing = findData.people?.edges?.[0]?.node;
          if (existing) {
            console.error(`[upsert_person] Found existing person id=${existing.id}`);
            return JSON.stringify({ action: "found", client: existing }, null, 2);
          }
        }

        // Not found — create
        const input = buildPersonInput(args, customFieldNames);
        const createData = await client.mutate(
          `mutation CreatePerson($input: PersonCreateInput!) {
            createPerson(data: $input) {
              ${outputFragment}
            }
          }`,
          { input },
        );

        const created = createData.createPerson;
        console.error(`[upsert_person] Created person id=${created?.id}`);
        return JSON.stringify({ action: "created", client: created }, null, 2);
      },
    },
  ];
}
