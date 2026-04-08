export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (client: TwentyGraphQLClient, args: Record<string, any>) => Promise<string>;
}

export interface TwentyGraphQLClient {
  query(query: string, variables?: Record<string, any>): Promise<any>;
  mutate(mutation: string, variables?: Record<string, any>): Promise<any>;
}
